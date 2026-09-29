import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopApi } from '../scripts/desktop-api.mjs';
import { ChatStore } from '../scripts/chat-store.mjs';
import { createAssistantConversations } from '../scripts/assistant-conversations.mjs';
import { createAssistantChatService } from '../scripts/assistant-chat-service.mjs';


function serveApi(api) {
  const server = createServer((request, response) => api.handle(request, response));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const call = (method, route, body) => new Promise((done, reject) => {
      const raw = body === undefined ? '' : JSON.stringify(body);
      const request = httpRequest({ hostname: '127.0.0.1', port, path: route, method,
        headers: { host: `127.0.0.1:${port}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) }) } }, (response) => {
        let text = ''; response.on('data', (chunk) => { text += chunk; }); response.on('end', () => {
          try { done({ status: response.statusCode, body: text ? JSON.parse(text) : null }); }
          catch { done({ status: response.statusCode, text }); }
        });
      });
      request.on('error', reject); request.end(raw);
    });
    resolve({ call, close: () => new Promise((done) => server.close(done)) });
  }));
}

test('an existing chat ignores a stale creation pythonEnvId after an explicit binding change', async () => {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'python-application-wiring-'));
  const starts = [], releases = [];
  let goal = { id: 'goal-stale-env', revision: 1, phase: 'active', activation: 'armed', roundsStarted: 1 };
  const host = {
    capabilities: { tokenStreaming: true },
    async listProviders() { return []; },
    async getRuntimeConfig() { return {}; },
    setToolHandler(handler) { this.toolHandler = handler; },
    observeSession() { return () => {}; },
    async startSession(options) { starts.push(options); return options.sessionId ?? 'session-python-binding'; },
    async releaseSession(sessionId) { releases.push(sessionId); },
    async configurePolicy() {}, async configureReasoning() {}, async configureBrief() {},
    async getGoal() { return goal; },
    async pauseGoal() { goal = { ...goal, revision: goal.revision + 1, phase: 'paused', activation: 'disarmed' }; return goal; },
    async clearGoal() { goal = null; },
    async send({ onEvent }) { onEvent({ type: 'completed', text: 'Fixture answer' }); },
    async close() {},
  };
  const api = await createDesktopApi({
    dataRoot: root,
    runtimeHost: host,
    pythonOptions: { runner: async (_command, args) => {
      if(args[0]==='--version')return { code: 0, stdout: 'Python 3.13.11', stderr: '' };
      if(args[1]==='compile'){await writeFile(args[args.indexOf('--output-file')+1],await readFile(args[2],'utf8'));return {code:0,stdout:'',stderr:''};}
      if(args[1]==='sync')return {code:0,stdout:'',stderr:''};
      if(args[0]!=='venv')throw new Error(`unexpected uv fixture operation: ${args.join(' ')}`);
      const scripts = path.join(args.at(-1), process.platform === 'win32' ? 'Scripts' : 'bin');
      await mkdir(scripts, { recursive: true });
      await writeFile(path.join(scripts, process.platform === 'win32' ? 'python.exe' : 'python'), 'fixture interpreter');
      return { code: 0, stdout: '', stderr: '' };
    } },
  });
  const server = await serveApi(api);
  try {
    const environmentA = await server.call('POST', '/api/python/envs', { action: 'create', name: 'A', version: '3.13.11' });
    const environmentB = await server.call('POST', '/api/python/envs', { action: 'create', name: 'B', version: '3.13.11' });
    assert.equal(environmentA.status, 200, JSON.stringify(environmentA));
    assert.equal(environmentB.status, 200, JSON.stringify(environmentB));
    const manifest = await server.call('POST', '/api/python/export', { envId: environmentA.body.id });
    assert.equal(manifest.status, 200);
    assert.equal(manifest.body.path, path.join(root, '.sciencescope-local', 'exports', 'python', environmentA.body.id, 'requirements.txt'));
    const staleCreationChoice = environmentA.body.id;
    const selected = environmentB.body.id;
    const send = (suffix) => server.call('POST', '/api/chat', {
      projectId: null, chatId: 'python-chat', text: `Turn ${suffix}`, userMessageId: `python-user-${suffix}`,
      assistantMessageId: `python-answer-${suffix}`, model: { providerId: 'fixture', modelId: 'fixture' },
      pythonEnvId: staleCreationChoice,
    });

    assert.equal((await send('one')).status, 200);
    assert.equal(starts[0].sessionEnv.env.VIRTUAL_ENV, path.join(root, '.sciencescope-local', 'python', 'envs', staleCreationChoice));
    await assert.rejects(host.toolHandler({
      sessionId: starts[0].sessionId, name: 'python_env_install',
      args: { packages: ['tabulate>=0.9'], reason: 'Need a readable table' },
    }), (error) => error.code === 'APPROVAL_UNAVAILABLE' && error.status === 503);
    let approval;
    host.requestApplicationApproval = async (request) => { approval = request; return false; };
    const installCall = new AbortController();
    const denied = await host.toolHandler({
      sessionId: starts[0].sessionId, name: 'python_env_install', expertId: 'reviewer',
      args: { packages: ['tabulate>=0.9'], reason: 'Need a readable table' }, signal: installCall.signal,
    });
    assert.deepEqual({ toolName: approval.toolName, packages: approval.packages, reason: approval.reason, targetEnvironment: approval.targetEnvironment, expertId: approval.expertId }, {
      toolName: 'python_env_install', packages: ['tabulate>=0.9'], reason: 'Need a readable table', targetEnvironment: 'A', expertId: 'reviewer',
    });
    assert.equal(approval.signal, installCall.signal, 'the DSH tool execution signal reaches the application approval waiter');
    assert.equal(denied.installed, false);
    assert.deepEqual(denied.requestedPackages,['tabulate>=0.9']);
    host.requestApplicationApproval=async()=>true;
    const installed=await host.toolHandler({sessionId:starts[0].sessionId,name:'python_env_install',args:{packages:['tabulate>=0.9'],reason:'Need a readable table'}});
    assert.deepEqual(installed,{installed:true,envId:environmentA.body.id,requestedPackages:['tabulate>=0.9'],environmentPackages:['tabulate>=0.9']});
    const bound = await server.call('POST', '/api/python/bind', { scope: 'chat', targetId: 'python-chat', envId: selected });
    assert.equal(bound.status, 200);

    assert.equal((await send('two')).status, 200);
    assert.equal(starts.length, 2);
    assert.equal(starts[1].sessionId, starts[0].sessionId, 'the DSH history identity is retained');
    assert.equal(starts[1].sessionEnv.env.VIRTUAL_ENV, path.join(root, '.sciencescope-local', 'python', 'envs', selected));
    assert.deepEqual(releases, [starts[0].sessionId]);

    await server.call('POST', '/api/python/bind', { scope: 'chat', targetId: 'python-chat', envId: staleCreationChoice });
    assert.equal((await server.call('POST', '/api/execution/goal', { chatId: 'python-chat', action: 'pause' })).status, 200);
    assert.equal((await server.call('POST', '/api/execution/goal', { chatId: 'python-chat', action: 'stop' })).status, 200);
    assert.deepEqual(releases, [starts[0].sessionId], 'pause/stop must not refresh/release solely because Python binding differs');
  } finally {
    await api.close(); await server.close(); await rm(root, { recursive: true, force: true });
  }
});

test('assistant sessions refresh the same DSH history and name the active Python environment in the brief', async () => {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'python-assistant-brief-'));
  const starts = [], releases = [], briefs = [], appliedEnv = new Map();
  let environment = 'A';
  const host = {
    async startSession({ sessionId }) { const id = sessionId ?? 'session-assistant-python'; starts.push(id); appliedEnv.set(id, environment); return id; },
    async getRuntimeConfig() { return {}; },
    async configurePolicy() {}, async configureReasoning() {},
    async configureBrief({ text }) { briefs.push(text); },
    observeSession() { return () => {}; },
    async send({ onEvent }) { onEvent({ type: 'completed', text: 'assistant answer' }); },
    async releaseSession(sessionId) { releases.push(sessionId); },
  };
  const chatStore = await new ChatStore({ stateDir: root }).init();
  const conversations = createAssistantConversations({ chatStore });
  const service = createAssistantChatService({
    host, conversations, chatStore, dataRoot: root,
    needsPythonRefresh: async (sessionId) => appliedEnv.get(sessionId) !== environment,
    pythonContextBrief: async () => `Current Python environment: ${environment} (managed). Use python_env_install for packages.`,
    startContextSession: async (options) => host.startSession(options),
  });
  try {
    await service.send({ scope: 'global', ownerId: 'global', model: { providerId: 'fixture', modelId: 'fixture' }, text: 'first', userMessageId: 'assistant-python-1' }, { accept() {}, emit() {} });
    const chat = conversations.get('global', 'global');
    const sessionId = chatStore.getBinding(chat.chatId);
    assert.match(briefs.at(-1), /Current Python environment: A \(managed\)[\s\S]*python_env_install/u);

    environment = 'B';
    await service.send({ scope: 'global', ownerId: 'global', model: { providerId: 'fixture', modelId: 'fixture' }, text: 'second', userMessageId: 'assistant-python-2' }, { accept() {}, emit() {} });
    assert.deepEqual(starts, [sessionId, sessionId], 'the resumed DSH session id is unchanged');
    assert.deepEqual(releases, [sessionId]);
    assert.match(briefs.at(-1), /Current Python environment: B \(managed\)[\s\S]*python_env_install/u);
  } finally { await service.close(); chatStore.close(); await rm(root, { recursive: true, force: true }); }
});
