import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from './settings.js';

test('similarity preferences keep threshold boundaries, zero edges and unrestricted integer counts', () => {
  for (const similarity of [
    { threshold: -1, maxPerPaper: 0 },
    { threshold: 0, maxPerPaper: 3 },
    { threshold: 1, maxPerPaper: 1000000 },
  ]) {
    const saved = settings.apply(null, 'write', { settings: { knowledge: { similarity } } });
    assert.deepEqual(settings.parse(saved).knowledge.similarity, similarity);
    const patched = settings.apply(saved, 'patch', {
      changes: { knowledge: { similarity: { maxPerPaper: 0 } } },
    });
    assert.deepEqual(settings.parse(patched).knowledge.similarity, {
      ...similarity,
      maxPerPaper: 0,
    });
  }
});

test('similarity preferences reject nonfinite and nonnumeric values before JSON serialization', () => {
  for (const similarity of [
    { threshold: NaN, maxPerPaper: 3 },
    { threshold: Infinity, maxPerPaper: 3 },
    { threshold: '0.85', maxPerPaper: 3 },
    { threshold: 0.85, maxPerPaper: '3' },
  ])
    assert.throws(
      () => settings.apply(null, 'write', { settings: { knowledge: { similarity } } }),
      { code: 'INVALID_KNOWLEDGE_SIMILARITY', status: 400 },
    );
});
