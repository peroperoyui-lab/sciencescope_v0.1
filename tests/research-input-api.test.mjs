import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopApi } from '../scripts/desktop-api.mjs';

async function fixture() {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'research-input-api-'));
  const state = { sends: [], starts: 0, failSend: false };
  const host = {
    capabilities: { tokenStreaming: true, reasoningEffort: false },
    listProviders: async () => [],
    getRuntimeConfig: async () => ({}),
    getContextUsage: async () => null,
    observeSession: () => () => {},
    startSession: async ({ sessionId }) => { state.starts += 1; return sessionId || `session-${state.starts}`; },
    configureReasoning: async () => {}, configurePolicy: async () => {}, releaseSession: async () => {}, close: async () => {},
    send: async ({ text, onEvent }) => { state.sends.push(text); if (state.failSend) throw new Error('FIXTURE_SEND_FAILED'); onEvent({ type: 'completed', text: 'fixture complete' }); },
  };
  const api = await createDesktopApi({ dataRoot: root, runtimeHost: host });
  const server = createServer((req, res) => api.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (route, body) => new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = httpRequest({ hostname: '127.0.0.1', port, path: route, method: 'POST', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { const lines = text.trim() ? text.trim().split('\n') : []; resolve({ status: res.statusCode, text, body: lines.length === 1 ? JSON.parse(lines[0]) : null, events: lines.map(JSON.parse) }); });
    }); req.on('error', reject); req.end(raw);
  });
  const get = (route) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: route, method: 'GET', headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, text, body: text ? JSON.parse(text) : null }));
    }); req.on('error', reject); req.end();
  });
  return { root, state, call, get, close: async () => { await api.close(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); } };
}

const model = { providerId: 'fixture', modelId: 'fixture' };
const mainInput = (chatId, researchInput = {}) => ({ chatId, projectId: null, text: 'Compare the supplied evidence.', model, userMessageId: `user-${chatId}`, assistantMessageId: `assistant-${chatId}`, researchInput });

test('Main API compiles attachment, exact quote and comment without injecting the whole source message', async () => {
  const f = await fixture();
  try {
    const resource = await f.call('/api/library/import', { name: 'evidence.txt', base64: Buffer.from('ATTACHED_EVIDENCE').toString('base64') });
    assert.equal(resource.status, 200);
    const source = await f.call('/api/chat', mainInput('source-chat'));
    assert.equal(source.status, 200);
    const sourceId = 'user-source-chat';
    const annotation = { id: 'ann-1', revision: 0, resourceId: resource.body.id, selectedText: 'highlight', comment: 'check this' };
    const result = await f.call('/api/chat', mainInput('main-chat', {
      attachmentIds: [resource.body.id],
      annotations: [annotation],
      quotes: [{ sourceChatId: 'source-chat', sourceMessageId: sourceId, selectedText: 'Compare the supplied', comment: 'use this excerpt' }],
    }));
    assert.equal(result.status, 200, result.text);
    const sent = f.state.sends.at(-1);
    assert.match(sent, /ATTACHED_EVIDENCE/);
    assert.match(sent, /Compare the supplied/);
    assert.match(sent, /use this excerpt/);
    assert.doesNotMatch(sent, /evidence\.[\s\S]*fixture complete/);
    const messages = await f.get('/api/chats/main-chat/messages');
    const user = messages.body.messages.find((message) => message.id === 'user-main-chat');
    assert.deepEqual(user.researchInput.messageQuotes[0].selectedText, 'Compare the supplied');
    assert.equal(user.researchInput.messageQuotes[0].comment, 'use this excerpt');
  } finally { await f.close(); }
});

test('invalid Main research input fails before runtime start and keeps draft and imported file', async () => {
  const f = await fixture();
  try {
    const resource = await f.call('/api/library/import', { name: 'keep.txt', base64: Buffer.from('KEEP_FILE').toString('base64') });
    const annotation = { id: 'ann-keep', revision: 0, resourceId: resource.body.id, selectedText: 'keep' };
    await f.call('/api/research-input/draft', { scope: 'main', ownerId: 'main-chat', snapshot: { attachmentIds: [resource.body.id], annotations: [annotation], messageQuotes: [], contextRefs: [] } });
    const result = await f.call('/api/chat', mainInput('main-chat', { attachmentIds: [resource.body.id], annotations: [annotation], quotes: [{ sourceChatId: 'missing', sourceMessageId: 'missing', selectedText: 'nope' }] }));
    assert.notEqual(result.status, 200);
    assert.equal(f.state.starts, 0);
    const draft = await f.get('/api/research-input/draft?scope=main&ownerId=main-chat');
    assert.equal(draft.body.annotations[0].id, 'ann-keep');
    const file = path.join(f.root, '.sciencescope-local', 'library', 'originals', resource.body.id, 'keep.txt');
    assert.equal(await readFile(file, 'utf8'), 'KEEP_FILE');
  } finally { await f.close(); }
});

