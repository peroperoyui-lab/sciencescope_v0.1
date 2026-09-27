import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopApi } from '../scripts/desktop-api.mjs';

async function fixture(existingRoot = null) {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = existingRoot || await mkdtemp(path.join(base, 'role-settings-api-'));
  const state = { starts: [], personas: [], sessions: new Map(), gate: null, release: null };
  const host = {
    capabilities: { tokenStreaming: true, reasoningEffort: false },
    starts: state.starts,
    listProviders: async () => [], getRuntimeConfig: async () => ({}),
    observeSession: () => () => {},
    startSession: async (options) => {
      const sessionId = options.sessionId || `session-${state.starts.length + 1}`;
      state.starts.push({ ...options, sessionId }); state.sessions.set(sessionId, { history: [] });
      return sessionId;
    },
    configurePolicy: async () => {}, configureReasoning: async () => {},
    configurePersona: async ({ sessionId, persona }) => { state.personas.push({ sessionId, persona }); },
    getContextUsage: async () => null, getGoal: async () => null,
    sessionGoal: async () => null, releaseSession: async () => {}, close: async () => {},
    send: async ({ sessionId, text, onEvent }) => {
      state.sessions.get(sessionId).history.push(text);
      if (state.gate) await state.gate;
      onEvent({ type: 'completed', text: `reply:${text}` });
    },
  };
  const api = await createDesktopApi({ dataRoot: root, runtimeHost: host });
  const server = createServer((req, res) => api.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (route, body) => new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = httpRequest({ hostname: '127.0.0.1', port, path: route, method: 'POST', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text, body: text ? (res.headers['content-type']?.includes('ndjson') ? null : JSON.parse(text)) : null }));
    }); req.on('error', reject); req.end(raw);
  });
  const get = (route) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: route, method: 'GET', headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    }); req.on('error', reject); req.end();
  });
  return { root, state, host, call, get, close: async ({ remove = true } = {}) => { await api.close(); await new Promise((resolve) => server.close(resolve)); if (remove) await rm(root, { recursive: true, force: true }); } };
}

const input = (chatId, text, suffix = text) => ({ chatId, projectId: null, text, model: { providerId: 'fixture', modelId: 'fixture' }, userMessageId: `u-${suffix}`, assistantMessageId: `a-${suffix}` });

test('role settings API saves, binds, explicitly applies, rejects busy apply, and persists receipts', async () => {
  const f = await fixture();
  try {
    let result = await f.call('/api/roles/save', { role: 'main', config: { prompt: 'First main persona', model: null, reasoningEffort: null } });
    assert.equal(result.status, 200); assert.equal(result.body.revision, 1);
    result = await f.call('/api/chat', input('chat-main', 'first')); assert.equal(result.status, 200);
    assert.equal(f.state.starts[0].persona, 'First main persona');

    result = await f.call('/api/roles/save', { role: 'main', config: { prompt: 'Second main persona', model: null, reasoningEffort: null } });
    assert.equal(result.body.revision, 2); assert.equal(f.state.personas.length, 0);

    result = await f.call('/api/roles/apply', { role: 'main', chatId: 'chat-main' });
    assert.equal(result.status, 200); assert.equal(result.body.prompt, 'Second main persona');
    assert.deepEqual(f.state.personas, [{ sessionId: f.state.starts[0].sessionId, persona: 'Second main persona' }]);
    const messagesAfterApply = await f.get('/api/chats/chat-main/messages');
    assert.equal(messagesAfterApply.status, 200);
    assert.deepEqual(messagesAfterApply.body.messages.map((message) => message.text), ['first', 'reply:first']);
    const historyBeforeBusy = (await f.get('/api/roles/history?role=main&chatId=chat-main')).body.receipts;
    assert.equal(historyBeforeBusy.length, 1);

    let release; f.state.gate = new Promise((resolve) => { release = resolve; });
    const pending = f.call('/api/chat', input('chat-main', 'pending', 'pending'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    result = await f.call('/api/roles/apply', { role: 'main', chatId: 'chat-main' });
    assert.equal(result.status, 409); assert.equal(f.state.personas.length, 1);
    assert.equal((await f.get('/api/roles/history?role=main&chatId=chat-main')).body.receipts.length, 1);
    release(); f.state.gate = null; await pending;

    const roles = await f.get('/api/roles');
    assert.equal(roles.status, 200); assert.equal(roles.body.roles.find((role) => role.role === 'main').prompt, 'Second main persona');
    await f.close({ remove: false });
    const reopened = await fixture(f.root);
    try {
      const persisted = await reopened.get('/api/roles');
      assert.equal(persisted.body.roles.find((role) => role.role === 'main').prompt, 'Second main persona');
      const receipt = await reopened.get('/api/roles/history?role=main&chatId=chat-main');
      assert.equal(receipt.body.receipts.length, 1); assert.equal(receipt.body.receipts[0].revision, 2);
    } finally { await reopened.close(); }
  } finally {
    // The persistence assertion closes the original fixture before reopening it.
    if (f.state) { try { await f.close(); } catch {} }
  }
});
