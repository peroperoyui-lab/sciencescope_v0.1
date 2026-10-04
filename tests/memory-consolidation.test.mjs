import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { ChatStore } from '../scripts/chat-store.mjs';
import { createResearchStore } from '../scripts/research-base/store.mjs';
import { createResearchSearch } from '../scripts/research-base/search.mjs';
import { createChatMinutes } from '../scripts/chat-minutes.mjs';
import { createHostEvents } from '../scripts/host-events.mjs';
import { createToolActivityProjection } from '../scripts/tool-activity.mjs';
import { createMemoryConsolidator, CONSOLIDATION_LIMITS } from '../scripts/research-base/consolidate.mjs';

const model = { providerId: 'fixture', modelId: 'fixture' };
async function fixture(options = {}) {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'memory-consolidation-'));
  const chats = await new ChatStore({ stateDir: root }).init();
  const db = chats.db.db;
  db.prepare('INSERT INTO projects VALUES(?,?,?,0)').run('p', 'Fictional study', '');
  const chat = await chats.ensureChat({ chatId: 'c', projectId: 'p', title: 'Study', model });
  await chats.appendMessage({ chatId: 'c', id: 'u', role: 'user', text: 'We choose endpoint B.' });
  await chats.appendMessage({ chatId: 'c', id: 'a', role: 'assistant', text: 'Endpoint B is the current decision.' });
  const store = createResearchStore({ db }), retrieval = createResearchSearch({ store });
  const state = { starts: [], prompts: [], releases: [], interrupts: [], decisions: null, extract: null, sends: 0 };
  const host = { getRuntimeConfig: async () => ({}), startSession: async value => { state.starts.push(value); return `short-${state.starts.length}`; },
    releaseSession: async id => state.releases.push(id), interrupt: async id => state.interrupts.push(id),
    send: async ({ text }) => {
      state.prompts.push(text); state.sends++;
      if (options.send) return options.send(text, state);
      const value = text.startsWith('Extract') ? state.extract ?? { candidates: [candidate()] } : state.decisions ?? { decisions: [decision()] };
      return { finalResponse: JSON.stringify(value) };
    } };
  const minutes = createChatMinutes({ db, chatStore: chats, host, getPreferences: () => ({ summary: { saveMarkdown: false } }) });
  const events = createHostEvents();
  const service = createMemoryConsolidator({ db, host, chatStore: chats, minutes, store, retrieval, events, modelFor: () => model, ...options.service });
  return { root, db, chats, store, retrieval, state, host, minutes, events, service, chat,
    async close() { await service.close(); await events.close(); await minutes.close(); chats.close(); await rm(root, { recursive: true, force: true }); } };
}
const candidate = (patch = {}) => ({ type: 'memory', subtype: 'decision', title: 'Endpoint', body: 'The study uses endpoint B.', payload: {}, evidence: [{ messageId: 'u', quote: 'We choose endpoint B.' }], ...patch });
const decision = (patch = {}) => ({ candidateIndex: 0, op: 'create', targetId: null, rationale: 'Explicit choice', ...patch });

