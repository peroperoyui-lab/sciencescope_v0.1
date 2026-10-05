// Opt-in local end-to-end acceptance. Reads two already-installed real Python
// environments, copies their registry DB into a fixture app DB only if absent,
// and uses a local fake OpenAI-compatible endpoint (no paid calls/downloads).
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, copyFile, access, writeFile, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createDesktopApi } from './desktop-api.mjs';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';

const run = promisify(execFile);
const rootArgument=process.argv.indexOf('--root');
if(rootArgument<0)throw new Error('Pass a successful python-env-local-smoke directory with --root');
const validationRoot = path.resolve(process.argv[rootArgument+1]);
const relative=path.relative(path.resolve('.sciencescope-local/temp'),validationRoot);
if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Use an owned project-temp fixture');
const prepared=JSON.parse(await readFile(path.join(validationRoot,'result.json'),'utf8'));
assert.equal(prepared.checks.passed,true);
const environmentAId=prepared.builtin.id,environmentBId=prepared.copy.id;
const environmentRoot = path.join(validationRoot, '.sciencescope-local', 'python', 'envs');
const environmentA = path.join(environmentRoot, environmentAId);
const environmentB = path.join(environmentRoot, environmentBId);
const python = (env) => path.join(env, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const scripts = (env) => path.dirname(python(env));
for (const env of [environmentA, environmentB]) {
  const { stdout } = await run(python(env), ['-c', 'import sys; print(sys.prefix)'], { windowsHide: true });
  assert.equal(path.resolve(stdout.trim()), path.resolve(env), `real interpreter prefix for ${env}`);
}

const sourceDb = path.join(validationRoot, 'environments.sqlite');
const appState = path.join(validationRoot, '.sciencescope-local', 'state');
const appDbPath = path.join(appState, 'sciencescope.sqlite');
await mkdir(appState, { recursive: true });
let copiedRegistryDb = false;
try { await access(appDbPath, constants.F_OK); }
catch (error) { if (error.code !== 'ENOENT') throw error; await copyFile(sourceDb, appDbPath, constants.COPYFILE_EXCL); copiedRegistryDb = true; }
const registryCheck = new DatabaseSync(appDbPath, { readOnly: true });
for (const id of [environmentAId,environmentBId]) {
  assert.equal(registryCheck.prepare('SELECT status FROM python_envs WHERE id=?').get(id)?.status, 'ready', `fixture app DB has ready ${id}`);
}
registryCheck.close();

const tempRoot = path.resolve('.sciencescope-local/temp');
await mkdir(tempRoot, { recursive: true });
const home = path.join(tempRoot, `python-goal-env-runtime-${process.pid}-${Date.now()}`);
await mkdir(home, { recursive: true });
const chatId = `python-goal-runtime-${process.pid}`;
const sessionId = `session-pythonGoalEnvRuntime${process.pid}`;
const model = { providerId: 'fixture', modelId: 'fixture' };
const fixtureRequests = [];
const shellSnapshots = [];
let shellCalls = 0;
let releaseFirstModelRequest;
let firstModelRequestSeen;
const firstModelRequestSeenPromise = new Promise((resolve) => { firstModelRequestSeen = resolve; });
const firstModelGate = new Promise((resolve) => { releaseFirstModelRequest = resolve; });
let gateFirstModelRequest = true;
const firstResponse = (payload, finishReason) => `data: ${JSON.stringify(payload)}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`;
const fixture = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const input = JSON.parse(raw);
  fixtureRequests.push(input);
  const last = input.messages?.at(-1);
  if (last?.role === 'tool') {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(firstResponse({ choices: [{ delta: { content: `RUNTIME_PREFIX_${shellCalls}: ${String(last.content)} HISTORY_TOKEN` } }] }, 'stop'));
    return;
  }
  const tool = (input.tools ?? []).find((entry) => /(?:pwsh|bash|shell)$/iu.test(entry.function?.name ?? ''));
  assert.ok(tool, 'the Main DSH session exposes its normal shell tool');
  const properties = tool.function.parameters?.properties ?? {};
  const commandKey = Object.keys(properties).find((key) => /command|cmd|script/iu.test(key)) ?? Object.keys(properties)[0];
  const args = { [commandKey]: 'python -c "import sys; print(sys.prefix)"', description: 'Read sys.prefix for the active Python environment' };
  shellCalls += 1;
  shellSnapshots.push(JSON.stringify(input.messages));
  if (gateFirstModelRequest) { gateFirstModelRequest = false; firstModelRequestSeen(); await firstModelGate; }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(firstResponse({ choices: [{ delta: { tool_calls: [{ index: 0, id: `prefix-${shellCalls}`, type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(args) } }] } }] }, 'tool_calls'));
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const runtimeConfig = { providers: { fixture: {
  api: 'openai-completions', baseURL: `http://127.0.0.1:${fixture.address().port}/v1`, apiKeyEnv: 'SCIENCESCOPE_OFFLINE_KEY',
  models: [{ id: 'fixture', contextWindow: 32768, maxTokens: 256 }],
} } };
const starts = [];
const apiErrors = [];
const host = await createDshHost({ home: path.join(home, 'dsh'), cwd: validationRoot, sessionHeaders: ['x-fixture'], env: { SCIENCESCOPE_OFFLINE_KEY: 'local-fixture' } });
host.getRuntimeConfig = async () => runtimeConfig;
host.listProviders = async () => [{ id: 'fixture', models: [{ id: 'fixture' }] }];
const originalStartSession = host.startSession;
host.startSession = async (options) => {
  const id = await originalStartSession(options);
  starts.push({ sessionId: id, virtualEnv: options.sessionEnv?.env?.VIRTUAL_ENV ?? null });
  return id;
};
let api;
let apiClosed = false;
let server;
const observed = [];

