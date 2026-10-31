import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createDerived } from './derived.js';

test('similarity rebuilds use the saved parameter rules and preserve edges on invalid settings', () =>
  withCore('kb-similarity-validation', async (core) => {
    const sources = [
      { id: 'first', kind: 'paper' },
      { id: 'second', kind: 'paper' },
    ];
    const calls = [];
    const derived = createDerived({
      core,
      research: { store: { listSources: () => sources } },
      semantic: {
        async sourceNeighbors(ids, options) {
          calls.push({ ids, options });
          return {
            rankings: [{ id: 'first', neighbours: [{ id: 'second', score: 1 }] }],
          };
        },
      },
    });
    const edges = () => core.db.prepare('SELECT * FROM kb_edges').all();
    assert.equal(await derived.similar(null, { threshold: -1, maxPerPaper: 1 }), 'done');
    assert.equal(edges().length, 1);
    const before = edges();
    for (const similarity of [
      { threshold: 2, maxPerPaper: 3 },
      { threshold: 0.85, maxPerPaper: -1 },
      { threshold: 0.85, maxPerPaper: 1.5 },
    ])
      await assert.rejects(derived.similar(null, similarity), {
        code: 'INVALID_KNOWLEDGE_SIMILARITY',
        status: 400,
      });
    assert.equal(calls.length, 1);
    assert.deepEqual(edges(), before);
    assert.equal(await derived.similar('first', { threshold: 1, maxPerPaper: 1000000 }), 'done');
    assert.deepEqual(calls.at(-1).options, {
      sourceIds: ['first'],
      limit: 1000000,
      threshold: 1,
    });
    assert.deepEqual(edges(), before);
  }));
