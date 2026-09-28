import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { openApplicationDatabaseSync } from '../scripts/application-database.mjs';
import { createResearchBase } from '../scripts/research-base/index.mjs';
import { fuseHybridRankings, normalizeHybridQueries } from '../scripts/research-base/hybrid.mjs';

async function fixture() {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'research-hybrid-'));
  const database = openApplicationDatabaseSync({ stateDir: root });
  const research = createResearchBase({ database, resolveResourcePath: async () => null });
  return {
    root,
    database,
    research,
    close: async () => { database.close(); await rm(root, { recursive: true, force: true }); },
  };
}

async function seededFixture() {
  const f = await fixture();
  const { store } = f.research;
  const source = store.addSource({ id: 'src-hybrid-public', projectId: 'p1', title: 'Public Study', abstract: 'alpha evidence' });
  store.replaceChunks(source.id, [{ kind: 'paragraph', text: 'alpha passage', page: 1 }], { contentStatus: 'parsed' });
  const privateSource = store.addSource({ id: 'src-hybrid-other', projectId: 'p2', title: 'Other Study', abstract: 'alpha private scope' });
  store.replaceChunks(privateSource.id, [{ kind: 'paragraph', text: 'alpha other project', page: 1 }], { contentStatus: 'parsed' });
  const publicItem = store.createItem({ id: 'itm_hybrid_public', type: 'knowledge', subtype: 'finding', projectId: 'p1', title: 'Public alpha', body: 'alpha finding' });
  const personalItem = store.createItem({ id: 'itm_hybrid_personal', type: 'memory', subtype: 'preference', scope: 'personal', title: 'Personal note', body: 'private to the user' });
  const privateItem = store.createItem({ id: 'itm_hybrid_private', type: 'memory', subtype: 'preference', projectId: 'p1', title: 'Private alpha', body: 'alpha secret', visibility: 'private' });
  const expertItem = store.createItem({ id: 'itm_hybrid_expert', type: 'memory', subtype: 'lesson', projectId: 'p1', scope: 'expert:analyst', title: 'Expert alpha', body: 'alpha expert-only' });
  const otherItem = store.createItem({ id: 'itm_hybrid_other', type: 'knowledge', subtype: 'finding', projectId: 'p2', title: 'Other alpha', body: 'alpha other project' });
  const supersededItem = store.createItem({ id: 'itm_hybrid_old', type: 'knowledge', subtype: 'finding', projectId: 'p1', title: 'Old alpha', body: 'alpha old' }, { status: 'superseded' });
  const proposedItem = store.createItem({ id: 'itm_hybrid_pending', type: 'knowledge', subtype: 'finding', projectId: 'p1', title: 'Pending alpha', body: 'alpha pending' }, { status: 'proposed' });
  return { ...f, source, privateSource, publicItem, personalItem, privateItem, expertItem, otherItem, supersededItem, proposedItem };
}

test('listCandidates shares project, personal, status, visibility and expert filtering and supplies versions', async () => {
  const f = await seededFixture();
  try {
    const { retrieval } = f.research;
    assert.equal(typeof retrieval.listCandidates, 'function');
    const candidates = retrieval.listCandidates({ projectId: 'p1', audience: 'agent', expertId: 'reviewer' });
    const keys = new Set(candidates.map(({ ref }) => `${ref.type}:${ref.id}`));
    assert.ok(keys.has(`source:${f.source.id}`));
    assert.ok(keys.has(`chunk:${f.source.id}-c0`));
    assert.ok(keys.has(`item:${f.publicItem.id}`));
    assert.ok(!keys.has(`source:${f.privateSource.id}`));
    assert.ok(!keys.has(`item:${f.privateItem.id}`));
    assert.ok(!keys.has(`item:${f.expertItem.id}`));
    assert.ok(!keys.has(`item:${f.otherItem.id}`));
    assert.ok(!keys.has(`item:${f.supersededItem.id}`));
    assert.ok(!keys.has(`item:${f.proposedItem.id}`));
    const itemCandidate = candidates.find(({ ref }) => ref.id === f.publicItem.id);
    assert.equal(itemCandidate.version, String(f.publicItem.revision));
    const currentSource = f.research.store.getSource(f.source.id);
    const sourceCandidate = candidates.find(({ ref }) => ref.id === f.source.id);
    assert.equal(sourceCandidate.version, currentSource.updatedAt);
    const chunkCandidate = candidates.find(({ ref }) => ref.type === 'chunk' && ref.id === `${f.source.id}-c0`);
    assert.equal(chunkCandidate.version, currentSource.updatedAt);

    const globalCandidates = retrieval.listCandidates({ projectIds: [null, 'p2'], audience: 'agent' });
    const globalProjectIds = new Set(globalCandidates.flatMap(({ ref }) => {
      const source = ref.type === 'item' ? f.research.store.getItem(ref.id)
        : ref.type === 'source' ? f.research.store.getSource(ref.id)
          : f.research.store.getSource(f.research.store.getChunk(ref.id)?.sourceId);
      return [source?.projectId ?? null];
    }));
    assert.deepEqual([...globalProjectIds].sort(), [null, 'p2']);
  } finally { await f.close(); }
});