function serve(apiHandle) {
  const http = createServer((request, response) => apiHandle.handle(request, response));
  return new Promise((resolve) => http.listen(0, '127.0.0.1', () => {
    const call = (method, route, body) => new Promise((done, reject) => {
      const raw = body === undefined ? '' : JSON.stringify(body);
      const outgoing = httpRequest({ hostname: '127.0.0.1', port: http.address().port, path: route, method,
        headers: { host: `127.0.0.1:${http.address().port}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) }) } }, (response) => {
        let text = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { text += chunk; }); response.on('end', () => {
          try { done({ status: response.statusCode, body: text ? JSON.parse(text) : null, text }); }
          catch { done({ status: response.statusCode, body: null, text }); }
        });
      });
      outgoing.on('error', reject); outgoing.end(raw);
    });
    resolve({ call, close: () => new Promise((done) => http.close(done)) });
  }));
}

try {
  api = await createDesktopApi({ dataRoot: validationRoot, runtimeHost: host, pythonOptions: {}, onError: (error) => apiErrors.push({ name: error?.name, code: error?.code, message: String(error?.message ?? error) }) });
  server = await serve(api);
  const originalObserve = host.observeSession.bind(host);
  host.observeSession = (id, handler) => originalObserve(id, (frame) => { observed.push(frame); handler(frame); });

  const initial = await server.call('POST', '/api/chat', {
    projectId: null, chatId, text: 'For each round run python and report sys.prefix; include HISTORY_TOKEN. Continue for two rounds.',
    userMessageId: 'goal-env-user-1', assistantMessageId: 'goal-env-assistant-1', model,
    pythonEnvId: environmentAId, executionMode: 'auto', goalMaxRounds: 2,
  });
  assert.equal(initial.status, 200, initial.text);
  await Promise.race([
    firstModelRequestSeenPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('auto goal did not start its first local model request')), 30000)),
  ]);

  // The UI binding API is the production trigger: it schedules the host pause
  // while the first real DSH round is actively waiting on its fake model.
  const bound = await server.call('POST', '/api/python/bind', { scope: 'chat', targetId: chatId, envId: environmentBId });
  assert.equal(bound.status, 200, JSON.stringify(bound));
  releaseFirstModelRequest();

  const deadline = Date.now() + 60000;
  let status;
  while (Date.now() < deadline) {
    status = await server.call('GET', `/api/execution?chatId=${encodeURIComponent(chatId)}`);
    if (status.body?.goal?.phase === 'blocked') break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.equal(status?.body?.goal?.phase, 'blocked', `two-round goal did not settle: ${JSON.stringify(status?.body)}`);
  assert.equal(status.body.goal.roundsStarted, 2, 'exactly two goal rounds were admitted');
  assert.equal(starts.length, 2, 'the production API refreshed exactly once');
  assert.equal(starts[0].sessionId, starts[1].sessionId, 'the DSH history identity survived release/restart');
  assert.equal(path.resolve(starts[0].virtualEnv), path.resolve(environmentA));
  assert.equal(path.resolve(starts[1].virtualEnv), path.resolve(environmentB));
  assert.equal(shellCalls, 2, 'the normal shell tool ran once in each round');
  assert.ok(shellSnapshots[1]?.includes('HISTORY_TOKEN'), 'round two received persisted round-one history');

  await server.close(); server = null;
  await api.close(); apiClosed = true;
  const db = new DatabaseSync(appDbPath, { readOnly: true });
  const messages = db.prepare('SELECT role,text FROM messages WHERE chat_id=? ORDER BY ordinal').all(chatId);
  db.close();
  const assistantMessages = messages.filter((row) => row.role === 'assistant');
  assert.equal(assistantMessages.length, 2, 'both completed turn replies were persisted by desktop-api/execution-service');
  assert.match(assistantMessages[0].text, new RegExp(environmentA.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
  assert.match(assistantMessages[1].text, new RegExp(environmentB.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
  const refreshEvent = observed.map((frame) => frame.event).find((event) => event?.type === 'python-env-refresh-ready') ?? null;
  assert.ok(refreshEvent, 'real session-control emitted its environment-refresh checkpoint');
  assert.equal(refreshEvent.goal.roundsStarted, 1, 'pause acknowledgement occurred before round two admission');
  const result = {
    status: 'passed', sessionId:starts[0].sessionId, environmentA, environmentB, copiedRegistryDb,
    goal: { phase: status.body.goal.phase, roundsStarted: status.body.goal.roundsStarted },
    starts, assistantMessages, modelRequestCount: fixtureRequests.length, shellRoundCount: shellCalls,
    sameSessionId: starts[0].sessionId === starts[1].sessionId, refreshEvent,
  };
  await writeFile(path.join(home, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, sessionId, roundsStarted: result.goal.roundsStarted, shellRoundCount: shellCalls, persistedAssistantMessages: assistantMessages.length, sameSessionId: result.sameSessionId, resultPath: path.join(home, 'result.json') }));
} catch (error) {
  await writeFile(path.join(home, 'failure.json'), JSON.stringify({ name: error.name, message: error.message, sessionId, shellCalls, starts, apiErrors, observed }, null, 2));
  throw error;
} finally {
  releaseFirstModelRequest();
  if (server) await server.close();
  if (api && !apiClosed) await api.close();
  else await host.close();
  fixture.closeAllConnections();
  await new Promise((resolve) => fixture.close(resolve));
}