test('idle subscriptions, settings, manual runs, durable cursors and two isolated noTools requests', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.service.getSettings(), { enabled: true, idleMinutes: 10, model: null });
    f.service.updateSettings({ enabled: false, idleMinutes: 3 });
    await f.events.emit('chat.idle', { chatId: 'c' }); assert.equal(f.state.sends, 0);
    const run = await f.service.consolidate('c');
    assert.equal(run.throughOrdinal, 2); assert.equal(run.counts.proposals, 1); assert.equal(run.proposalIds.length, 1); assert.equal(run.running, false);
    assert.deepEqual(run.range, { from: 1, to: 2 }); assert.equal(run.budget.requests, 2);
    assert.deepEqual(f.state.starts.map(value => [value.noTools, value.maxTokens]), [[true, 8192], [true, 8192]]);
    assert.ok(run.budget.tokens >= 2 * 8192, 'reserve both complete provider output budgets, including reasoning');
    assert.ok(run.budget.tokens <= CONSOLIDATION_LIMITS.totalTokens);
    assert.ok(f.state.prompts[0].includes('"memory":["preference","goal","decision"'), 'the model receives the same subtype mapping the parser validates');
    assert.deepEqual(f.state.releases, ['short-1', 'short-2']); assert.equal(f.store.listItems({ projectId: 'p' }).length, 0);
    assert.equal(f.store.getProposal(run.proposalIds[0]).status, 'pending');
    await f.service.consolidate('c'); assert.equal(f.state.sends, 2);
    await f.service.close();
    const restarted = createMemoryConsolidator({ db: f.db, host: f.host, chatStore: f.chats, minutes: f.minutes, store: f.store, retrieval: f.retrieval, modelFor: () => model });
    assert.equal(restarted.status('c').throughOrdinal, 2); await restarted.consolidate('c'); assert.equal(f.state.sends, 2); await restarted.close();
    assert.throws(() => f.service.updateSettings({ idleMinutes: 0 }), { code: 'INVALID_CONSOLIDATION_SETTINGS' });
  } finally { await f.close(); }
});

test('update and supersede remain proposals, preserve temporal history and guard stale confirmation', async () => {
  for (const op of ['update', 'supersede']) {
    const f = await fixture();
    try {
      const old = f.store.createItem({ type: 'memory', subtype: 'decision', projectId: 'p', title: 'Endpoint', body: 'The study uses endpoint A.' });
      f.state.decisions = { decisions: [decision({ op, targetId: old.id })] };
      const run = await f.service.consolidate('c'), id = run.proposalIds[0];
      assert.equal(f.store.getItem(old.id).body, old.body);
      const edits = f.service.validateProposalDecision(id, { accept: true });
      assert.equal(edits.item.expectedRevision, old.revision);
      f.store.decide(id, { accept: true, edits });
      if (op === 'supersede') {
        assert.equal(f.store.getItem(old.id).status, 'superseded');
        assert.equal(f.store.getItem(f.retrieval.search({ query: 'endpoint', projectId: 'p' })[0].ref.id).body, 'The study uses endpoint B.');
        assert.equal(f.retrieval.search({ query: 'endpoint', projectId: 'p', includeSuperseded: true }).length, 2);
      } else assert.equal(f.store.revisionsOf(old.id)[0].snapshot.body, old.body);
    } finally { await f.close(); }
  }
  const f = await fixture();
  try {
    const old = f.store.createItem({ type: 'memory', subtype: 'decision', projectId: 'p', title: 'Endpoint', body: 'Endpoint A.' });
    f.state.decisions = { decisions: [decision({ op: 'supersede', targetId: old.id })] };
    const run = await f.service.consolidate('c'); f.store.updateItem(old.id, { body: 'Human edit' });
    assert.throws(() => f.service.validateProposalDecision(run.proposalIds[0], { accept: true }), { code: 'REVISION_CONFLICT' });
    assert.equal(f.store.getProposal(run.proposalIds[0]).status, 'pending');
  } finally { await f.close(); }
});

test('durable dedup survives rejected and accepted proposals and rolled-back cursor retries', async () => {
  for (const accept of [false, true]) {
    const f = await fixture();
    try {
      f.state.extract = { candidates: [candidate(), candidate()] };
      const run = await f.service.consolidate('c'); assert.equal(run.counts.candidates, 1);
      f.store.decide(run.proposalIds[0], { accept, edits: f.service.validateProposalDecision(run.proposalIds[0], { accept }) });
      f.db.prepare('DELETE FROM rb_consolidation_cursors WHERE chat_id=?').run('c');
      const again = await f.service.consolidate('c'); assert.equal(again.counts.duplicates, 1); assert.deepEqual(again.proposalIds, []);
      assert.equal(f.db.prepare('SELECT count(*) n FROM rb_proposals').get().n, 1);
    } finally { await f.close(); }
  }
});

