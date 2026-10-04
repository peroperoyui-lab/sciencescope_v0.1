import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopApi } from '../scripts/desktop-api.mjs';

async function fixture({ emitExpertEnds = true } = {}) {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'discussion-api-'));
  const state = { runs: [], starts: 0, toolHandler: null, invokeResearchTools: false, researchCalls: [] };
  const host = {
    capabilities: { tokenStreaming: true, reasoningEffort: false },
    listProviders: async () => [], getRuntimeConfig: async () => ({}), getContextUsage: async () => null,
    observeSession: () => () => {},
    startSession: async ({ sessionId }) => { state.starts += 1; return sessionId || `session-${state.starts}`; },
    configureReasoning: async () => {}, configurePolicy: async () => {}, releaseSession: async () => {}, close: async () => {},
    setToolHandler: (fn) => { state.toolHandler = fn; },
    send: async ({ text, onEvent }) => { state.mainPrompts = [...(state.mainPrompts || []), text]; onEvent({ type: 'text-delta', delta: 'MAIN_REPLY' }); onEvent({ type: 'completed', text: 'MAIN_REPLY' }); return { finalResponse: 'MAIN_REPLY' }; },
    runExperts: async ({ sessionId, runId, prompt, experts, onEvent }) => {
      const result = experts.map((expert) => ({ expertId: expert.id, stopReason: state.failedExpertId === expert.id ? 'max-tokens' : 'completed', text: state.failedExpertId === expert.id ? '' : `${expert.id.toUpperCase()}_VIEW`, ms: 5 }));
      state.runs.push({ sessionId, runId, prompt, experts, result });
      if (experts[0].id === 'methodologist') onEvent({ type: 'expert-tool', runId, expertId: 'methodologist', callId: 'call-1', name: 'read', argumentsPreview: '{"path":"paper_versions/draft.md"}', preamble: 'Let me read the draft.' });
      if (experts[0].id === 'methodologist') {
        onEvent({ type: 'expert-tool', runId, expertId: 'methodologist', callId: 'call-2', name: 'present', argumentsPreview: '{"files":[{"path":"figures/fig1.png","description":"Effect sizes"}]}' });
        onEvent({ type: 'expert-tool-result', runId, expertId: 'methodologist', callId: 'call-2', isError: false, resultPreview: 'Presented figure successfully.' });
      }
      // Finish in reverse roster order, as real experts finish in any order.
      for (const entry of [...result].reverse()) {
        onEvent({ type: 'expert-start', runId, expertId: entry.expertId });
        if (state.invokeResearchTools) {
          const search = await state.toolHandler({ sessionId, name: 'research_search', args: { query: 'provenance marker' }, callId: `search-${entry.expertId}`, expertId: entry.expertId });
          const proposal = await state.toolHandler({ sessionId, name: 'research_propose', args: { op: 'create', item: { type: 'memory', subtype: 'decision', scope: 'personal', title: `Proposal ${entry.expertId} ${runId}`, body: `Decision from ${entry.expertId} in ${runId}` }, rationale: 'Test expert message provenance.' }, callId: `propose-${entry.expertId}`, expertId: entry.expertId });
          state.researchCalls.push({ expertId: entry.expertId, search, proposal });
        }
        if (emitExpertEnds) onEvent({ type: 'expert-end', runId, ...entry });
      }
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

test('expert research proposals and usage resolve to each persisted expert message', async () => {
  const f = await fixture();
  try {
    const marker = await f.send('POST', '/api/research/items', { item: { type: 'knowledge', subtype: 'finding', scope: 'personal', title: 'Provenance test marker', body: 'A searchable marker for research provenance.' } });
    assert.equal(marker.status, 200);
    f.state.invokeResearchTools = true;
    const discussion = await f.send('POST', '/api/discussion', { chatId: 'chat-provenance', projectId: null, model, kind: 'invited', text: 'Check this shared context.', expertIds: ['methodologist', 'red-team'], userMessageId: 'user-provenance' });
    assert.equal(discussion.status, 200);
    const accepted = discussion.events.find((event) => event.type === 'accepted');
    const expertEnds = discussion.events.filter((event) => event.type === 'expert-end');
    const expectedByExpert = new Map(accepted.experts.map(({ id, messageId }) => [id, messageId]));
    const messages = (await f.send('GET', '/api/chats/chat-provenance/messages')).events[0].messages;
    for (const expertId of ['methodologist', 'red-team']) {
      const messageId = expectedByExpert.get(expertId);
      const message = messages.find((entry) => entry.id === messageId);
      assert.ok(message, `${expertId} message was persisted`);
      assert.equal(expertEnds.find((entry) => entry.expertId === expertId).messageId, messageId);
      const proposal = (await f.send('GET', '/api/research/proposals?status=pending')).events[0].proposals.find((entry) => entry.origin.expertId === expertId);
      assert.equal(proposal.origin.messageId, messageId, `${expertId} proposal points to its own persisted message`);
      const usage = (await f.send('GET', `/api/research/usage?chatId=chat-provenance&messageId=${encodeURIComponent(messageId)}`)).events[0].refs;
      assert.ok(usage.some((ref) => ref.type === 'item' && ref.id === marker.events[0].item.id && ref.how === 'search'), `${expertId} search usage points to its own message`);
    }
    assert.notEqual(expectedByExpert.get('methodologist'), expectedByExpert.get('red-team'), 'sibling expert turns have distinct message identities');
    assert.equal(f.state.researchCalls.length, 2);
    assert.ok(f.state.researchCalls.every((entry) => entry.search.hits.some((hit) => hit.ref.id === marker.events[0].item.id)));

    f.state.researchCalls.length = 0;
    const next = await f.send('POST', '/api/discussion', { chatId: 'chat-provenance', projectId: null, model, kind: 'invited', text: 'Check one more time.', expertIds: ['red-team'], userMessageId: 'user-provenance-2' });
    assert.equal(next.status, 200);
    const nextId = next.events.find((event) => event.type === 'accepted').experts[0].messageId;
    assert.notEqual(nextId, expectedByExpert.get('red-team'), 'the next discussion gets a fresh expert message identity');
    const nextProposal = (await f.send('GET', '/api/research/proposals?status=pending')).events[0].proposals.find((entry) => entry.origin.toolCallId === 'propose-red-team' && entry.origin.messageId === nextId);
    assert.ok(nextProposal, 'the repeated expert ID maps to the next turn rather than the prior turn');
    const late = await f.state.toolHandler({ sessionId: f.state.runs.at(-1).sessionId, name: 'research_propose', args: { op: 'create', item: { type: 'memory', subtype: 'decision', scope: 'personal', title: 'Late stale mapping probe', body: 'No active expert turn.' }, rationale: 'Probe cleanup.' }, callId: 'late-probe', expertId: 'red-team' });
    assert.equal((await f.send('GET', '/api/research/proposals?status=pending')).events[0].proposals.find((entry) => entry.id === late.proposalId).origin.messageId, null, 'a tool call after the discussion does not inherit a stale message ID');
  } finally { await f.close(); }
});

test('ordered panel: shared transcript, roster order, reviewer after all, adoption, invites and Main catch-up', async () => {
  const f = await fixture();
  try {
    const roster = (await f.send('GET', '/api/experts')).events[0];
    assert.equal(roster.available, true);
    assert.deepEqual(roster.experts.map((e) => [e.id, e.kind, e.enabled, e.skills]), [
      ['methodologist', 'expert', true, []], ['statistician', 'expert', true, []], ['red-team', 'expert', true, []],
      ['independent-reviewer', 'reviewer', false, []],
    ]);

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
    assert.deepEqual(reviewRun.experts[0].boundSkills, []);

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

test('returned expert results persist and complete the API round without expert-end callbacks', async () => {
  const f = await fixture({ emitExpertEnds: false });
  try {
    const chatId = 'chat-result-fallback';
    const round = await f.send('POST', '/api/discussion', { chatId, projectId: null, model, kind: 'ordered', text: 'Check the claim.', expertIds: ['red-team', 'methodologist'], reviewerId: 'statistician', userMessageId: 'user-result-fallback' });
    assert.equal(round.status, 200);
    assert.equal(f.state.runs.length, 2, 'returned panel answers still trigger the reviewer');
    const returned = f.state.runs.flatMap((run) => run.result);
    const ends = round.events.filter((event) => event.type === 'expert-end');
    assert.deepEqual(ends.map(({ expertId, text, stopReason, ms }) => ({ expertId, text, stopReason, ms })), returned, 'every authoritative entry is forwarded once in returned order');
    assert.deepEqual(ends.map((event) => event.review), [false, false, true]);
    assert.equal(round.events[0].type, 'accepted');
    assert.deepEqual(round.events.at(-1), { type: 'completed', runId: round.events[0].runId, failed: 0 });
    const reviewStart = round.events.findIndex((event) => event.type === 'review-start');
    assert.ok(reviewStart > round.events.indexOf(ends[1]), 'review starts after both fallback panel completions');
    assert.ok(reviewStart < round.events.indexOf(ends[2]), 'review result precedes final completion');
    for (const entry of f.state.runs[0].result) assert.ok(f.state.runs[1].prompt.includes(entry.text), 'reviewer receives each returned panel answer');

    const messages = (await f.send('GET', `/api/chats/${chatId}/messages`)).events[0].messages;
    assert.equal(messages.length, 4, 'user and all three returned expert messages are persisted');
    assert.deepEqual(messages.slice(1).map((message) => [message.id, message.text, message.expert.expertId, message.expert.stopReason, message.expert.review, message.expert.adopted]), ends.map((event) => [event.messageId, event.text, event.expertId, event.stopReason, event.review, !event.review]));
    assert.deepEqual(ends.map((event) => event.messageId), round.events[0].experts.map((expert) => expert.messageId), 'fallback preserves accepted message identities');

    await f.send('POST', '/api/chat', { chatId, projectId: null, model, text: 'What next?', userMessageId: 'user-before-adoption', assistantMessageId: 'main-before-adoption' });
    for (const entry of f.state.runs[0].result) assert.ok(f.state.mainPrompts[0].includes(entry.text));
    assert.doesNotMatch(f.state.mainPrompts[0], /STATISTICIAN_VIEW/, 'fallback review stays out of Main context until adopted');
    const adopted = await f.send('POST', '/api/discussion/adopt', { chatId, messageId: ends[2].messageId, adopted: true });
    assert.equal(adopted.status, 200);
    assert.equal(adopted.events[0].entry.adopted, true);
    await f.send('POST', '/api/chat', { chatId, projectId: null, model, text: 'Use the review.', userMessageId: 'user-after-adoption', assistantMessageId: 'main-after-adoption' });
    assert.match(f.state.mainPrompts[1], /STATISTICIAN_VIEW/);
    assert.doesNotMatch(f.state.mainPrompts[1], /METHODOLOGIST_VIEW|RED-TEAM_VIEW/, 'completed fallback answers are not sent to Main twice');
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
    const disabled = await f.send('POST', '/api/experts', { experts: [{ ...saved.events[0].experts[0], enabled: false }] });
    assert.equal(disabled.status, 200);
    const dispatchDisabled = await f.send('POST', '/api/discussion', { chatId: 'chat-disabled', projectId: null, model, text: 'q', expertIds: ['bio'] });
    assert.equal(dispatchDisabled.status, 400);
    assert.equal(dispatchDisabled.events[0].code, 'INVALID_EXPERT_ROSTER', 'disabled participant rejection is a typed roster error');
    assert.equal(f.state.runs.length, 1, 'disabled participant does not reach the runtime');
  } finally { await f.close(); }
});

test('independent reviewers cannot answer, and enabled bound skills reach only the review subagent', async () => {
  const f = await fixture();
  try {
    const defaults = (await f.send('GET', '/api/experts')).events[0].experts;
    const originalReviewer = defaults.find((expert) => expert.kind === 'reviewer');
    assert.equal(originalReviewer.enabled, false);
    const wrongRole = await f.send('POST', '/api/discussion', { chatId: 'chat-review-kind', projectId: null, model, text: 'q', expertIds: [originalReviewer.id] });
    assert.equal(wrongRole.status, 400);
    assert.equal(wrongRole.events[0].code, 'INVALID_EXPERT_ROSTER');
    assert.equal(f.state.runs.length, 0, 'reject invalid role before invoking the runtime');

    const markdown = '---\nname: t19-checklist\ndescription: T19 reviewer checklist\n---\n\n# Reviewer checklist\nCheck each factual claim against its cited source.';
    const savedSkill = await f.send('POST', '/api/skills/save', { markdown });
    assert.equal(savedSkill.status, 200);
    const skillName = savedSkill.events[0].name;
    const reviewer = { ...originalReviewer, enabled: true, skills: [skillName] };
    const configured = await f.send('POST', '/api/experts', { experts: [...defaults.filter((expert) => expert.kind === 'expert'), reviewer] });
    assert.equal(configured.status, 200);
    assert.deepEqual(configured.events[0].experts.find((expert) => expert.id === reviewer.id).skills, [skillName]);

    await f.send('POST', '/api/skills/enabled', { name: skillName, enabled: false });
    const retained = (await f.send('GET', '/api/experts')).events[0].experts.find((expert) => expert.id === reviewer.id);
    assert.deepEqual(retained.skills, [skillName], 'GET preserves a binding after a skill is disabled');
    const disabledPost = await f.send('POST', '/api/experts', { experts: (await f.send('GET', '/api/experts')).events[0].experts });
    assert.equal(disabledPost.status, 400, 'POST rejects skills that are not currently enabled');
    assert.equal(disabledPost.events[0].code, 'INVALID_EXPERT_ROSTER');

    const invalidSkill = await f.send('POST', '/api/experts', { experts: [...defaults.filter((expert) => expert.kind === 'expert'), { ...reviewer, skills: ['not-installed'] }] });
    assert.equal(invalidSkill.status, 400);
    assert.equal(invalidSkill.events[0].code, 'INVALID_EXPERT_ROSTER');

    await f.send('POST', '/api/skills/enabled', { name: skillName, enabled: true });
    const ordered = await f.send('POST', '/api/discussion', { chatId: 'chat-review-skill', projectId: null, model, kind: 'ordered', text: 'Check this claim.', expertIds: ['methodologist'], reviewerId: reviewer.id });
    assert.equal(ordered.status, 200);
    const participantRun = f.state.runs.at(-2);
    const reviewRun = f.state.runs.at(-1);
    assert.deepEqual(participantRun.experts[0].boundSkills, [], 'unbound participant receives no skill contents');
    assert.deepEqual(reviewRun.experts[0].boundSkills, [{ name: skillName, markdown }]);
    assert.match(reviewRun.experts[0].prompt, /reviewing expert/);
    assert.doesNotMatch(reviewRun.experts[0].persona, /Check each factual claim against its cited source/);
  } finally { await f.close(); }
});
