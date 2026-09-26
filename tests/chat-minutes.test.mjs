import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopApi } from '../scripts/desktop-api.mjs';

// The secretary's minutes, the history tools and what experts receive.
test('minutes: incremental, authoritative user edits, recall tools, expert input', async () => {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'chat-minutes-'));
  const state = { minutesPrompts: [], briefs: [], expertRuns: [], starts: 0, sessions: new Map() };
  let toolHandler = null;
  const host = {
    capabilities: { tokenStreaming: true }, listProviders: async () => [], getRuntimeConfig: async () => ({}), getContextUsage: async () => null,
    observeSession: () => () => {}, close: async () => {},
    startSession: async ({ sessionId, noTools }) => { state.starts += 1; const id = sessionId || `session-${state.starts}`; state.sessions.set(id, noTools ? 'minutes' : 'chat'); return id; },
    configurePolicy: async () => {}, configureReasoning: async () => {}, configureBrief: async ({ text }) => { state.briefs.push(text); },
    releaseSession: async () => {}, getGoal: async () => null,
    setToolHandler: (handler) => { toolHandler = handler; },
    send: async ({ sessionId, text, onEvent }) => {
      if (state.sessions.get(sessionId) === 'minutes') { state.minutesPrompts.push(text); return { finalResponse: `MINUTES v${state.minutesPrompts.length}` }; }
      const reply = `REPLY TO ${text.split('\n').at(-1)}`; onEvent?.({ type: 'completed', text: reply }); return { finalResponse: reply };
    },
    runExperts: async ({ runId, prompt, experts }) => { state.expertRuns.push({ prompt, experts }); return experts.map((expert) => ({ expertId: expert.id, stopReason: 'completed', text: 'EXPERT VIEW', ms: 1 })); },
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
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(text) }); } catch { resolve({ status: res.statusCode, text }); } });
    }); req.on('error', reject); req.end(raw);
  });
  const model = { providerId: 'p', modelId: 'm' };
  const waitFor = async (predicate) => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise((r) => setTimeout(r, 50)); assert.ok(predicate()); };
  try {
    await send('POST', '/api/chat', { chatId: 'chat-m', projectId: null, model, text: 'We decide to use a randomized design.', userMessageId: 'u1', assistantMessageId: 'a1' });
    // The Main expert's system prompt carries the lookup rules.
    assert.match(state.briefs.at(-1), /project_memory\(\{section:"minutes"\}\)[\s\S]*chat_recall/);
    // The secretary writes minutes in the background after the turn.
    await waitFor(() => state.minutesPrompts.length === 1);
    assert.match(state.minutesPrompts[0], /\(none yet\)[\s\S]*<message n="1" speaker="User">\nWe decide to use a randomized design\.[\s\S]*<message n="2" speaker="Main expert">/);
    let current = (await send('GET', '/api/chats/minutes?chatId=chat-m')).body;
    for (let i = 0; i < 40 && !current.minutes; i++) { await new Promise((r) => setTimeout(r, 50)); current = (await send('GET', '/api/chats/minutes?chatId=chat-m')).body; }
    assert.equal(current.minutes.text, 'MINUTES v1'); assert.equal(current.minutes.throughOrdinal, 2);

    // A user edit is the next revision and is what the secretary builds on.
    const edited = await send('POST', '/api/chats/minutes', { chatId: 'chat-m', text: 'USER MINUTES', expectedRevision: 1 });
    assert.equal(edited.body.minutes.author, 'user');
    assert.equal((await send('POST', '/api/chats/minutes', { chatId: 'chat-m', text: 'STALE', expectedRevision: 1 })).status, 409);
    await send('POST', '/api/chat', { chatId: 'chat-m', projectId: null, model, text: 'Now check the sample size.', userMessageId: 'u2', assistantMessageId: 'a2' });
    await waitFor(() => state.minutesPrompts.length === 2);
    assert.match(state.minutesPrompts[1], /by the user, covering messages up to #2\)\]\nUSER MINUTES[\s\S]*\[New messages #3–#4\]/, 'only new messages are sent');
    assert.doesNotMatch(state.minutesPrompts[1], /randomized design/);

    // History tools, bound to the session's chat.
    const sessionId = [...state.sessions].find(([, kind]) => kind === 'chat')[0];
    const found = await toolHandler({ sessionId, name: 'chat_recall', args: { query: 'randomized' } });
    assert.deepEqual(found.results.map((hit) => hit.n).sort(), [1, 2]);
    const read = await toolHandler({ sessionId, name: 'chat_recall', args: { from: 1, to: 2 } });
    assert.match(read.messages, /<message n="1" speaker="User">\nWe decide to use a randomized design\./);
    for (let i = 0; i < 40; i++) { const m = await toolHandler({ sessionId, name: 'project_memory', args: { section: 'minutes' } }); if (m.minutes === 'MINUTES v2') break; await new Promise((r) => setTimeout(r, 50)); }
    const memo = await toolHandler({ sessionId, name: 'project_memory', args: { section: 'minutes' } });
    assert.equal(memo.minutes, 'MINUTES v2'); assert.equal(memo.coversThrough, 4);
    assert.deepEqual(await toolHandler({ sessionId, name: 'project_memory', args: { section: 'log' } }), { log: [], note: 'This conversation is not in a project.' });

    // Experts receive the minutes and the conversation after them verbatim, and the rules.
    const roster = (await send('GET', '/api/experts')).body.experts;
    await send('POST', '/api/discussion', { chatId: 'chat-m', projectId: null, model, kind: 'ordered', text: 'Is the design sound?', expertIds: [roster[0].id], userMessageId: 'u3' });
    const run = state.expertRuns.at(-1);
    assert.match(run.prompt, /\[Conversation minutes — kept by the secretary, revision 3, covering messages #1–#4\]\nMINUTES v2/);
    assert.match(run.prompt, /\[Conversation, verbatim: messages #1–#4 of 4\.\][\s\S]*\[The user's new message\]\nIs the design sound\?/);
    assert.match(run.experts[0].persona, /chat_recall[\s\S]*project_memory/);
  } finally { await api.close(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