test('external provenance is host-derived and protected through edited acceptance', async () => {
  const f = await fixture();
  try {
    const source = f.store.addSource({ projectId: 'p', title: 'External paper', kind: 'paper', url: 'https://example.org/paper' });
    f.store.recordUsage({ chatId: 'c', messageId: 'a', refs: [{ type: 'source', id: source.id }], how: 'read' });
    f.state.extract = { candidates: [candidate({ payload: { originTrust: 'user', sourceRefs: [] }, evidence: [{ messageId: 'a', quote: 'Endpoint B is the current decision.' }] })] };
    const run = await f.service.consolidate('c'), id = run.proposalIds[0], proposal = f.store.getProposal(id);
    assert.equal(proposal.payload.item.payload.originTrust, 'external');
    assert.ok(proposal.payload.item.payload.sourceRefs.some(ref => ref.id === source.id && ref.url));
    assert.throws(() => f.service.validateProposalDecision(id, { accept: true, edits: { item: { payload: { originTrust: 'user' } } } }), { code: 'PROVENANCE_CHANGED' });
    assert.throws(() => f.service.validateProposalDecision(id, { accept: true, edits: { item: { scope: 'personal' } } }), { code: 'PROPOSAL_SCOPE_CHANGED' });
    const edits = f.service.validateProposalDecision(id, { accept: true, edits: { item: { title: 'Edited title', payload: { custom: 'kept' } } } });
    const accepted = f.store.decide(id, { accept: true, edits });
    assert.equal(f.store.getItem(accepted.resultId).payload.originTrust, 'external');
    assert.ok(f.store.getItem(accepted.resultId).payload.sourceRefs.some(ref => ref.id === source.id));
  } finally { await f.close(); }
});

test('accepted research receipts conservatively classify corresponding model answers', async () => {
  const f = await fixture();
  try {
    f.db.exec('CREATE TABLE research_input_receipts(chat_id TEXT,message_id TEXT,payload TEXT)');
    f.db.prepare('INSERT INTO research_input_receipts VALUES(?,?,?)').run('c', 'u', JSON.stringify({ attachmentIds: ['resource-paper'], contextRefs: [], annotations: [] }));
    f.state.extract = { candidates: [candidate({ evidence: [{ messageId: 'a', quote: 'Endpoint B is the current decision.' }] })] };
    const run = await f.service.consolidate('c'); assert.equal(f.store.getProposal(run.proposalIds[0]).payload.item.payload.originTrust, 'external');
  } finally { await f.close(); }
});

test('private, assistant and temporary chats are excluded before any model request', async () => {
  const f = await fixture();
  try {
    f.db.exec('ALTER TABLE chats ADD COLUMN temporary INTEGER DEFAULT 0; ALTER TABLE chats ADD COLUMN visibility TEXT DEFAULT \'shared\'; CREATE TABLE assistant_conversations(chat_id TEXT)');
    for (const kind of ['private', 'temporary', 'assistant']) {
      await f.chats.ensureChat({ chatId: kind, projectId: 'p', title: kind, model });
      if (kind === 'private') f.db.prepare("UPDATE chats SET visibility='private' WHERE id=?").run(kind);
      if (kind === 'temporary') f.db.prepare('UPDATE chats SET temporary=1 WHERE id=?').run(kind);
      if (kind === 'assistant') f.db.prepare('INSERT INTO assistant_conversations VALUES(?)').run(kind);
      await assert.rejects(f.service.consolidate(kind), { code: 'CHAT_NOT_AVAILABLE' });
    }
    assert.equal(f.state.sends, 0);
  } finally { await f.close(); }
});

test('item-only top-5 search excludes private and stale items and foreign targets', async () => {
  const f = await fixture();
  try {
    const hidden = f.store.createItem({ type: 'memory', projectId: 'p', visibility: 'private', title: 'Endpoint', body: 'secret' });
    const calls = [], original = f.retrieval.searchHybrid;
    f.retrieval.searchHybrid = input => { calls.push(input); return original(input); };
    f.state.decisions = { decisions: [decision({ op: 'update', targetId: hidden.id })] };
    await assert.rejects(f.service.consolidate('c'), { code: 'INVALID_TARGET' });
    assert.deepEqual(calls[0].docTypes, ['item']); assert.equal(calls[0].k, 5); assert.equal(calls[0].audience, 'agent');
    assert.ok(!f.state.prompts[1].includes('secret')); assert.equal(f.service.status('c').throughOrdinal, 0);
  } finally { await f.close(); }
});