test('searchHybrid merges query/query-list, fuses weighted RRF and stabilizes ties by ref', async () => {
  const f = await seededFixture();
  try {
    const { retrieval } = f.research;
    const itemA = f.research.store.createItem({ id: 'itm_hybrid_a', type: 'knowledge', subtype: 'finding', projectId: 'p1', title: 'Alpha A', body: 'alpha' });
    const itemB = f.research.store.createItem({ id: 'itm_hybrid_b', type: 'knowledge', subtype: 'finding', projectId: 'p1', title: 'Alpha B', body: 'alpha' });
    let call;
    retrieval.setVectorRetriever({
      async search(input) {
        call = input;
        const a = { type: 'item', id: itemA.id };
        const b = { type: 'item', id: itemB.id };
        return { rankings: input.queries.map((query) => query === 'no-hit-a' ? [{ ref: a }, { ref: b }] : [{ ref: b }, { ref: a }]) };
      },
    });
    const result = await retrieval.searchHybrid({
      query: 'no-hit-a', queries: ['no-hit-b', ' no-hit-a ', 'NO-HIT-B'], projectId: 'p1',
      docTypes: ['item'], itemTypes: ['knowledge'], audience: 'agent', k: 10,
    });
    assert.equal(result.mode, 'hybrid');
    assert.equal(result.fallbackReason, undefined);
    assert.deepEqual(call.queries, ['no-hit-a', 'no-hit-b']);
    assert.equal(call.limit, 30);
    assert.ok(Array.isArray(call.candidates));
    assert.ok(call.candidates.every((candidate) => candidate.ref.type === 'item'));
    assert.deepEqual(result.hits.slice(0, 2).map((hit) => hit.ref.id), [itemA.id, itemB.id].sort());
    assert.equal(result.hits[0].score, result.hits[1].score, 'cross-query ranks are summed before stable identity tie-break');
  } finally { await f.close(); }
});

test('searchHybrid removes untrusted vector refs before assigning ranks and fusing', async () => {
  const f = await seededFixture();
  try {
    const { retrieval } = f.research;
    const visible = { type: 'item', id: f.publicItem.id };
    const privateRef = { type: 'item', id: f.privateItem.id };
    const crossProjectRef = { type: 'item', id: f.otherItem.id };
    retrieval.setVectorRetriever({ async search() { return { rankings: [[{ ref: privateRef }, { ref: crossProjectRef }, { ref: visible }]] }; } });
    const result = await retrieval.searchHybrid({ query: 'alpha', projectId: 'p1', docTypes: ['item'], audience: 'agent' });
    assert.deepEqual(result.hits.map((hit) => hit.ref), [visible]);
    assert.equal(result.hits[0].score, 1.5 / 61, 'the first permitted result is reranked at rank 1 after filtering and also receives its keyword rank');
  } finally { await f.close(); }
});

test('searchHybrid falls back with model, index and version reasons', async (t) => {
  const f = await seededFixture();
  try {
    const { retrieval } = f.research;
    const keyword = retrieval.search({ query: 'alpha', projectId: 'p1', docTypes: ['item'], audience: 'agent' });
    for (const fallbackReason of ['index-incomplete', 'model-version-mismatch']) {
      await t.test(fallbackReason, async () => {
        retrieval.setVectorRetriever({ async search() { return { rankings: [], fallbackReason }; } });
        const result = await retrieval.searchHybrid({ query: 'alpha', projectId: 'p1', docTypes: ['item'], audience: 'agent' });
        assert.equal(result.mode, 'keyword');
        assert.equal(result.fallbackReason, fallbackReason);
        assert.deepEqual(result.hits.map(({ ref }) => ref), keyword.map(({ ref }) => ref));
      });
    }
    retrieval.setVectorRetriever(null);
    const missing = await retrieval.searchHybrid({ query: 'alpha', projectId: 'p1', docTypes: ['item'], audience: 'agent' });
    assert.equal(missing.mode, 'keyword');
    assert.equal(missing.fallbackReason, 'model-missing');
  } finally { await f.close(); }
});

