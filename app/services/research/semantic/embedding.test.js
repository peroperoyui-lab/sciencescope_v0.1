import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tempDir } from '../../../testing.js';
import { createEmbedding } from './embedding.js';

async function fixture(run) {
  const temporary = await tempDir('embedding-worker-protocol');
  const bytes = Buffer.from('local protocol fixture, not a model');
  const manifest = {
    modelId: 'fixture',
    revision: 'fixture-v1',
    dimensions: 1,
    maxTokens: 32,
    files: [
      {
        path: 'fixture.bin',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
  };
  await writeFile(path.join(temporary.dir, 'fixture.bin'), bytes);
  const embedding = createEmbedding({
    modelDir: temporary.dir,
    modelId: manifest.modelId,
    manifest,
    workerUrl: new URL('./fixtures/embedding-worker-testing.js', import.meta.url),
  });
  try {
    await run(embedding);
  } finally {
    await embedding.close();
    await temporary.cleanup();
  }
}

test('local worker starts once and matches concurrent request IDs despite reversed responses', () =>
  fixture(async (embedding) => {
    assert.equal(embedding.status().state, 'cold');
    const statuses = await Promise.all([embedding.warmup(), embedding.warmup()]);
    assert.ok(statuses.every((status) => status.ready));
    const [query, passages] = await Promise.all([
      embedding.embedQuery('alpha'),
      embedding.embedPassages(['beta', 'gamma']),
    ]);
    assert.deepEqual(query, ['query: alpha'.length]);
    assert.deepEqual(passages, [['passage: beta'.length], ['passage: gamma'.length]]);
  }));

test('worker exit rejects every in-flight request and records the exit reason', () =>
  fixture(async (embedding) => {
    await embedding.warmup();
    const results = await Promise.allSettled([
      embedding.embedQuery('exit-pending-a'),
      embedding.embedQuery('exit-pending-b'),
    ]);
    assert.equal(results.length, 2);
    for (const result of results) {
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason.code, 'EMBEDDING_WORKER_EXIT');
      assert.match(result.reason.message, /\(7\)/u);
    }
    assert.equal(embedding.status().state, 'failed');
    assert.equal(embedding.status().reason, 'EMBEDDING_WORKER_EXIT');
  }));

test('closing a local worker rejects pending work and remains idempotent', () =>
  fixture(async (embedding) => {
    await embedding.warmup();
    const pending = embedding.embedQuery('hold');
    const rejected = assert.rejects(pending, { code: 'EMBEDDING_CLOSED' });
    await embedding.close();
    await rejected;
    await embedding.close();
    await assert.rejects(embedding.warmup(), { code: 'EMBEDDING_CLOSED' });
  }));
