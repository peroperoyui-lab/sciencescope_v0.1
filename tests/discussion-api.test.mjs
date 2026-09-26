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
    send: async ({ text, onEvent }) => { state.mainPrompts = [...(state.mainPrompts || []), text]; onEvent({ type: 'text-delta', delta: 'MAIN_REPLY' }); onEvent({ type: 'completed', text: 'MAIN_REPLY' }); return { finalResponse: 'MAIN_REPLY' }; },
    runExperts: async ({ runId, prompt, experts, onEvent }) => {
      state.runs.push({ runId, prompt, experts });
      const result = experts.map((expert) => ({ expertId: expert.id, stopReason: state.failedExpertId === expert.id ? 'max-tokens' : 'completed', text: state.failedExpertId === expert.id ? '' : `${expert.id.toUpperCase()}_VIEW`, ms: 5 }));
      if (experts[0].id === 'methodologist') onEvent({ type: 'expert-tool', runId, expertId: 'methodologist', callId: 'call-1', name: 'read', argumentsPreview: '{"path":"paper_versions/draft.md"}', preamble: 'Let me read the draft.' });
      if (experts[0].id === 'methodologist') {
        onEvent({ type: 'expert-tool', runId, expertId: 'methodologist', callId: 'call-2', name: 'present', argumentsPreview: '{"files":[{"path":"figures/fig1.png","description":"Effect sizes"}]}' });
        onEvent({ type: 'expert-tool-result', runId, expertId: 'methodologist', callId: 'call-2', isError: false, resultPreview: 'Presented figure successfully.' });
      }
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

test('ordered panel: shared transcript, roster order, reviewer after all, adoption, invites and Main catch-up', async () => {
  const f = await fixture();
  try {
    const roster = (await f.send('GET', '/api/experts')).events[0];
    assert.equal(roster.available, true);
    assert.deepEqual(roster.experts.map((e) => e.id), ['methodologist', 'statistician', 'red-team']);

    // A Main turn first, so the panel has earlier conversation to read.
    const main1 = await f.send('POST', '/api/chat', { chatId: 'chat-d', projectId: null, model, text: 'Summarise the study.', userMessageId: 'msg-u0', assistantMessageId: 'msg-a0' });
    assert.equal(main1.status, 200);

    const first = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model, kind: 'ordered', text: 'Is the causal claim justified?', expertIds: ['red-team', 'methodologist'], reviewerId: 'statistician', userMessageId: 'msg-q1' });
    assert.equal(first.status, 200);
    const types = first.events.map((e) => e.type);
    assert.equal(types[0], 'accepted'); assert.equal(types.at(-1), 'completed');
    assert.deepEqual(first.events[0].experts.map((e) => [e.id, e.review]), [['methodologist', false], ['red-team', false], ['statistician', true]], 'roster order, reviewer last');
    const panelEnds = first.events.map((e, i) => e.type === 'expert-end' && !e.review ? i : -1).filter((i) => i >= 0);
    assert.equal(panelEnds.length, 2);
    assert.ok(types.indexOf('review-start') > Math.max(...panelEnds), 'review starts after every panel answer');
    const toolEvent = first.events.find((e) => e.type === 'tool-call');
    assert.equal(toolEvent.preamble, 'Let me read the draft.');
    assert.equal(first.events.find((e) => e.type === 'tool-result' && e.callId === 'call-2').resultPreview, 'Presented figure successfully.');
    // Everyone on the panel gets the same frozen input, including earlier turns.
    const panelRun = f.state.runs[0];
    assert.deepEqual(panelRun.experts.map((e) => e.id), ['methodologist', 'red-team']);
    assert.match(panelRun.prompt, /\[Conversation, verbatim: messages #1–#2 of 2\.\]\n<message n="1" speaker="User">\nSummarise the study\.\n<\/message>\n<message n="2" speaker="Main expert">\nMAIN_REPLY\n<\/message>[\s\S]*\[The user's new message\]\nIs the causal claim justified\?/);
    // Every expert's system prompt carries the history lookup rules; its identity stays its own.
    assert.match(panelRun.experts[0].persona, /research design validity[\s\S]*chat_recall[\s\S]*project_memory/);
    assert.match(panelRun.experts[0].prompt, /You are "方法学家" \(研究设计\)[\s\S]*"魔鬼代言人"[\s\S]*independently and in parallel/);
    assert.match(panelRun.experts[0].persona, /research design validity/);
    // The reviewer sees the answers (and files), never the tool calls.
    const reviewRun = f.state.runs[1];
    assert.deepEqual(reviewRun.experts.map((e) => e.id), ['statistician']);
    assert.match(reviewRun.prompt, /<answer speaker="方法学家" role="研究设计">\nMETHODOLOGIST_VIEW\n<\/answer>/);
    assert.doesNotMatch(reviewRun.prompt, /Let me read the draft|"read"/);
    assert.match(reviewRun.experts[0].prompt, /reviewing expert/);

    const page = (await f.send('GET', '/api/chats/chat-d/messages')).events[0];
    assert.deepEqual(page.messages.slice(2).map((m) => [m.role, m.text, m.expert?.label ?? null, m.expert?.review ?? null]), [
      ['user', 'Is the causal claim justified?', null, null],
      ['assistant', 'METHODOLOGIST_VIEW', '方法学家', false],
      ['assistant', 'RED-TEAM_VIEW', '魔鬼代言人', false],
      ['assistant', 'STATISTICIAN_VIEW', '统计审稿人', true],
    ]);
    const review = page.messages[5];
    assert.equal(review.expert.adopted, false);
    assert.equal(page.messages[3].toolActivity[0].preamble, 'Let me read the draft.');
    assert.equal(page.messages[3].toolActivity.find((call) => call.callId === 'call-2').resultPreview, 'Presented figure successfully.');

    // Main's next turn carries the expert answers and the files they presented,
    // not files they only read, not the unadopted review and not tool calls.
    await f.send('POST', '/api/chat', { chatId: 'chat-d', projectId: null, model, text: 'What next?', userMessageId: 'msg-u1', assistantMessageId: 'msg-a1' });
    const catchUp = f.state.mainPrompts[1];
    assert.match(catchUp, /<message speaker="方法学家" role="研究设计">\nMETHODOLOGIST_VIEW\n\[Files presented with this answer\]\n- figures\/fig1.png — Effect sizes\n<\/message>/);
    assert.doesNotMatch(catchUp, /draft\.md|"present"|call-2/);
    assert.match(catchUp, /RED-TEAM_VIEW/);
    assert.doesNotMatch(catchUp, /STATISTICIAN_VIEW|Let me read the draft/);
    assert.match(catchUp, /What next\?$/);

    // Adopting the review delivers it once.
    const adopted = await f.send('POST', '/api/discussion/adopt', { chatId: 'chat-d', messageId: review.id, adopted: true });
    assert.equal(adopted.events[0].entry.adopted, true);
    await f.send('POST', '/api/chat', { chatId: 'chat-d', projectId: null, model, text: 'And now?', userMessageId: 'msg-u2', assistantMessageId: 'msg-a2' });
    assert.match(f.state.mainPrompts[2], /speaker="统计审稿人" role="统计与数据 reviewer"[^>]*>\nSTATISTICIAN_VIEW/);
    assert.doesNotMatch(f.state.mainPrompts[2], /METHODOLOGIST_VIEW/);
    const late = await f.send('POST', '/api/discussion/adopt', { chatId: 'chat-d', messageId: review.id, adopted: false });
    assert.equal(late.status, 409);
    const notReview = await f.send('POST', '/api/discussion/adopt', { chatId: 'chat-d', messageId: page.messages[3].id, adopted: false });
    assert.equal(notReview.status, 404);

    // @-invited experts: no reviewer, identity says they were invited.
    const invited = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model, kind: 'invited', text: '@魔鬼代言人 any alternative?', expertIds: ['red-team'], reviewerId: 'statistician' });
    assert.equal(invited.status, 200);
    const invitedRun = f.state.runs.at(-1);
    assert.deepEqual(invitedRun.experts.map((e) => e.id), ['red-team']);
    assert.match(invitedRun.experts[0].prompt, /invited you \(@魔鬼代言人\)/);
    assert.match(invitedRun.prompt, /STATISTICIAN_VIEW/, 'adopted review is part of later context');

    const dup = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model, text: 'again', expertIds: ['methodologist'], userMessageId: 'msg-q1' });
    assert.equal(dup.status, 409);
    const unknown = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model, text: 'x', expertIds: ['nobody'] });
    assert.equal(unknown.status, 400);
    const onlyReviewer = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model, text: 'x', expertIds: ['statistician'], reviewerId: 'statistician' });
    assert.equal(onlyReviewer.status, 400); assert.equal(onlyReviewer.events[0].code, 'NO_EXPERTS');
    const otherModel = await f.send('POST', '/api/discussion', { chatId: 'chat-d', projectId: null, model: { providerId: 'fixture', modelId: 'other' }, text: 'x', expertIds: ['methodologist'] });
    assert.equal(otherModel.status, 409);
  } finally { await f.close(); }
});

test('incomplete reviewer cannot be adopted through the API', async () => {
  const f = await fixture();
  try {
    f.state.failedExpertId = 'statistician';
    const round = await f.send('POST', '/api/discussion', { chatId: 'chat-failed-review', projectId: null, model, kind: 'ordered', text: 'Review this claim.', expertIds: ['methodologist'], reviewerId: 'statistician' });
    const review = round.events.find((event) => event.type === 'expert-end' && event.review);
    assert.equal(review.stopReason, 'max-tokens');
    const adoption = await f.send('POST', '/api/discussion/adopt', { chatId: 'chat-failed-review', messageId: review.messageId, adopted: true });
    assert.equal(adoption.status, 409);
    assert.equal(adoption.events[0].code, 'REVIEW_NOT_COMPLETED');
    const page = (await f.send('GET', '/api/chats/chat-failed-review/messages')).events[0];
    assert.equal(page.messages.find((message) => message.id === review.messageId).expert.adopted, false);
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
