import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';
import { createSessionProcessEnv, normalizeSessionEnv, sessionEnvSignature } from '../adapters/runtime-dsh/session-env.mjs';
import { createApplicationApprovalManager } from '../adapters/runtime-dsh/application-approval.mjs';

test('session environment prepends PATH and copies rather than mutating the host environment', () => {
  const base = { PATH: '/usr/bin:/bin', UV_CACHE_DIR: '/host/cache', SCIENCESCOPE_STREAM_TOKEN: 'host-token' };
  const result = createSessionProcessEnv(base, {
    pathPrepend: ['/managed/Scripts'],
    env: { VIRTUAL_ENV: '/managed', UV_CACHE_DIR: '/app/cache', UV_NO_CONFIG: '1' },
  }, { platform: 'linux' });

  assert.equal(result.PATH, '/managed/Scripts:/usr/bin:/bin');
  assert.equal(result.VIRTUAL_ENV, '/managed');
  assert.equal(result.UV_CACHE_DIR, '/app/cache');
  assert.equal(result.UV_NO_CONFIG, '1');
  assert.equal(result.SCIENCESCOPE_STREAM_TOKEN, 'host-token');
  assert.deepEqual(base, { PATH: '/usr/bin:/bin', UV_CACHE_DIR: '/host/cache', SCIENCESCOPE_STREAM_TOKEN: 'host-token' });
});

test('session environment rejects host controls, raw PATH, unknown keys, and case aliases', () => {
  for (const env of [
    { SCIENCESCOPE_STREAM_TOKEN: 'model-controlled' },
    { sciencescope_provider: 'model-controlled' },
    { Path: 'C:\\evil' },
    { NODE_OPTIONS: '--require evil' },
    { PIP_CONFIG_FILE: '' },
    { VIRTUAL_ENV: 'one', virtual_env: 'two' },
  ]) assert.throws(() => normalizeSessionEnv({ env }), /SCIENCESCOPE|PATH|not allowed|duplicated/u);
});

test('Windows PATH aliases are collapsed and session variable names are canonicalized', () => {
  const result = createSessionProcessEnv({ Path: 'C:\\Windows\\System32', PATH: 'C:\\tools' }, {
    pathPrepend: ['C:\\env\\Scripts'],
    env: { virtual_env: 'C:\\env', uv_link_mode: 'hardlink' },
  }, { platform: 'win32' });

  assert.equal(result.PATH, 'C:\\env\\Scripts;C:\\tools');
  assert.equal(Object.keys(result).filter((key) => key.toLowerCase() === 'path').length, 1);
  assert.equal(result.VIRTUAL_ENV, 'C:\\env');
  assert.equal(result.UV_LINK_MODE, 'hardlink');
  assert.equal(sessionEnvSignature({ env: { uv_no_config: '1', virtual_env: 'x' } }), sessionEnvSignature({ env: { VIRTUAL_ENV: 'x', UV_NO_CONFIG: '1' } }));
});

test('application approval replies are session-bound and resolve the tool request', async () => {
  const events = [];
  const manager = createApplicationApprovalManager({
    isSessionActive: (sessionId) => sessionId === 'session-active',
    emit: (sessionId, event) => events.push({ sessionId, frame: { type: 'control-event', event } }),
    createRequestId: () => 'approval-id',
  });
  const approved = manager.request({
    sessionId: 'session-active', toolName: 'python_env_install', reason: 'Need table formatting',
    packages: ['tabulate>=0.9'], targetEnvironment: 'built-in-analysis', expertId: 'statistician',
  });
  const request = events[0].frame.event;
  assert.equal(request.type, 'approval-request');
  assert.equal(request.requestId, 'app-approvalid');
  assert.deepEqual(request.packages, ['tabulate>=0.9']);
  assert.equal(request.targetEnvironment, 'built-in-analysis');
  assert.equal(request.expertId, 'statistician');
  assert.throws(() => manager.reply({ sessionId: 'another-session', requestId: request.requestId, outcome: 'allowed-once' }), /another session/u);
  assert.equal(manager.reply({ sessionId: 'session-active', requestId: request.requestId, outcome: 'allowed-once' }), true);
  assert.equal(await approved, true);
});