test('searchHybrid applies one 300ms vector deadline to all six queries and discards late vectors', async () => {
  const f = await seededFixture();
  try {
    const { retrieval } = f.research;
    let observedSignal;
    let queryCount = 0;
    retrieval.setVectorRetriever({
      search({ queries, signal }) {
        queryCount += 1;
        assert.equal(queries.length, 6);
        observedSignal = signal;
        return new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ rankings: [Array(6).fill([])] }), { once: true });
        });
      },
    });
    const started = performance.now();
    const result = await retrieval.searchHybrid({ queries: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], projectId: 'p1', docTypes: ['item'] });
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 250 && elapsed < 900, `one shared deadline should bound all vector work (elapsed ${elapsed.toFixed(1)} ms)`);
    assert.equal(queryCount, 1, 'all queries share a single vector-stage invocation and timeout');
    assert.equal(observedSignal.aborted, true);
    assert.equal(result.mode, 'keyword');
    assert.equal(result.fallbackReason, 'timeout');
  } finally { await f.close(); }
});

test('searchHybrid validates and deduplicates query inputs and keeps search synchronous', async () => {
  const f = await seededFixture();
  try {
    const { retrieval } = f.research;
    assert.equal(typeof retrieval.search({ query: 'alpha', projectId: 'p1' }).then, 'undefined');
    const calls = [];
    retrieval.setVectorRetriever({ async search({ queries }) { calls.push(queries); return { rankings: queries.map(() => []) }; } });
    await retrieval.searchHybrid({ query: 'alpha', queries: ['beta', ' alpha ', 'BETA'], projectId: 'p1' });
    assert.deepEqual(calls[0], ['alpha', 'beta']);
    await assert.rejects(retrieval.searchHybrid({ queries: [] }), { code: 'INVALID_QUERY' });
    await assert.rejects(retrieval.searchHybrid({ queries: Array.from({ length: 7 }, (_, i) => `q${i}`) }), { code: 'INVALID_QUERY' });
    await assert.rejects(retrieval.searchHybrid({ query: 'x'.repeat(2001) }), { code: 'INVALID_QUERY' });
    await assert.rejects(retrieval.searchHybrid({ queries: ['ok', ''] }), { code: 'INVALID_QUERY' });
  } finally { await f.close(); }
});

test('resolveCitation accepts comma-space and no-dot page variants while retaining labels', async () => {
  const f = await seededFixture();
  try {
    const label = f.source.label;
    for (const variant of [`[${label}, p.1]`, `[${label} p1]`]) {
      const resolved = f.research.retrieval.resolveCitation(variant, { projectId: 'p1' });
      assert.equal(resolved.ref.type, 'chunk');
      assert.equal(resolved.ref.id, `${f.source.id}-c0`);
      assert.equal(resolved.page, 1);
    }
    assert.equal(f.research.retrieval.resolveCitation('[S999, p.1]', { projectId: 'p1' }), null);
  } finally { await f.close(); }
});

test('shared hybrid helpers normalize queries and fuse arbitrary scoped refs', () => {
  assert.deepEqual(normalizeHybridQueries({ query: ' alpha ', queries: ['ALPHA', 'beta'] }), ['alpha', 'beta']);
  const messageA = { type: 'message', id: 'chat-1:msg-a' };
  const messageB = { type: 'message', id: 'chat-1:msg-b' };
  const privateMessage = { type: 'message', id: 'chat-2:private-msg' };
  const fused = fuseHybridRankings({
    vectorRankings: [[{ ref: privateMessage }, { ref: messageB }, { ref: messageA }]],
    keywordRankings: [[{ ref: messageA, excerpt: 'A' }, { ref: messageB, excerpt: 'B' }]],
    allowedRefs: new Set([messageA, messageB]),
    limit: 10,
  });
  assert.deepEqual(fused.map((row) => row.ref.id), [messageB.id, messageA.id]);
  assert.equal(fused[0].score, 1 / 61 + 0.5 / 62);
  assert.equal(fused[1].score, 1 / 62 + 0.5 / 61);
  assert.equal(fused[1].hit.excerpt, 'A');
});