test('user-edited minutes revision delta uses corresponding old original messages without moving message cursor', async () => {
  const f = await fixture();
  try {
    f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c', 1, 'Decision endpoint B #1', 2, 'secretary', new Date().toISOString());
    await f.service.consolidate('c');
    f.minutes.edit('c', 'Decision endpoint C #1 (user correction)', 1);
    f.state.extract = { candidates: [candidate({ body: 'The corrected decision is endpoint C.' })] };
    const run = await f.service.consolidate('c');
    assert.equal(run.sourceMode, 'minutes-revision'); assert.equal(run.minutesRevision, 2); assert.equal(run.throughOrdinal, 2);
    assert.deepEqual(run.range, { from: 1, to: 1 });
    const prompt = f.state.prompts[2]; assert.ok(prompt.includes('Decision endpoint C')); assert.ok(prompt.includes('We choose endpoint B.'));
    assert.ok(!prompt.includes('Endpoint B is the current decision.'));
    assert.equal(f.store.getProposal(run.proposalIds[0]).origin.minutesRevision, 2);
  } finally { await f.close(); }
});

test('invalid JSON and invalid evidence do not retry, advance cursors or leave sessions', async () => {
  for (const reply of ['not json', JSON.stringify({ candidates: [candidate({ evidence: [{ messageId: 'u', quote: 'Never said' }] })] })]) {
    const f = await fixture({ send: async () => ({ finalResponse: reply }) });
    try {
      await assert.rejects(f.service.consolidate('c'), error => ['INVALID_JSON', 'INVALID_EVIDENCE'].includes(error.code));
      assert.equal(f.state.sends, 1); assert.equal(f.service.status('c').throughOrdinal, 0); assert.equal(f.state.releases.length, 1);
      assert.equal(f.store.listProposals().length, 0);
    } finally { await f.close(); }
  }
});

test('whole batch decision errors and model failures leave cursor and inbox unchanged', async () => {
  const f = await fixture();
  try {
    f.state.decisions = { decisions: [] };
    await assert.rejects(f.service.consolidate('c'), { code: 'INVALID_JSON' });
    assert.equal(f.service.status('c').throughOrdinal, 0); assert.equal(f.store.listProposals().length, 0);
    f.host.send = async () => { throw new Error('Provider private diagnostic'); };
    await assert.rejects(f.service.consolidate('c'), { code: 'MODEL_FAILED' });
    assert.equal(f.service.status('c').error.code, 'MODEL_FAILED');
    assert.ok(!JSON.stringify(f.service.status('c')).includes('private diagnostic'));
  } finally { await f.close(); }
});

test('input and output budgets reject oversized messages without truncation or cursor advancement', async () => {
  const f = await fixture();
  try {
    f.db.prepare('UPDATE messages SET text=? WHERE id=?').run('字'.repeat(CONSOLIDATION_LIMITS.sourceTokens + 1), 'u');
    await assert.rejects(f.service.consolidate('c'), { code: 'INPUT_BUDGET_EXCEEDED' }); assert.equal(f.state.sends, 0);
    f.db.prepare('UPDATE messages SET text=? WHERE id=?').run('We choose endpoint B.', 'u');
    f.host.send = async () => ({ finalResponse: 'x'.repeat(CONSOLIDATION_LIMITS.extractChars + 1) });
    await assert.rejects(f.service.consolidate('c'), { code: 'OUTPUT_BUDGET_EXCEEDED' });
    assert.equal(f.service.status('c').throughOrdinal, 0); assert.equal(f.state.releases.length, 1);
  } finally { await f.close(); }
});

