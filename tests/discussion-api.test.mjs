import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopApi } from '../scripts/desktop-api.mjs';

async function fixture() {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'discussion-api-'));
  const state = { runs: [], starts: 0 };
  const host = {
    capabilities: { tokenStreaming: true, reasoningEffort: false },
    listProviders: async () => [], getRuntimeConfig: async () => ({}), getContextUsage: async () => null,
    observeSession: () => () => {},
    startSession: async ({ sessionId }) => { state.starts += 1; return sessionId || `session-${state.starts}`; },
    configureReasoning: async () => {}, configurePolicy: async () => {}, releaseSession: async () => {}, close: async () => {},
    send: async () => { throw new Error('Main send must not run for a discussion'); },
    runExperts: async ({ runId, prompt, experts, onEvent }) => {
      state.runs.push({ prompt, experts });
      const result = experts.map((expert) => ({ expertId: expert.id, stopReason: 'completed', text: `${expert.id.toUpperCase()}_VIEW`, ms: 5 }));
      // Finish in reverse roster order, as real experts finish in any order.
      for (const entry of [...result].reverse()) { onEvent({ type: 'expert-start', runId, expertId: entry.expertId }); onEvent({ type: 'expert-end', runId, ...entry }); }
      return result;
    },
    cancelExperts: async () => {},
  };
  const api = await createDesktopApi({ dataRoot: root, runtimeHost: host });
  const server = createServer((req, res) => api.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const send = (method, route, body) => new Promise((resolve, reject) => {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const req = httpRequest({ hostname: '127.0.0.1', port, path: route, method, headers: { host: `127.0.0.1:${port}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) }) } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { const lines = text.trim() ? text.trim().split('\n') : []; resolve({ status: res.statusCode, events: lines.map((line) => JSON.parse(line)) }); });
    }); req.on('error', reject); req.end(raw);
  });
  return { state, send, close: async () => { await api.close(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); } };
}

const model = { providerId: 'fixture', modelId: 'main-model' };

test('expert discussion: roster defaults, independent round, authored records, cross-critique', async () => {
  const f = await fixture();
  try {
    const roster = (await f.send('GET', '/api/experts')).events[0];
    assert.equal(roster.available, true);
    assert.deepEqual(roster.experts.map((e) => e.id), ['methodologist', 'statistician', 'red-team']);

    const early = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model, kind: 'critique', expertIds: ['statistician'] });
    assert.equal(early.status, 409); assert.equal(early.events[0].code, 'NO_PREVIOUS_ROUND');

    const first = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model, text: 'Is the causal claim justified?', expertIds: ['red-team', 'methodologist'], userMessageId: 'msg-q1' });
    assert.equal(first.status, 200);
    assert.deepEqual(first.events.map((e) => e.type), ['accepted', 'expert-start', 'expert-end', 'expert-start', 'expert-end', 'completed']);
    assert.deepEqual(first.events[0].experts.map((e) => e.id), ['methodologist', 'red-team'], 'roster order, not request order');
    assert.match(f.state.runs[0].prompt, /Is the causal claim justified\?[\s\S]*independent assessment/);
    assert.match(f.state.runs[0].experts[0].persona, /research design validity/);
    assert.equal(f.state.runs[0].experts[0].prompt, undefined);

    const page = (await f.send('GET', '/api/chats/chat-d/messages')).events[0];
    assert.deepEqual(page.messages.map((m) => [m.role, m.text, m.expert?.label ?? null]), [
      ['user', 'Is the causal claim justified?', null],
      ['assistant', 'METHODOLOGIST_VIEW', '方法学家'],
      ['assistant', 'RED-TEAM_VIEW', '魔鬼代言人'],
    ]);
    assert.deepEqual(page.messages[1].expert.model, model);

    const second = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model, kind: 'critique', text: 'focus on confounding', expertIds: ['methodologist', 'red-team', 'statistician'] });
    assert.equal(second.status, 200);
    const critique = f.state.runs[1];
    assert.match(critique.prompt, /Is the causal claim justified\?[\s\S]*<expert name="方法学家">\nMETHODOLOGIST_VIEW\n<\/expert>[\s\S]*The user adds: focus on confounding[\s\S]*cross-critique/);
    assert.match(critique.experts.find((e) => e.id === 'methodologist').prompt, /your own previous answer/);
    assert.match(critique.experts.find((e) => e.id === 'statistician').prompt, /did not answer the previous round/);

    const dup = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model, text: 'again', expertIds: ['methodologist'], userMessageId: 'msg-q1' });
    assert.equal(dup.status, 409);
    const unknown = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model, text: 'x', expertIds: ['nobody'] });
    assert.equal(unknown.status, 400);
    const otherModel = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model: { providerId: 'fixture', modelId: 'other' }, text: 'x', expertIds: ['methodologist'] });
    assert.equal(otherModel.status, 409);
  } finally { await f.close(); }
});

test('expert roster saves models and rejects invalid panels', async () => {
  const f = await fixture();
  try {
    const bad = await f.send('POST', '/api/experts', { experts: [{ id: 'a', label: 'A', persona: 'p' }, { id: 'a', label: 'B', persona: 'p' }] });
    assert.equal(bad.status, 400);
    const saved = await f.send('POST', '/api/experts', { experts: [{ id: 'bio', label: '生物学家', role: '领域', persona: 'Biology focus.', model: { providerId: 'fixture', modelId: 'other' }, reasoningEffort: 'high' }] });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.events[0].experts.map((e) => [e.id, e.model.modelId, e.reasoningEffort, e.enabled]), [['bio', 'other', 'high', true]]);
    await f.send('POST', '/api/discussion', { chatId: 'chat-m', projectId: null, model, text: 'q', expertIds: ['bio'] });
    assert.deepEqual(f.state.runs[0].experts[0].model, { providerId: 'fixture', modelId: 'other' });
    assert.equal(f.state.runs[0].experts[0].reasoningEffort, 'high');
  } finally { await f.close(); }
});
