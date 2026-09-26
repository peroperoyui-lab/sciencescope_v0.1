import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';

const TURN_TIMEOUT_MS = 30_000;

function withTimeout(promise, label, timeout = TURN_TIMEOUT_MS) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function deferred() {
  let resolve;
  const promise = new Promise((value) => { resolve = value; });
  return { promise, resolve };
}

function fixtureRuntimeConfig(port) {
  return {
    providers: {
      fixture: {
        displayName: 'Local approval fixture',
        api: 'openai-completions',
        apiKeyEnv: 'SCIENCESCOPE_OFFLINE_KEY',
        baseURL: `http://127.0.0.1:${port}/v1`,
        models: [{ id: 'fixture', name: 'Local approval fixture', contextWindow: 32768, maxTokens: 1024 }],
      },
    },
  };
}

function shellCommand(markerPath) {
  if (process.platform === 'win32') {
    const quoted = markerPath.replaceAll("'", "''");
    return `pwsh -NoLogo -NoProfile -NonInteractive -Command "Set-Content -LiteralPath '${quoted}' -Value 'APPROVED_MARKER'"`;
  }
  const quoted = markerPath.replaceAll("'", "'\\''");
  return `bash -lc "printf APPROVED_MARKER > '${quoted}'"`;
}

function toolForPlatform(tools) {
  const names = tools.map((tool) => tool.function?.name).filter(Boolean);
  const matcher = process.platform === 'win32' ? /pwsh$/i : /(?:bash|shell)$/i;
  const name = names.find((candidate) => matcher.test(candidate));
  if (!name) throw new Error(`fixture model could not find platform shell tool (${names.join(', ')})`);
  return tools.find((tool) => tool.function?.name === name);
}