test('Main can execute concurrently after snapshot; duplicate triggers share the run and shutdown releases only owned sessions', async () => {
  let unblock, started; const gate = new Promise(resolve => { unblock = resolve; }), ready = new Promise(resolve => { started = resolve; });
  let busy = false;
  const f = await fixture({ service: { isBusy: () => busy }, send: async text => {
    if (text.startsWith('Extract')) { started(); await gate; return { finalResponse: JSON.stringify({ candidates: [candidate()] }) }; }
    return { finalResponse: JSON.stringify({ decisions: [decision()] }) };
  } });
  try {
    const work = f.service.consolidate('c'); assert.equal(f.service.consolidate('c'), work); await ready;
    busy = true; await f.chats.appendMessage({ chatId: 'c', id: 'main-new', role: 'user', text: 'Main runs independently.' });
    unblock(); const run = await work; assert.equal(run.throughOrdinal, 2); assert.equal(run.remainingMessages, 1);
    assert.equal(f.chats.getMessage('c', 'main-new').text, 'Main runs independently.');
    assert.ok(f.state.starts.every(value => value.sessionId === undefined));
    await assert.rejects(f.service.consolidate('c'), { code: 'CHAT_BUSY' });
    await f.events.emit('chat.idle', { chatId: 'c' }); assert.equal(f.service.status('c').state, 'skipped');
  } finally { await f.close(); }
  let releaseGate;
  const g = await fixture({ send: () => new Promise(resolve => { releaseGate = resolve; }) });
  try {
    const work = g.service.consolidate('c'); const rejected = assert.rejects(work, { code: 'CONSOLIDATION_CLOSED' });
    while (!releaseGate) await new Promise(resolve => setTimeout(resolve, 1));
    const closing = g.service.close(); releaseGate({ finalResponse: JSON.stringify({ candidates: [] }) }); await closing; await rejected;
    assert.equal(g.state.releases.length, 1); assert.equal(g.service.pending(), 0); assert.equal(g.service.status('c').throughOrdinal, 0);
  } finally { await g.close(); }
});

test('no model and noop never save confirmed records; manual retry preserves source until a configured model exists', async () => {
  const f = await fixture({ service: { modelFor: () => null } });
  try {
    await assert.rejects(f.service.consolidate('c'), { code: 'MODEL_NOT_AVAILABLE' }); assert.equal(f.state.sends, 0);
    assert.equal(f.service.status('c').throughOrdinal, 0);
    f.service.updateSettings({ model }); f.state.decisions = { decisions: [decision({ op: 'noop' })] };
    const run = await f.service.consolidate('c'); assert.equal(run.counts.noop, 1); assert.equal(run.throughOrdinal, 2);
    assert.equal(f.store.listProposals().length, 0); assert.equal(f.store.listItems().length, 0);
  } finally { await f.close(); }
});

test('timeout and empty response leave cursor unchanged and release the short session', async () => {
  for (const timeout of [false, true]) {
    const f = await fixture({ service: { timeoutMs: 15 }, send: () => timeout ? new Promise(() => {}) : Promise.resolve({ finalResponse: '' }) });
    try {
      await assert.rejects(f.service.consolidate('c'), { code: timeout ? 'CONSOLIDATION_TIMEOUT' : 'EMPTY_RESPONSE' });
      assert.equal(f.service.status('c').throughOrdinal, 0); assert.equal(f.state.releases.length, 1);
    } finally { await f.close(); }
  }
});

test('blank and unadopted review windows are examined once and do not leak into model input', async () => {
  const f = await fixture();
  try {
    f.db.prepare("UPDATE messages SET text='' WHERE id='u'").run();
    f.db.exec('CREATE TABLE discussion_entries(chat_id TEXT,message_id TEXT,label TEXT,role TEXT,review INTEGER,adopted INTEGER)');
    f.db.prepare('INSERT INTO discussion_entries VALUES(?,?,?,?,?,?)').run('c', 'a', 'Private review', 'reviewer', 1, 0);
    const run = await f.service.consolidate('c');
    assert.equal(run.throughOrdinal, 2); assert.equal(f.state.sends, 0);
    await f.service.consolidate('c'); assert.equal(f.state.sends, 0);
  } finally { await f.close(); }
});