test('application approval cancellation resolves false and notifies existing observers', async () => {
  const events = [];
  let nextId = 0;
  const manager = createApplicationApprovalManager({
    isSessionActive: (sessionId) => sessionId === 'session-active',
    emit: (sessionId, event) => events.push({ sessionId, event }),
    createRequestId: () => `request-${++nextId}`,
  });
  const mainRequest = manager.request({ sessionId: 'session-active', toolName: 'python_env_install', reason: 'install', packages: ['pandas'], targetEnvironment: 'env-a' });
  const expertRequest = manager.request({ sessionId: 'session-active', toolName: 'python_env_install', reason: 'install', packages: ['numpy'], targetEnvironment: 'env-a', expertId: 'reviewer' });
  const mainId = events[0].event.requestId;
  const expertId = events[1].event.requestId;

  manager.cancelExperts('session-active', ['reviewer']);
  assert.equal(await expertRequest, false);
  assert.equal(events.at(-1).event.type, 'approval-cancelled');
  assert.equal(events.at(-1).event.requestId, expertId);
  manager.cancelSession('session-active', 'session interrupted');
  assert.equal(await mainRequest, false);
  assert.equal(events.at(-1).event.requestId, mainId);
  assert.throws(() => manager.request({ sessionId: 'missing', toolName: 'python_env_install', reason: 'install', packages: [], targetEnvironment: 'env-a' }), /Unknown DSH session/u);
});

test('application approval cancellation follows the DSH tool-call abort and rejects late user approval', async () => {
  const events = [];
  const manager = createApplicationApprovalManager({
    isSessionActive: () => true,
    emit: (_sessionId, event) => events.push(event),
    createRequestId: () => 'abort-request',
  });
  const controller = new AbortController();
  const pending = manager.request({
    sessionId: 'session-abort', toolName: 'python_env_install', reason: 'Install a package',
    packages: ['pandas'], targetEnvironment: 'analysis', signal: controller.signal,
  });
  const requestId = events[0].requestId;
  controller.abort();
  assert.equal(await pending, false);
  assert.deepEqual(events.map((event) => event.type), ['approval-request', 'approval-cancelled']);
  assert.throws(() => manager.reply({ sessionId: 'session-abort', requestId, outcome: 'allowed-once' }), /Unknown or expired/u);
});

