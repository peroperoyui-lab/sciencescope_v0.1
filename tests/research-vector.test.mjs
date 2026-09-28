import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createVectorStore } from '../scripts/research-base/vector-store.mjs';

const unit = (axis) => axis === 'b' ? new Float32Array([0, 1, 0]) : new Float32Array([1, 0, 0]);
function fakeEmbedding({ ready = true, modelId = 'local/test', modelVersion = 'v1' } = {}) {
  const seen = [];
  return {
    seen,
    status: () => ({ ready, modelId, modelVersion }),
    modelId: () => modelId,
    modelVersion: () => modelVersion,
    async embedPassages(texts) { seen.push(...texts); return texts.map((text) => unit(text.includes('beta') ? 'b' : 'a')); },
    async embedQuery(text) { return unit(text.includes('beta') ? 'b' : 'a'); },
  };
}

async function fixture() {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'research-vector-'));
  return { root, dbPath: path.join(root, 'base.sqlite'), close: () => rm(root, { recursive: true, force: true }) };
}

test('sqlite-vec filters candidates before KNN, persists normalized vectors and supports long model partitions', async () => {
  const f = await fixture();
  // sqlite-vec 0.1.9 was probed with >1,000 character partition values and
  // metadata IN; keep similarly long values here as a compatibility guard.
  const modelId = `local/${'name'.repeat(250)}`;
  const modelVersion = `revision-${'v'.repeat(1200)}`;
  const embedding = fakeEmbedding({ modelId, modelVersion });
  let store;
  try {
    store = await createVectorStore({ dbPath: f.dbPath, embedding, modelId, modelVersion, dimensions: 3 });
    const docs = [
      { ref: { type: 'item', id: 'itm_public' }, version: '1', text: 'alpha public' },
      { ref: { type: 'item', id: 'itm_private' }, version: '1', text: 'beta private' },
    ];
    assert.deepEqual(await store.upsertDocuments(docs), { indexed: 2, skipped: 0 });
    assert.deepEqual(await store.upsertDocuments(docs), { indexed: 0, skipped: 2 });
    assert.deepEqual(store.status(), { mode: 'sqlite-vec', count: 2, modelId, modelVersion, dimensions: 3 });

    const visibleOnly = await store.search({
      queries: ['alpha'],
      candidates: [{ ref: docs[0].ref, version: docs[0].version }],
      limit: 30,
    });
    assert.equal(visibleOnly.rankings[0].length, 1);
    assert.deepEqual(visibleOnly.rankings[0][0].ref, docs[0].ref);
    assert.ok(!visibleOnly.rankings[0].some(({ ref }) => ref.id === 'itm_private'));

    const incomplete = await store.search({ queries: ['alpha'], candidates: [{ ref: { type: 'item', id: 'itm_not_indexed' }, version: '1' }] });
    assert.equal(incomplete.fallbackReason, 'index-incomplete');
    assert.deepEqual(await store.removeMissing([docs[1].ref]), { removed: 1 });
    assert.equal(store.status().count, 1);
    await store.close();
    store = null;

    store = await createVectorStore({ dbPath: f.dbPath, embedding, modelId, modelVersion, dimensions: 3 });
    assert.equal(store.status().count, 1);
    const afterReopen = await store.search({ queries: ['beta'], candidates: [{ ref: docs[1].ref, version: '1' }] });
    assert.deepEqual(afterReopen.rankings[0][0].ref, docs[1].ref);
  } finally {
    await store?.close();
    await f.close();
  }
});

test('search reports incomplete before cold embedding and mismatched model metadata requests rebuild', async () => {
  const f = await fixture();
  const cold = fakeEmbedding({ ready: false });
  let store;
  try {
    store = await createVectorStore({ dbPath: f.dbPath, embedding: cold, modelId: 'local/test', modelVersion: 'v1', dimensions: 3 });
    const candidate = { ref: { type: 'source', id: 'src_one' }, version: '1' };
    assert.equal((await store.search({ queries: ['alpha'], candidates: [candidate] })).fallbackReason, 'index-incomplete');
    assert.deepEqual(cold.seen, []);
    await store.close();
    store = null;

    const warm = fakeEmbedding();
    let rebuilds = 0;
    store = await createVectorStore({ dbPath: f.dbPath, embedding: warm, modelId: 'local/test', modelVersion: 'v1', dimensions: 3, onRebuild: () => { rebuilds += 1; } });
    await store.upsertDocuments([{ ...candidate, text: 'alpha source' }]);
    await store.close();
    store = null;

    const newer = fakeEmbedding();
    store = await createVectorStore({ dbPath: f.dbPath, embedding: newer, modelId: 'local/test', modelVersion: 'v2', dimensions: 3, onRebuild: () => { rebuilds += 1; } });
    const result = await store.search({ queries: ['alpha'], candidates: [candidate] });
    assert.equal(result.fallbackReason, 'model-version-mismatch');
    assert.equal(rebuilds, 1);
  } finally {
    await store?.close();
    await f.close();
  }
});

test('upsert replaces stale document versions and rejects invalid embeddings atomically', async () => {
  const f = await fixture();
  const embedding = fakeEmbedding();
  let store;
  try {
    store = await createVectorStore({ dbPath: f.dbPath, embedding, modelId: 'local/test', modelVersion: 'v1', dimensions: 3 });
    const ref = { type: 'chunk', id: 'chunk_1' };
    await store.upsertDocuments([{ ref, version: 'old', text: 'alpha' }]);
    await store.upsertDocuments([{ ref, version: 'new', text: 'beta' }]);
    assert.equal(store.status().count, 1);
    const result = await store.search({ queries: ['beta'], candidates: [{ ref, version: 'new' }] });
    assert.deepEqual(result.rankings[0][0].ref, ref);

    const invalid = { ...embedding, async embedPassages() { return [[0, 0, 0]]; } };
    await store.close();
    store = await createVectorStore({ dbPath: f.dbPath, embedding: invalid, modelId: 'local/test', modelVersion: 'v1', dimensions: 3 });
    await assert.rejects(store.upsertDocuments([{ ref: { type: 'chunk', id: 'chunk_bad' }, version: '1', text: 'invalid' }]), { code: 'EMBEDDING_INVALID_VECTOR' });
    assert.equal(store.status().count, 1);
  } finally {
    await store?.close();
    await f.close();
  }
});