test('minutes corrections referring to earlier messages are deferred until corresponding originals can be supplied', async () => {
  const f = await fixture();
  try {
    f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c', 1, 'Decision endpoint B #1', 2, 'secretary', new Date().toISOString());
    await f.service.consolidate('c');
    await f.chats.appendMessage({ chatId: 'c', id: 'new-message', role: 'user', text: 'Another task is pending.' });
    f.minutes.edit('c', 'Decision endpoint C #1', 1);
    f.state.extract = { candidates: [] };
    const next = await f.service.consolidate('c');
    assert.equal(next.throughOrdinal, 3); assert.equal(next.minutesRevision, 1);
    assert.ok(!f.state.prompts[2].includes('Decision endpoint C'));
    const correction = await f.service.consolidate('c');
    assert.equal(correction.minutesRevision, 2); assert.equal(correction.sourceMode, 'minutes-revision');
    assert.ok(f.state.prompts[3].includes('Decision endpoint C')); assert.ok(f.state.prompts[3].includes('We choose endpoint B.'));
  } finally { await f.close(); }
});

test('mixed old/new minutes references supply complete originals and advance revision with only the new batch cursor', async () => {
  const f = await fixture();
  try {
    await f.chats.appendMessage({ chatId: 'c', id: 'old-format', role: 'user', text: 'Initial format is CSV.' });
    await f.chats.appendMessage({ chatId: 'c', id: 'old-ack', role: 'assistant', text: 'CSV recorded.' });
    f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c', 1, 'Endpoint B #1. Format CSV #3.', 4, 'user', new Date().toISOString());
    f.state.extract = { candidates: [] };
    await f.service.consolidate('c');
    await f.chats.appendMessage({ chatId: 'c', id: 'new-format', role: 'user', text: 'Replace CSV with Parquet. Other decisions stay the same.' });
    await f.chats.appendMessage({ chatId: 'c', id: 'new-ack', role: 'assistant', text: 'Parquet recorded.' });
    f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c', 2, 'Endpoint B #1. Format Parquet #5.\nRejected CSV #3, replaced by #5.', 6, 'user', new Date().toISOString());
    f.state.extract = { candidates: [candidate({ title: 'Format', body: 'The current format is Parquet.', evidence: [{ messageId: 'new-format', quote: 'Replace CSV with Parquet.' }] })] };
    const run = await f.service.consolidate('c');
    assert.equal(run.throughOrdinal, 6); assert.equal(run.minutesRevision, 2);
    assert.deepEqual(run.range, { from: 5, to: 6 });
    const prompt = f.state.prompts[1];
    const originals = JSON.parse(prompt.split('\nOriginal messages:')[1]);
    assert.deepEqual(originals.map(message => message.ordinal), [1, 3, 5, 6]);
    assert.deepEqual(originals.map(message => message.evidencePurpose), ['historical-minutes-evidence-only', 'historical-minutes-evidence-only', 'current-batch', 'current-batch']);
    assert.ok(prompt.includes('Endpoint B #1. Format Parquet #5.'));
    assert.ok(prompt.includes('Rejected CSV #3, replaced by #5.'));
    const compare = f.state.prompts[2];
    assert.ok(compare.includes('"evidence":[{"messageId":"new-format","quote":"Replace CSV with Parquet."}]'));
    assert.ok(compare.includes('Endpoint B #1. Format Parquet #5.'));
    assert.ok(compare.includes('Extraction control metadata'));
    assert.ok(compare.includes('Absence from this bounded input'));
    assert.ok(prompt.includes('Every substantive assertion'));
    assert.ok(prompt.includes('Minutes delta deferred:false'));
    assert.equal(f.store.getProposal(run.proposalIds[0]).origin.minutesRevision, 2);
    await f.service.consolidate('c'); assert.equal(f.state.sends, 3);
  } finally { await f.close(); }
});