test('Main sends selected shared research items and blocks private items', async () => {
  const f = await fixture();
  try {
    const shared = await f.call('/api/research/items', { item: { type: 'memory', subtype: 'decision', scope: 'personal', title: 'Study endpoint', body: 'Use the Matsuda index.', visibility: 'shared' } });
    const sent = await f.call('/api/chat', mainInput('item-context-chat', { contextRefs: [{ itemId: shared.body.item.id }] }));
    assert.equal(sent.status, 200, sent.text);
    assert.match(f.state.sends.at(-1), /<research-item[^>]*Study endpoint/);
    assert.match(f.state.sends.at(-1), /Use the Matsuda index\./);
    const messages = await f.get('/api/chats/item-context-chat/messages');
    assert.deepEqual(messages.body.messages.find((message) => message.id === 'user-item-context-chat').researchInput.contextRefs, [{ itemId: shared.body.item.id }]);
    const usage = await f.get(`/api/research/usage?chatId=item-context-chat&messageId=assistant-item-context-chat`);
    assert.deepEqual(usage.body.refs, [{ type: 'item', id: shared.body.item.id, how: 'context' }]);

    const privateItem = await f.call('/api/research/items', { item: { type: 'memory', subtype: 'preference', scope: 'personal', title: 'Private note', body: 'Do not send.', visibility: 'private' } });
    const blocked = await f.call('/api/chat', mainInput('private-item-chat', { contextRefs: [{ itemId: privateItem.body.item.id }] }));
    assert.notEqual(blocked.status, 200);
    assert.doesNotMatch(f.state.sends.at(-1), /Do not send\./);
  } finally { await f.close(); }
});

test('assistant research input reuses compiler and secretary acceptance does not clear annotation draft', async () => {
  const f = await fixture();
  try {
    const resource = await f.call('/api/library/import', { name: 'secretary.txt', base64: Buffer.from('SECRETARY_FILE').toString('base64') });
    const annotation = { id: 'secretary-ann', revision: 0, resourceId: resource.body.id, selectedText: 'secretary' };
    const owner = await f.call('/api/chat', mainInput('main-chat'));
    assert.equal(owner.status, 200, owner.text);
    await f.call('/api/research-input/draft', { scope: 'secretary', ownerId: 'main-chat', snapshot: { attachmentIds: [resource.body.id], annotations: [annotation], messageQuotes: [], contextRefs: [] } });
    const result = await f.call('/api/assistant/chat', { scope: 'secretary', ownerId: 'main-chat', model, text: 'Read this.', researchInput: { attachmentIds: [resource.body.id], annotations: [annotation] } });
    assert.equal(result.status, 200, result.text);
    assert.match(f.state.sends.at(-1), /SECRETARY_FILE/);
    const draft = await f.get('/api/research-input/draft?scope=secretary&ownerId=main-chat');
    assert.equal(draft.body.annotations[0].id, 'secretary-ann');
  } finally { await f.close(); }
});

test('outbox rejects research input instead of enqueueing it', async () => {
  const f = await fixture();
  try {
    const result = await f.call('/api/chat/outbox', { action: 'enqueue', chatId: 'queued-chat', input: mainInput('queued-chat', { annotations: [{ id: 'a', revision: 0 }] }) });
    assert.notEqual(result.status, 200);
    assert.equal((await f.get('/api/chat/outbox?chatId=queued-chat')).body.items.length, 0);
  } finally { await f.close(); }
});

test('send failure after accepted restores research draft and keeps the imported original', async () => {
  const f = await fixture();
  try {
    const resource = await f.call('/api/library/import', { name: 'failed-send.txt', base64: Buffer.from('KEEP_AFTER_SEND_FAILURE').toString('base64') });
    const annotation = { id: 'ann-failed', revision: 0, resourceId: resource.body.id, selectedText: 'keep' };
    const snapshot = { attachmentIds: [resource.body.id], annotations: [annotation], messageQuotes: [], contextRefs: [] };
    await f.call('/api/research-input/draft', { scope: 'main', ownerId: 'failed-chat', snapshot });
    f.state.failSend = true;
    const result = await f.call('/api/chat', mainInput('failed-chat', snapshot));
    assert.equal(result.status, 200, result.text);
    assert.ok(result.events.some((event) => event.type === 'accepted'));
    assert.ok(result.events.some((event) => event.type === 'failed'));
    const draft = await f.get('/api/research-input/draft?scope=main&ownerId=failed-chat');
    assert.deepEqual(draft.body.attachmentIds, [resource.body.id]);
    assert.equal(draft.body.annotations[0].id, 'ann-failed');
    const file = path.join(f.root, '.sciencescope-local', 'library', 'originals', resource.body.id, 'failed-send.txt');
    assert.equal(await readFile(file, 'utf8'), 'KEEP_AFTER_SEND_FAILURE');
  } finally { await f.close(); }
});

test('failed send restores a selected source once as a context ref and preserves compiled model input', async () => {
  const f = await fixture();
  try {
    const resource = await f.call('/api/library/import', { name: 'context-only.txt', base64: Buffer.from('CONTEXT_ONLY_SOURCE').toString('base64') });
    const contextRefs = [{ resourceId: resource.body.id }];
    await f.call('/api/research-input/draft', { scope: 'main', ownerId: 'context-failed-chat', snapshot: { attachmentIds: [], messageQuotes: [], annotations: [], contextRefs } });
    f.state.failSend = true;
    const result = await f.call('/api/chat', mainInput('context-failed-chat', { contextRefs }));
    assert.ok(result.events.some((event) => event.type === 'failed'), 'runtime send fails after accepting the input snapshot');
    assert.match(f.state.sends.at(-1), /CONTEXT_ONLY_SOURCE/);
    const draft = await f.get('/api/research-input/draft?scope=main&ownerId=context-failed-chat');
    assert.deepEqual(draft.body.attachmentIds, []);
    assert.deepEqual(draft.body.contextRefs, contextRefs);
  } finally { await f.close(); }
});

test('repeating a user message id is rejected before a second runtime send', async () => {
  const f = await fixture();
  try {
    const first = await f.call('/api/chat', mainInput('duplicate-chat'));
    assert.equal(first.status, 200, first.text);
    const sendCount = f.state.sends.length;
    const second = await f.call('/api/chat', mainInput('duplicate-chat'));
    assert.equal(second.status, 409, second.text);
    assert.equal(f.state.sends.length, sendCount);
  } finally { await f.close(); }
});