test('DSH session release and same-id restart applies the new Python environment and restores history', async () => {
  const testRoot = path.resolve('.sciencescope-local/temp');
  await mkdir(testRoot, { recursive: true });
  const home = await mkdtemp(path.join(testRoot, 'session-env-switch-'));
  const requests = [];
  const fixture = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const toolMessage = input.messages?.find((message) => message.role === 'tool');
    const content = input.messages?.filter((message) => message.role === 'user').map((message) => message.content).join('\n') ?? '';
    if (!toolMessage && !content.includes('RUN_ENV_CHECK')) {
      response.end('data: {"choices":[{"delta":{"content":"HISTORY_ACK"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      return;
    }
    if (!toolMessage) {
      const shellTool = (input.tools ?? []).find((tool) => /(?:pwsh|bash|shell)$/iu.test(tool.function?.name ?? ''));
      assert.ok(shellTool, 'the test runtime exposes its normal local shell tool');
      const commandKey = Object.keys(shellTool.function.parameters?.properties ?? {}).find((key) => /command|cmd|script/iu.test(key))
        ?? Object.keys(shellTool.function.parameters?.properties ?? {})[0];
      const command = process.platform === 'win32' ? 'Write-Output $env:VIRTUAL_ENV' : 'printf "%s\\n" "$VIRTUAL_ENV"';
      const args = { [commandKey]: command, description: 'Read this session’s Python environment' };
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'env-check', type: 'function', function: { name: shellTool.function.name, arguments: JSON.stringify(args) } }] } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n`);
      return;
    }
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `ENV_CHECK_DONE:${toolMessage.content}` } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const host = await createDshHost({ home, cwd: home, sessionHeaders: ['x-fixture'], env: { SCIENCESCOPE_OFFLINE_KEY: 'fixture' } });
  const runtimeConfig = { providers: { fixture: {
    api: 'openai-completions', baseURL: `http://127.0.0.1:${fixture.address().port}/v1`, apiKeyEnv: 'SCIENCESCOPE_OFFLINE_KEY',
    models: [{ id: 'fixture', contextWindow: 32768, maxTokens: 256 }],
  } } };
  const sessionId = 'session-environmentswitch';
  try {
    const firstEnv = { pathPrepend: [], env: { VIRTUAL_ENV: path.join(home, 'env-one') } };
    await host.startSession({ sessionId, model: { providerId: 'fixture', modelId: 'fixture' }, workspace: home, runtimeConfig, sessionEnv: firstEnv });
    await host.configurePolicy({ sessionId, approvalPolicy: 'never', sandboxMode: 'danger-full-access' });
    await host.send({ sessionId, text: 'Remember HISTORY_SENTINEL.' });
    const approvalEvents = [];
    const stopObserving = host.observeSession(sessionId, (frame) => approvalEvents.push(frame));
    const installApproval = host.requestApplicationApproval({
      sessionId, toolName: 'python_env_install', reason: 'Need a plotting dependency', packages: ['seaborn'],
      targetEnvironment: 'analysis-env',
    });
    const installRequest = approvalEvents.at(-1).event;
    assert.match(installRequest.requestId, /^app-/u);
    assert.equal(await host.replyApproval({ sessionId, requestId: installRequest.requestId, outcome: 'allowed-once' }), true);
    assert.equal(await installApproval, true);
    const cancelledApproval = host.requestApplicationApproval({
      sessionId, toolName: 'python_env_install', reason: 'Need another dependency', packages: ['tabulate'],
      targetEnvironment: 'analysis-env',
    });
    const cancelledRequest = approvalEvents.at(-1).event;
    await assert.rejects(
      host.startSession({ sessionId, model: { providerId: 'fixture', modelId: 'fixture' }, workspace: home, runtimeConfig, sessionEnv: { env: { VIRTUAL_ENV: path.join(home, 'env-two') } } }),
      (error) => error.code === 'SESSION_ENV_CHANGED_RELEASE_REQUIRED',
    );

    await host.releaseSession(sessionId);
    assert.equal(await cancelledApproval, false);
    assert.ok(approvalEvents.some((frame) => frame.event?.type === 'approval-cancelled' && frame.event.requestId === cancelledRequest.requestId));
    stopObserving();
    await host.startSession({ sessionId, model: { providerId: 'fixture', modelId: 'fixture' }, workspace: home, runtimeConfig, sessionEnv: { pathPrepend: [], env: { VIRTUAL_ENV: path.join(home, 'env-two') } } });
    await host.configurePolicy({ sessionId, approvalPolicy: 'never', sandboxMode: 'danger-full-access' });
    const envCheck = await host.send({ sessionId, text: 'RUN_ENV_CHECK' });

    const resumedInput = requests.find((input) => input.messages?.some((message) => message.role === 'user' && String(message.content).includes('RUN_ENV_CHECK')));
    assert.ok(resumedInput);
    assert.match(JSON.stringify(resumedInput.messages), /HISTORY_SENTINEL/u, 'the DSH history survives release and same-id restart');
    assert.match(envCheck.finalResponse, new RegExp(path.join(home, 'env-two').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
    assert.doesNotMatch(envCheck.finalResponse, new RegExp(path.join(home, 'env-one').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
  } finally {
    await host.close();
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