test('mixed-reference historical evidence over budget remains deferred without truncating old originals', async () => {
  const f = await fixture();
  try {
    f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c', 1, 'Endpoint B #1.', 2, 'user', new Date().toISOString());
    f.state.extract = { candidates: [] };
    await f.service.consolidate('c');
    f.db.prepare('UPDATE messages SET text=? WHERE id=?').run('字'.repeat(CONSOLIDATION_LIMITS.sourceTokens + 1), 'u');
    await f.chats.appendMessage({ chatId: 'c', id: 'new-message', role: 'user', text: 'Endpoint C replaces B.' });
    f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c', 2, 'Endpoint C #3 replaces B #1.', 3, 'user', new Date().toISOString());
    const next = await f.service.consolidate('c');
    assert.equal(next.throughOrdinal, 3); assert.equal(next.minutesRevision, 1);
    const prompt = f.state.prompts[1];
    assert.deepEqual(JSON.parse(prompt.split('\nOriginal messages:')[1]).map(message => message.ordinal), [3]);
    assert.ok(!prompt.includes('字')); assert.ok(!prompt.includes('Endpoint C #3 replaces B #1.'));
    assert.ok(prompt.includes('Minutes delta deferred:true'));
    assert.ok(prompt.includes('omitted changed lines pending corresponding evidence, not an absence of change'));
    await assert.rejects(f.service.consolidate('c'), { code: 'INPUT_BUDGET_EXCEEDED' });
    assert.equal(f.service.status('c').minutesRevision, 1);
    assert.equal(f.state.sends, 2);
  } finally { await f.close(); }
});

test('comparison quotes come only from selected public messages even when an authentic quote does not support the body', async () => {
  const f = await fixture();
  try {
    f.db.exec('CREATE TABLE discussion_entries(chat_id TEXT,message_id TEXT,label TEXT,role TEXT,review INTEGER,adopted INTEGER)');
    await f.chats.appendMessage({ chatId: 'c', id: 'hidden-review', role: 'assistant', text: 'HIDDEN_REVIEW_TEXT' });
    f.db.prepare('INSERT INTO discussion_entries VALUES(?,?,?,?,?,?)').run('c', 'hidden-review', 'Review', 'reviewer', 1, 0);
    f.state.extract = { candidates: [candidate({ body: 'A reusable provenance lesson inferred from run metadata.' })] };
    f.state.decisions = { decisions: [decision({ op: 'noop', rationale: 'The supplied quote only supports endpoint B, not the alleged lesson.' })] };
    const run = await f.service.consolidate('c');
    assert.equal(run.counts.noop, 1); assert.equal(run.counts.proposals, 0);
    const compare = f.state.prompts[1];
    assert.ok(compare.includes('"messageId":"u","quote":"We choose endpoint B."'));
    assert.ok(compare.includes('an exact quote match or source locator alone does not prove the body'));
    assert.ok(!f.state.prompts.some(prompt => prompt.includes('HIDDEN_REVIEW_TEXT')));
    f.state.extract = { candidates: [candidate({ evidence: [{ messageId: 'hidden-review', quote: 'HIDDEN_REVIEW_TEXT' }] })] };
    await f.chats.appendMessage({ chatId: 'c', id: 'next-message', role: 'user', text: 'Another public task.' });
    await assert.rejects(f.service.consolidate('c'), { code: 'INVALID_EVIDENCE' });
  } finally { await f.close(); }
});

test('citation labels embedded in prose resolve host sources; private citations and private resources stay invisible', async () => {
  const f = await fixture();
  try {
    const source = f.store.addSource({ projectId: 'p', kind: 'paper', title: 'Public paper', url: 'https://example.org/public' });
    const hidden = f.store.createItem({ projectId: 'p', type: 'knowledge', title: 'PRIVATE TITLE', body: 'PRIVATE BODY', visibility: 'private' });
    f.db.prepare('INSERT INTO resources VALUES(?,?,?,?,?,?)').run('private-resource', 'p', 'PRIVATE RESOURCE', 'md', null, JSON.stringify({ visibility: 'private' }));
    const secretSource = f.store.addSource({ projectId: 'p', kind: 'paper', title: 'PRIVATE SOURCE', resourceId: 'private-resource' });
    f.db.prepare('UPDATE messages SET text=? WHERE id=?').run(`Paper finding [${source.label}] and private citation [@${hidden.id.replace('itm_', '').slice(0, 8)}] plus [${secretSource.label}].`, 'a');
    f.state.extract = { candidates: [candidate({ evidence: [{ messageId: 'a', quote: 'Paper finding' }] })] };
    const run = await f.service.consolidate('c'), payload = f.store.getProposal(run.proposalIds[0]).payload.item.payload;
    assert.equal(payload.originTrust, 'external'); assert.ok(payload.sourceRefs.some(ref => ref.id === source.id));
    assert.ok(!payload.sourceRefs.some(ref => [hidden.id, secretSource.id, 'private-resource'].includes(ref.id)));
    assert.ok(!JSON.stringify(payload).includes('PRIVATE'));
    assert.ok(!f.state.prompts[0].includes('PRIVATE TITLE'));
  } finally { await f.close(); }
});

