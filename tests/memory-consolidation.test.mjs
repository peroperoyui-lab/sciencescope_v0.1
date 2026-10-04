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
    assert.deepEqual(f.service.getSettings(), { enabled: true, idleMinutes: 10, model: null, tokenLimit: 100000 });
    f.service.updateSettings({ enabled: false, idleMinutes: 3 });
    await f.events.emit('chat.idle', { chatId: 'c' }); assert.equal(f.state.sends, 0);
    const run = await f.service.consolidate('c');
    assert.equal(run.throughOrdinal, 2); assert.equal(run.counts.proposals, 1); assert.equal(run.proposalIds.length, 1); assert.equal(run.running, false);
    assert.deepEqual(run.range, { from: 1, to: 2 }); assert.equal(run.budget.requests, 2);
    assert.deepEqual(f.state.starts.map(value => [value.noTools, value.maxTokens]), [[true, 32768], [true, 32768]]);
    assert.ok(run.budget.tokens >= 2 * 32768, 'reserve both complete provider output budgets, including reasoning');
    assert.ok(run.budget.tokens <= CONSOLIDATION_LIMITS.tokenLimit);
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

test('complete sources and long candidates are not limited by old character or schema budgets', async () => {
  const f=await fixture();try {
    const text='We choose endpoint B.'+'字'.repeat(30000);f.db.prepare('UPDATE messages SET text=? WHERE id=?').run(text,'u');
    f.state.extract={candidates:Array.from({length:10},(_,i)=>candidate({title:'Endpoint '+i,body:'The study uses endpoint B. '+ 'x'.repeat(5000)}))};
    f.state.decisions={decisions:Array.from({length:10},(_,i)=>decision({candidateIndex:i}))};
    f.service.updateSettings({tokenLimit:null});const run=await f.service.consolidate('c');
    assert.equal(run.throughOrdinal,2);assert.equal(run.counts.candidates,10);assert.ok(f.state.prompts[0].includes(text));
    assert.equal(f.store.getProposal(run.proposalIds[0]).payload.item.body.length,5027);
    assert.ok(f.state.starts.every(s=>s.maxTokens===32768));
  }finally{await f.close();}
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

test('historical corrections include full originals immediately without moving historical cursor', async () => {
 const f=await fixture();try {
 f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c',1,'Decision endpoint B #1',2,'secretary',new Date().toISOString());await f.service.consolidate('c');
 await f.chats.appendMessage({chatId:'c',id:'new-message',role:'user',text:'Another task is pending.'});f.minutes.edit('c','Decision endpoint C #1',1);f.state.extract={candidates:[]};
 const run=await f.service.consolidate('c');assert.equal(run.throughOrdinal,3);assert.equal(run.minutesRevision,2);assert.ok(f.state.prompts[2].includes('We choose endpoint B.'));assert.ok(f.state.prompts[2].includes('Decision endpoint C'));
 }finally{await f.close();}
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

test('large historical evidence and minute corrections retain complete originals', async () => {
 const f=await fixture();try {
 f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c',1,'Endpoint B #1.',2,'user',new Date().toISOString());f.state.extract={candidates:[]};await f.service.consolidate('c');
 const original='字'.repeat(9000);f.db.prepare('UPDATE messages SET text=? WHERE id=?').run(original,'u');await f.chats.appendMessage({chatId:'c',id:'new-message',role:'user',text:'Endpoint C replaces B.'});f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c',2,'Endpoint C #3 replaces B #1.',3,'user',new Date().toISOString());
 const run=await f.service.consolidate('c');assert.equal(run.throughOrdinal,3);assert.equal(run.minutesRevision,2);assert.ok(f.state.prompts[1].includes(original));assert.ok(f.state.prompts[1].includes('Endpoint C #3 replaces B #1.'));
 }finally{await f.close();}
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

test('cost preflight skips without cursor or calls; saved null resumes and actual usage refunds reservation', async () => {
 const f=await fixture({send:async(text,state)=>({finalResponse:JSON.stringify(text.startsWith('Extract')?{candidates:[candidate()]}:{decisions:[decision()]}),usage:{totalTokens:100,inputTokens:60,outputTokens:40,requests:1,unknownRequests:0}})});
 try {f.service.updateSettings({tokenLimit:1});const skip=await f.service.consolidate('c');assert.equal(skip.state,'skipped');assert.equal(skip.skipReason,'token-limit');assert.equal(skip.throughOrdinal,0);assert.equal(f.state.sends,0);
 f.service.updateSettings({tokenLimit:34000});const done=await f.service.consolidate('c');assert.equal(done.state,'completed');assert.equal(done.budget.tokens,200);assert.equal(done.budget.estimatedRequests,0);assert.equal(done.throughOrdinal,2);assert.equal(f.state.sends,2);
 assert.throws(()=>f.service.updateSettings({tokenLimit:0}),{code:'INVALID_CONSOLIDATION_SETTINGS'});f.service.updateSettings({tokenLimit:null});assert.equal(f.service.getSettings().tokenLimit,null);
 }finally{await f.close();}
});

test('output limit retains partial JSON and session across a cost skip and resumes without re-extraction', async () => {
 const extraction=JSON.stringify({candidates:[candidate()]});let sends=0;
 const f=await fixture({send:async(text,state)=>{sends++;if(sends===1)return {finalResponse:extraction.slice(0,60),stopReason:'max-tokens',usage:{totalTokens:32000,requests:1,unknownRequests:0}};if(sends===2)return {finalResponse:extraction.slice(60),stopReason:'completed',usage:{totalTokens:100,requests:1,unknownRequests:0}};return {finalResponse:JSON.stringify({decisions:[decision()]}),usage:{totalTokens:100,requests:1,unknownRequests:0}};}});
 try {f.service.updateSettings({tokenLimit:34000});const skip=await f.service.consolidate('c');assert.equal(skip.state,'skipped');assert.equal(skip.throughOrdinal,0);assert.equal(skip.pending.partialOutput,extraction.slice(0,60));const session=skip.pending.sessionId;assert.ok(session);assert.equal(sends,1);
 await f.service.close();const restarted=createMemoryConsolidator({db:f.db,host:f.host,chatStore:f.chats,minutes:f.minutes,store:f.store,retrieval:f.retrieval,modelFor:()=>model});restarted.updateSettings({tokenLimit:null});const done=await restarted.consolidate('c');assert.equal(done.state,'completed');assert.equal(done.throughOrdinal,2);assert.equal(sends,3);assert.equal(f.state.starts[1].sessionId,session);assert.ok(f.state.prompts[1].startsWith('Continue the JSON'));await restarted.close();
 }finally{await f.close();}
});

test('single oversized message uses durable lossless source offsets; a skipped fragment does not advance the whole message', async () => {
 let sends=0;const f=await fixture({service:{modelInfoFor:()=>({limits:{contextWindow:3000,maxOutputTokens:200,source:'declared'}})},send:async()=>{sends++;return {finalResponse:JSON.stringify({candidates:[]}),usage:{totalTokens:500,requests:1,unknownRequests:0}};}});
 try {const text=Array.from({length:1200},(_,i)=>`段落${i}具有不同科学记录。`).join('\n');f.db.prepare('UPDATE messages SET text=? WHERE id=?').run(text,'u');f.service.updateSettings({tokenLimit:3100});const skip=await f.service.consolidate('c');assert.equal(skip.state,'skipped');assert.equal(skip.throughOrdinal,0);assert.ok(sends>=1);
 const first=sends;f.service.updateSettings({tokenLimit:null});const done=await f.service.consolidate('c');assert.equal(done.throughOrdinal,2);assert.equal(done.state,'completed');
 const delivered=f.state.prompts.filter(p=>p.startsWith('Extract')).flatMap(p=>JSON.parse(p.split('Original messages:')[1])).filter(m=>m.id==='u');assert.equal(delivered.map(m=>m.text).join(''),text);assert.ok(delivered.every(m=>m.sourceSpan.sha256));assert.ok(first<sends);
 }finally{await f.close();}
});

test('completed whole batches retain proposals and cursor when a later batch is skipped', async () => {
 const f=await fixture({service:{modelInfoFor:()=>({limits:{contextWindow:6000,maxOutputTokens:1000,source:'declared'}})},send:async text=>{
 if(text.startsWith('Extract')){const messages=JSON.parse(text.split('Original messages:')[1]);return {finalResponse:JSON.stringify({candidates:[candidate({title:messages[0].id,evidence:[{messageId:messages[0].id,quote:'We choose endpoint B.'}]})]}),usage:{totalTokens:1200,unknownRequests:0}};}
 return {finalResponse:JSON.stringify({decisions:[decision()]}),usage:{totalTokens:1200,unknownRequests:0}};
 }});
 try {const source='We choose endpoint B.'+'x'.repeat(11000);f.db.prepare('UPDATE messages SET text=? WHERE id=?').run(source,'u');f.db.prepare('UPDATE messages SET text=? WHERE id=?').run(source,'a');f.service.updateSettings({tokenLimit:5300});const skip=await f.service.consolidate('c');assert.equal(skip.state,'skipped');assert.equal(skip.throughOrdinal,1);assert.equal(skip.proposalIds.length,1);assert.equal(skip.completedBatches,1);assert.equal(f.store.listProposals().length,1);
 f.service.updateSettings({tokenLimit:null});const done=await f.service.consolidate('c');assert.equal(done.throughOrdinal,2);assert.equal(done.proposalIds.length,1);assert.equal(f.store.listProposals().length,2);
 }finally{await f.close();}
});

test('model declares output limit; cache and reasoning are not double counted; missing usage is labelled', async () => {
 const f=await fixture({service:{modelInfoFor:()=>({limits:{contextWindow:20000,maxOutputTokens:4000,source:'declared'}})},send:async text=>({finalResponse:JSON.stringify(text.startsWith('Extract')?{candidates:[candidate()]}:{decisions:[decision()]}),usage:{inputTokens:100,cacheReadTokens:50,cacheWriteTokens:20,outputTokens:30,reasoningTokens:10,unknownRequests:0}})});
 try {const run=await f.service.consolidate('c');assert.equal(run.budget.tokens,400);assert.equal(run.budget.estimatedRequests,0);assert.equal(run.limits.source,'declared');assert.ok(f.state.starts.every(s=>s.maxTokens===4000));}
 finally{await f.close();}
 const unknown=await fixture();try{const run=await unknown.service.consolidate('c');assert.equal(run.budget.estimatedRequests,2);assert.equal(run.budget.usageSource,'actual-and-estimated');}finally{await unknown.close();}
});

test('source changes refuse a saved fragment checkpoint without promoting partial candidates', async () => {
 const f=await fixture({service:{modelInfoFor:()=>({limits:{contextWindow:3000,maxOutputTokens:200,source:'declared'}})},send:async()=>({finalResponse:'{"candidates":[]}',usage:{totalTokens:500,unknownRequests:0}})});
 try {f.db.prepare('UPDATE messages SET text=? WHERE id=?').run('字'.repeat(10000),'u');f.service.updateSettings({tokenLimit:3000});const skipped=await f.service.consolidate('c');assert.equal(skipped.throughOrdinal,0);f.db.prepare('UPDATE messages SET text=? WHERE id=?').run('User corrected source.','u');f.service.updateSettings({tokenLimit:null});await assert.rejects(f.service.consolidate('c'),{code:'CHECKPOINT_SOURCE_CHANGED'});assert.equal(f.store.listProposals().length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM rb_consolidation_pending').get().n,0);}
 finally{await f.close();}
});


test('over-window compared item is delivered losslessly before the final decision', async () => {
 const f=await fixture({service:{modelInfoFor:()=>({limits:{contextWindow:4000,maxOutputTokens:300,source:'declared'}})},send:async text=>({finalResponse:JSON.stringify(text.startsWith('Extract')?{candidates:[candidate()]}:text.startsWith('Inspect')?{observations:[]}:{decisions:[decision()]}),usage:{totalTokens:100,unknownRequests:0}})});
 try{const body='Endpoint protocol. '+Array.from({length:900},(_,i)=>`Measurement-${i} is retained.`).join('\n')+' Final endpoint B.';const item=f.store.createItem({type:'memory',subtype:'decision',projectId:'p',title:'Endpoint',body});f.service.updateSettings({tokenLimit:null});const run=await f.service.consolidate('c');assert.equal(run.state,'completed');
 const parts=f.state.prompts.filter(p=>p.startsWith('Inspect')).map(p=>JSON.parse(p.split('Source:')[1])).filter(p=>p.id===item.id);assert.ok(parts.length>1);assert.equal(parts.map(p=>p.text).join(''),JSON.stringify(f.store.getItem(item.id)));assert.ok(f.state.starts.every(s=>!s.sessionId),'source pages use independent sessions without accumulated context');assert.equal(run.throughOrdinal,2);
 }finally{await f.close();}
});


test('typed provider context overflow re-pages the unchanged source rather than losing bytes', async () => {
 let failed=false;const f=await fixture({send:async text=>{if(!failed){failed=true;throw Object.assign(new Error('provider rejected context'),{code:'CONTEXT_OVERFLOW'});}return {finalResponse:'{"candidates":[]}',usage:{totalTokens:50,unknownRequests:0}};}});
 try{const original='We choose endpoint B.'+'x'.repeat(6000);f.db.prepare('UPDATE messages SET text=? WHERE id=?').run(original,'u');f.service.updateSettings({tokenLimit:null});const run=await f.service.consolidate('c');assert.equal(run.state,'completed');assert.equal(run.throughOrdinal,2);const delivered=f.state.prompts.slice(1).flatMap(p=>JSON.parse(p.split('Original messages:')[1])).filter(m=>m.id==='u');assert.equal(delivered.map(m=>m.text).join(''),original);assert.equal(run.budget.estimatedRequests,1);}
 finally{await f.close();}
});

test('minutes evidence ranges expand every original message before revision cursor advances', async () => {
 const f=await fixture();try{await f.chats.appendMessage({chatId:'c',id:'u3',role:'user',text:'Endpoint B remains current.'});f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c',1,'Endpoint B #1–#3.',3,'user',new Date().toISOString());f.state.extract={candidates:[]};const run=await f.service.consolidate('c');assert.equal(run.minutesRevision,1);const originals=JSON.parse(f.state.prompts[0].split('Original messages:')[1]);assert.deepEqual(originals.map(m=>m.ordinal),[1,2,3]);}
 finally{await f.close();}
});

test('a continuation may return a complete JSON replacement while the prior prefix remains diagnostic', async () => {
 let sends=0;const f=await fixture({send:async text=>{sends++;return sends===1?{finalResponse:'{"candidates":[',stopReason:'max-tokens',usage:{totalTokens:10,unknownRequests:0}}:{finalResponse:JSON.stringify(text.startsWith('Compare')?{decisions:[decision()]}:{candidates:[candidate()]}),usage:{totalTokens:10,unknownRequests:0}};}});
 try{f.service.updateSettings({tokenLimit:null});const run=await f.service.consolidate('c');assert.equal(run.state,'completed');assert.equal(run.proposalIds.length,1);assert.equal(sends,3);}
 finally{await f.close();}
});

test('long user minutes are processed in complete delta pages with corresponding original evidence', async () => {
 const f=await fixture({service:{modelInfoFor:()=>({limits:{contextWindow:3500,maxOutputTokens:300,source:'declared'}})},send:async text=>{if(text.startsWith('Inspect')){const source=JSON.parse(text.split('Source:')[1]);return {finalResponse:JSON.stringify({observations:[{sourceId:source.id,quote:source.text,fact:'Observed original text.'}]}),usage:{totalTokens:100,unknownRequests:0}};}return {finalResponse:'{"candidates":[]}',usage:{totalTokens:100,unknownRequests:0}};}});
 try{const long='用户确认'+Array.from({length:900},(_,i)=>`科学协议第${i}条保留原始测量。`).join('')+' #1–#2';f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c',1,long,2,'user',new Date().toISOString());f.service.updateSettings({tokenLimit:null});const run=await f.service.consolidate('c');assert.equal(run.state,'completed');assert.equal(run.minutesRevision,1);const deltas=f.state.prompts.filter(p=>p.startsWith('Extract')).map(p=>JSON.parse(p.split('Minutes delta:')[1].split('\nOriginal messages:')[0]));assert.equal(deltas.flatMap(d=>d.added).join(''),long);assert.equal(run.throughOrdinal,2);}
 finally{await f.close();}
});

test('oversized validated observations page decisions conservatively preserve disagreement', async () => {
 let decide=0;const f=await fixture({service:{modelInfoFor:()=>({limits:{contextWindow:5000,maxOutputTokens:300,source:'declared'}})},send:async text=>{
 if(text.startsWith('Extract'))return {finalResponse:JSON.stringify({candidates:[candidate()]}),usage:{totalTokens:50,unknownRequests:0}};
 if(text.startsWith('Inspect')){const source=JSON.parse(text.split('Source:')[1]);const quote=source.text.slice(0,180);return {finalResponse:JSON.stringify({observations:Array.from({length:15},()=>({sourceId:source.id,quote,fact:'Source states endpoint protocol.'}))}),usage:{totalTokens:50,unknownRequests:0}};}
 decide++;return {finalResponse:JSON.stringify({decisions:[decision({op:decide%2?'create':'noop',rationale:'Only inspected page supports this response.'})]}),usage:{totalTokens:50,unknownRequests:0}};
 }});
 try{f.store.createItem({type:'memory',subtype:'decision',projectId:'p',title:'Endpoint',body:'Endpoint protocol. '+'x'.repeat(30000)});f.service.updateSettings({tokenLimit:null});const run=await f.service.consolidate('c');assert.equal(run.state,'skipped');assert.equal(run.skipReason,'observation-conflict');assert.ok(decide>1);assert.equal(run.observationConflicts,1);assert.equal(run.proposalIds.length,0);assert.equal(run.throughOrdinal,0);}
 finally{await f.close();}
});

test('consistent operations across actual over-window observation pages commit once and account every call', async () => {
 let sends=0,decisions=0;const f=await fixture({service:{modelInfoFor:()=>({limits:{contextWindow:5000,maxOutputTokens:300,source:'declared'}})},send:async text=>{sends++;let value;
 if(text.startsWith('Extract'))value={candidates:[candidate()]};else if(text.startsWith('Inspect')){const source=JSON.parse(text.split('Source:')[1]);value={observations:Array.from({length:15},()=>({sourceId:source.id,quote:source.text.slice(0,180),fact:'Original supports the endpoint protocol.'}))};}else{decisions++;value={decisions:[decision()]};}
 return {finalResponse:JSON.stringify(value),usage:{totalTokens:50,unknownRequests:0}};
 }});
 try{f.store.createItem({type:'memory',subtype:'decision',projectId:'p',title:'Endpoint',body:'Endpoint protocol. '+'x'.repeat(30000)});f.service.updateSettings({tokenLimit:null});const run=await f.service.consolidate('c');assert.equal(run.state,'completed');assert.ok(decisions>1);assert.equal(run.proposalIds.length,1);assert.equal(run.throughOrdinal,2);assert.equal(run.budget.tokens,sends*50);assert.equal(run.budget.requests,sends);assert.ok(f.state.prompts.filter(p=>p.startsWith('Compare')).every(p=>p.includes('omitted pages are still pending, not evidence of absence')));}
 finally{await f.close();}
});

test('an observation stays whole with its supporting quote; context skip resumes after capacity change', async () => {
 let capacity=5000;const quote='Support text '+ 'x'.repeat(1800);const fact='Detailed fact '+ 'y'.repeat(18000);
 const f=await fixture({service:{modelInfoFor:()=>({limits:{contextWindow:capacity,maxOutputTokens:300,source:'configured'}})},send:async text=>{const value=text.startsWith('Extract')?{candidates:[candidate()]}:text.startsWith('Inspect')?{observations:[{sourceId:JSON.parse(text.split('Source:')[1]).id,quote:JSON.parse(text.split('Source:')[1]).text.slice(0,1800),fact}]}:{decisions:[decision()]};return {finalResponse:JSON.stringify(value),usage:{totalTokens:50,unknownRequests:0}};}});
 try{f.store.createItem({type:'memory',subtype:'decision',projectId:'p',title:'Endpoint',body:quote+'z'.repeat(25000)});f.service.updateSettings({tokenLimit:null});const skipped=await f.service.consolidate('c');assert.equal(skipped.state,'skipped');assert.equal(skipped.skipReason,'model-context');assert.equal(skipped.throughOrdinal,0);assert.equal(skipped.proposalIds.length,0);
 const checkpoint=JSON.parse(f.db.prepare('SELECT checkpoint_json FROM rb_consolidation_pending').get().checkpoint_json);assert.equal(checkpoint.blockedObservation.fact,fact);assert.ok(checkpoint.read.observations.some(o=>o.quote===checkpoint.blockedObservation.quote&&o.fact===checkpoint.blockedObservation.fact));capacity=100000;const done=await f.service.consolidate('c');assert.equal(done.state,'completed');assert.equal(done.throughOrdinal,2);
 }finally{await f.close();}
});

test('over-window minutes ranges deliver every original and retain exact evidence', async () => {
 const f=await fixture({service:{modelInfoFor:()=>({limits:{contextWindow:4500,maxOutputTokens:300,source:'declared'}})},send:async text=>{
 if(text.startsWith('Inspect')){const source=JSON.parse(text.split('Source:')[1]);return {finalResponse:JSON.stringify({observations:[{sourceId:source.id,quote:source.text.slice(0,100),fact:'Explicit original evidence.'}]}),usage:{totalTokens:50,unknownRequests:0}};}return {finalResponse:'{"candidates":[]}',usage:{totalTokens:50,unknownRequests:0}};
 }});
 try{for(const id of ['u','a'])f.db.prepare('UPDATE messages SET text=? WHERE id=?').run(id+' '.repeat(100)+'x'.repeat(13000),id);await f.chats.appendMessage({chatId:'c',id:'u3',role:'user',text:'Third original.'+'x'.repeat(13000)});f.db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run('c',1,'Correction cites #1–#3.',3,'user',new Date().toISOString());f.service.updateSettings({tokenLimit:null});const run=await f.service.consolidate('c');assert.equal(run.state,'completed');assert.equal(run.minutesRevision,1);
 const sources=f.state.prompts.filter(p=>p.startsWith('Inspect')).map(p=>JSON.parse(p.split('Source:')[1]));assert.deepEqual([...new Set(sources.map(p=>p.id))].sort(),['a','u','u3']);assert.equal(run.throughOrdinal,3);
 }finally{await f.close();}
});

test('failed stream output is retained as uncommitted; later explicit run does not concatenate it', async () => {
 const f=await fixture();let calls=0;f.host.send=async input=>{calls++;input.onEvent?.({type:'text-delta',delta:calls===1?'uncommitted prefix':'fresh complete output'});if(calls===1)throw new Error('stream-cut');return {finalResponse:JSON.stringify(input.text.startsWith('Extract')?{candidates:[]}:{decisions:[]}),usage:{totalTokens:50,unknownRequests:0}};};
 try{f.service.updateSettings({tokenLimit:null});await assert.rejects(f.service.consolidate('c'),{code:'MODEL_FAILED'});const failed=f.service.status('c');assert.equal(failed.retainedOutputs[0].text,'uncommitted prefix');assert.equal(failed.retainedOutputs[0].committed,false);assert.equal(failed.throughOrdinal,0);
 const done=await f.service.consolidate('c');assert.equal(done.state,'completed');assert.equal(done.throughOrdinal,2);assert.equal(calls,2);assert.ok(f.state.starts.every(s=>!s.sessionId));
 }finally{await f.close();}
});