async function startFixture() {
  const requests = [];
  const fixture = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push({ headers: req.headers, input });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });

    const toolMessage = input.messages?.find((message) => message.role === 'tool');
    if (!toolMessage) {
      let tool;
      try { tool = toolForPlatform(input.tools ?? []); }
      catch (error) {
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `FIXTURE_ERROR:${error.message}` } }] })}\n\ndata: [DONE]\n\n`);
        return;
      }
      const promptText = input.messages?.map((message) => message.content).filter((content) => typeof content === 'string').join('\n') ?? '';
      const marker = promptText.match(/MARKER=(\S+)/u)?.[1];
      if (!marker) {
        res.end('data: {"choices":[{"delta":{"content":"FIXTURE_ERROR:missing marker"}}]}\n\ndata: [DONE]\n\n');
        return;
      }
      const properties = Object.keys(tool.function.parameters?.properties ?? {});
      const commandKey = properties.find((key) => /command|cmd|script/i.test(key)) ?? properties[0];
      const args = {
        [commandKey]: shellCommand(marker),
        description: 'Local approval regression command',
        sandbox_permissions: 'danger-full-access',
        justification: 'The regression fixture requests the explicit host approval decision.',
      };
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call-${requests.length}`, type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } }] } }] })}\n\n`);
      res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
    } else {
      res.write('data: {"choices":[{"delta":{"content":"FINAL_ACK"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  return { fixture, requests, port: fixture.address().port };
}

async function assertMarker(pathname, expected) {
  let present = false;
  try { present = (await readFile(pathname, 'utf8')).trim() === 'APPROVED_MARKER'; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(present, expected, `${expected ? 'approved' : 'rejected'} command marker state`);
}

async function runDecision({ host, runtimeConfig, root, fixture, kind, outcome }) {
  const markerPath = path.join(root, `.sciencescope-local`, 'temp', `${kind}-${outcome}.marker`);
  await mkdir(path.dirname(markerPath), { recursive: true });
  const fixtureStart = fixture.requests.length;
  const runId = `${kind}-${outcome}`;
  const sessionId = await host.startSession({
    model: { providerId: 'fixture', modelId: 'fixture' },
    workspace: root,
    runtimeConfig,
    sessionId: `session-${`${kind}${outcome}`.replaceAll(/[^A-Za-z0-9]/gu, '')}`,
  });
  await host.configurePolicy({ sessionId, approvalPolicy: 'ask', sandboxMode: 'workspace-write' });
  const controlEvents = [];
  const expertEvents = [];
  const mainEvents = [];
  let replyPromise;
  const stopObserving = host.observeSession(sessionId, (frame) => {
    if (frame.type !== 'control-event' || frame.event?.type !== 'approval-request') return;
    controlEvents.push(frame.event);
    replyPromise = host.replyApproval({ sessionId, requestId: frame.event.requestId, outcome });
  });
  try {
    let result;
    if (kind.startsWith('main')) {
      result = await withTimeout(host.send({
        sessionId,
        text: `MARKER=${markerPath} Execute the shell command once, then answer FINAL_ACK.`,
        onEvent: (event) => mainEvents.push(event),
      }), `${kind} ${outcome}`);
    } else {
      result = await withTimeout(host.runExperts({
        sessionId,
        runId,
        prompt: `MARKER=${markerPath} Execute the shell command once, then answer FINAL_ACK.`,
        experts: [{ id: 'approval-expert', persona: 'You are an approval regression expert.' }],
        onEvent: (event) => expertEvents.push(event),
      }), `${kind} ${outcome}`);
    }
    await replyPromise;
    assert.equal(controlEvents.length, 1, `${kind} ${outcome} emitted one approval request; result: ${JSON.stringify(result)}; tool result: ${JSON.stringify(expertEvents.find((event) => event.type === 'expert-tool-result') ?? null)}`);
    assert.equal(controlEvents[0].toolName.match(/(?:pwsh|bash|shell)/i) !== null, true);
    if (kind.startsWith('expert')) {
      assert.equal(controlEvents[0].expertId, 'approval-expert');
      assert.equal(controlEvents[0].runId, runId);
    } else {
      assert.equal(controlEvents[0].expertId, undefined);
      assert.equal(controlEvents[0].runId, undefined);
    }
    if (kind.startsWith('main')) {
      assert.equal(result.finalResponse, 'FINAL_ACK');
      const call = mainEvents.find((event) => event.type === 'tool-call');
      assert.ok(call, `${kind} emitted tool-call`);
      const toolResult = mainEvents.find((event) => event.type === 'tool-result');
      assert.ok(toolResult, `${kind} emitted tool-result`);
      assert.equal(toolResult.callId, call.callId);
      assert.equal(toolResult.isError, outcome === 'rejected');
      assert.equal(typeof toolResult.resultPreview, 'string');
      assert.notEqual(toolResult.resultPreview, 'undefined');
    } else {
      assert.equal(result.length, 1);
      assert.equal(result[0].text, 'FINAL_ACK');
      assert.equal(result[0].stopReason, 'completed');
      const tool = expertEvents.find((event) => event.type === 'expert-tool');
      assert.ok(tool, `${kind} emitted expert-tool`);
      const toolResult = expertEvents.find((event) => event.type === 'expert-tool-result');
      assert.ok(toolResult, `${kind} emitted expert-tool-result`);
      assert.equal(toolResult.callId, tool.callId);
      assert.equal(toolResult.isError, outcome === 'rejected');
      assert.equal(typeof toolResult.resultPreview, 'string');
      assert.notEqual(toolResult.resultPreview, 'undefined');
    }
    await assertMarker(markerPath, outcome === 'allowed-once');
    const fixtureDelta = fixture.requests.length - fixtureStart;
    assert.equal(fixtureDelta, 2, `${kind} ${outcome} has exactly two model requests`);
    const firstInput = JSON.stringify(fixture.requests[fixtureStart]?.input?.messages ?? []);
    assert.doesNotMatch(firstInput, /operations that require approval are rejected automatically/i);
    if (kind.startsWith('expert')) assert.match(firstInput, /ScienceScope discussion expert/i);
    else assert.doesNotMatch(firstInput, /ScienceScope discussion expert/i);
    return { kind, outcome, approvalRequests: controlEvents.length, fixtureDelta };
  } finally {
    stopObserving();
    await host.interrupt(sessionId).catch(() => {});
    await rm(markerPath, { force: true });
  }
}

async function runExpertCancellation({ host, runtimeConfig, root, fixture }) {
  const kind = 'expert-cancel';
  const markerPath = path.join(root, `.sciencescope-local`, 'temp', `${kind}.marker`);
  await mkdir(path.dirname(markerPath), { recursive: true });
  const fixtureStart = fixture.requests.length;
  const runId = 'expert-cancel-run';
  const sessionId = await host.startSession({
    model: { providerId: 'fixture', modelId: 'fixture' },
    workspace: root,
    runtimeConfig,
  });
  await host.configurePolicy({ sessionId, approvalPolicy: 'ask', sandboxMode: 'workspace-write' });
  const approvalCancelled = deferred();
  const approvalEvents = [];
  let cancelPromise;
  const stopObserving = host.observeSession(sessionId, (frame) => {
    if (frame.type !== 'control-event') return;
    if (frame.event?.type === 'approval-request') {
      approvalEvents.push(frame.event);
      cancelPromise ??= host.cancelExperts({ sessionId, runId });
    }
    if (frame.event?.type === 'approval-cancelled') approvalCancelled.resolve(frame.event);
  });
  try {
    const result = await withTimeout(host.runExperts({
      sessionId,
      runId,
      prompt: `MARKER=${markerPath} Execute the shell command once, then answer FINAL_ACK.`,
      experts: [{ id: 'approval-expert', persona: 'You are an approval regression expert.' }],
      onEvent: () => {},
    }), `${kind} cancellation`);
    await withTimeout(cancelPromise ?? Promise.reject(new Error('expert cancellation was not requested')), `${kind} cancel request`);
    const cancelled = await withTimeout(approvalCancelled.promise, `${kind} approval-cancelled event`);
    assert.equal(approvalEvents.length, 1);
    assert.equal(approvalEvents[0].expertId, 'approval-expert');
    assert.equal(approvalEvents[0].runId, runId);
    assert.equal(cancelled.requestId, approvalEvents[0].requestId);
    assert.equal(result.length, 1);
    assert.equal(result[0].stopReason, 'aborted');
    assert.equal(result[0].text, '');
    await assertMarker(markerPath, false);
    assert.equal(fixture.requests.length - fixtureStart, 1, `${kind} stops after the tool request`);
    return { kind, approvalRequests: approvalEvents.length, fixtureDelta: fixture.requests.length - fixtureStart };
  } finally {
    stopObserving();
    await host.cancelExperts({ sessionId, runId }).catch(() => {});
    await host.interrupt(sessionId).catch(() => {});
    await rm(markerPath, { force: true });
  }
}

async function runConcurrentExpertDecisions({ host, runtimeConfig, root, fixture }) {
  const kind = 'expert-concurrent';
  const markers = {
    'approval-left': path.join(root, '.sciencescope-local', 'temp', `${kind}-left.marker`),
    'approval-right': path.join(root, '.sciencescope-local', 'temp', `${kind}-right.marker`),
  };
  await mkdir(path.dirname(markers['approval-left']), { recursive: true });
  const fixtureStart = fixture.requests.length;
  const runId = 'expert-concurrent-run';
  const decisions = new Map([['approval-left', 'allowed-once'], ['approval-right', 'rejected']]);
  const sessionId = await host.startSession({
    model: { providerId: 'fixture', modelId: 'fixture' },
    workspace: root,
    runtimeConfig,
  });
  await host.configurePolicy({ sessionId, approvalPolicy: 'ask', sandboxMode: 'workspace-write' });
  const approvalEvents = [];
  const replyPromises = [];
  const expertEvents = [];
  const stopObserving = host.observeSession(sessionId, (frame) => {
    if (frame.type !== 'control-event' || frame.event?.type !== 'approval-request') return;
    approvalEvents.push(frame.event);
    const outcome = decisions.get(frame.event.expertId);
    if (!outcome) throw new Error(`unexpected concurrent expert approval: ${frame.event.expertId}`);
    replyPromises.push(host.replyApproval({ sessionId, requestId: frame.event.requestId, outcome }));
  });
  try {
    const result = await withTimeout(host.runExperts({
      sessionId,
      runId,
      prompt: 'Concurrent approval fan-out; each expert must execute its own MARKER command once and answer FINAL_ACK.',
      experts: [
        { id: 'approval-left', persona: 'You are the left concurrent approval regression expert.', prompt: `MARKER=${markers['approval-left']}` },
        { id: 'approval-right', persona: 'You are the right concurrent approval regression expert.', prompt: `MARKER=${markers['approval-right']}` },
      ],
      onEvent: (event) => expertEvents.push(event),
    }), `${kind} decisions`);
    await Promise.all(replyPromises);
    assert.equal(approvalEvents.length, 2, `${kind} emitted one request per expert`);
    assert.deepEqual(new Set(approvalEvents.map((event) => event.expertId)), new Set(decisions.keys()));
    for (const event of approvalEvents) {
      assert.equal(event.runId, runId);
      assert.equal(event.toolName.match(/(?:pwsh|bash|shell)/i) !== null, true);
    }
    assert.equal(result.length, 2);
    for (const expertId of decisions.keys()) {
      const entry = result.find((candidate) => candidate.expertId === expertId);
      assert.ok(entry, `${kind} returned ${expertId}`);
      assert.equal(entry.stopReason, 'completed');
      assert.equal(entry.text, 'FINAL_ACK');
      const tool = expertEvents.find((event) => event.type === 'expert-tool' && event.expertId === expertId);
      const toolResult = expertEvents.find((event) => event.type === 'expert-tool-result' && event.expertId === expertId);
      assert.ok(tool, `${kind} emitted tool for ${expertId}`);
      assert.ok(toolResult, `${kind} emitted tool result for ${expertId}`);
      assert.equal(toolResult.callId, tool.callId);
      assert.equal(toolResult.isError, decisions.get(expertId) === 'rejected');
      assert.equal(typeof toolResult.resultPreview, 'string');
      assert.match(tool.argumentsPreview, new RegExp(path.basename(markers[expertId]).replace('.', '\\.'), 'u'));
      await assertMarker(markers[expertId], decisions.get(expertId) === 'allowed-once');
    }
    assert.equal(fixture.requests.length - fixtureStart, 4, `${kind} has two model requests per expert`);
    return { kind, approvalRequests: approvalEvents.length, fixtureDelta: fixture.requests.length - fixtureStart };
  } finally {
    stopObserving();
    await host.cancelExperts({ sessionId, runId }).catch(() => {});
    await host.interrupt(sessionId).catch(() => {});
    await Promise.all(Object.values(markers).map((marker) => rm(marker, { force: true })));
  }
}

test('real DSH approval decisions cover Main and expert child shell execution', { timeout: 180_000 }, async () => {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'expert-approval-runtime-'));
  const { fixture, requests } = await startFixture();
  const host = await createDshHost({
    home: root,
    cwd: root,
    sessionHeaders: ['x-sciencescope-approval-fixture'],
    env: { SCIENCESCOPE_OFFLINE_KEY: 'fixture' },
  });
  try {
    const runtimeConfig = fixtureRuntimeConfig(fixture.address().port);
    const outcomes = [];
    for (const [kind, outcome] of [['main-allowed', 'allowed-once'], ['main-rejected', 'rejected'], ['expert-allowed', 'allowed-once'], ['expert-rejected', 'rejected']]) {
      outcomes.push(await runDecision({ host, runtimeConfig, root, fixture: { requests }, kind, outcome }));
    }
    outcomes.push(await runExpertCancellation({ host, runtimeConfig, root, fixture: { requests } }));
    outcomes.push(await runConcurrentExpertDecisions({ host, runtimeConfig, root, fixture: { requests } }));
    assert.equal(outcomes.slice(0, 4).every((outcome) => outcome.fixtureDelta === 2), true);
    console.log(JSON.stringify({ passed: true, outcomes }));
  } finally {
    await host.close();
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