test('successful host web activity forces external provenance without exposing result instructions', async () => {
  for (const name of ['web_search', 'web_fetch']) {
    const f = await fixture();
    try {
      const activity = createToolActivityProjection({ chatStore: f.chats });
      await activity.record({ chatId: 'c', assistantMessageId: 'a', callId: 'web-success', name, type: 'tool-call', argumentsPreview: { url: 'https://example.org/paper?token=private-query' } });
      await activity.record({ chatId: 'c', assistantMessageId: 'a', callId: 'web-success', type: 'tool-result', isError: false, resultPreview: 'UNTRUSTED INSTRUCTIONS https://example.org/result' });
      await activity.record({ chatId: 'c', assistantMessageId: 'a', callId: 'web-failed', name: 'web_fetch', type: 'tool-result', isError: true, resultPreview: 'https://example.org/failed' });
      f.state.extract = { candidates: [candidate({ payload: { originTrust: 'user' }, evidence: [{ messageId: 'a', quote: 'Endpoint B is the current decision.' }] })] };
      const run = await f.service.consolidate('c'), payload = f.store.getProposal(run.proposalIds[0]).payload.item.payload;
      assert.equal(payload.originTrust, 'external');
      assert.ok(payload.sourceRefs.some(ref => ref.tool === name && ref.callId === 'web-success' && ref.urls.includes('https://example.org/paper')));
      assert.ok(!payload.sourceRefs.some(ref => ref.callId === 'web-failed'));
      assert.ok(!JSON.stringify(payload).includes('private-query'));
      assert.ok(!f.state.prompts[0].includes('UNTRUSTED INSTRUCTIONS'));
    } finally { await f.close(); }
  }
});

for (const type of ['source', 'chunk']) {
  test(`deleted ${type} usage retains external provenance and unresolved locators`, async () => {
    const f = await fixture();
    try {
      const source = f.store.addSource({ projectId: 'p', title: 'Removed external paper', kind: 'paper', url: 'https://example.org/removed' });
      f.store.replaceChunks(source.id, [{ text: 'The paper reports endpoint B.' }], { parser: 'fixture' });
      const ref = { type, id: type === 'source' ? source.id : f.store.chunksOf(source.id)[0].id };
      f.store.recordUsage({ chatId: 'c', messageId: 'a', refs: [ref], how: 'read' });
      assert.equal(f.store.removeSource(source.id), true);
      assert.equal(f.store.getSource(source.id), undefined);
      assert.ok(f.store.usageOf('c', 'a').some(value => value.type === type && value.id === ref.id));
      f.state.extract = { candidates: [candidate({ evidence: [{ messageId: 'a', quote: 'Endpoint B is the current decision.' }] })] };
      const run = await f.service.consolidate('c'), proposal = f.store.getProposal(run.proposalIds[0]);
      assert.equal(proposal.payload.item.payload.originTrust, 'external');
      assert.ok(proposal.payload.item.payload.sourceRefs.some(value => value.type === type && value.id === ref.id));
      assert.throws(() => f.service.validateProposalDecision(proposal.id, { accept: true, edits: { item: { payload: { originTrust: 'model' } } } }), { code: 'PROVENANCE_CHANGED' });
    } finally { await f.close(); }
  });
}
