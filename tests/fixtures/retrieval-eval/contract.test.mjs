import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { validateFrozenMapping, recallAt, memoryRecordOptions, APPROVED_GOLD_SHA256, PAPER_DENOMINATOR } from '../../../scripts/evals/real-corpus-retrieval.mjs';
import { openApplicationDatabaseSync } from '../../../scripts/application-database.mjs';
import { createResearchBase } from '../../../scripts/research-base/index.mjs';

const goldBytes = await readFile(new URL('./gold.json', import.meta.url));
const gold = JSON.parse(goldBytes);
const paperIds = gold.questions.filter((question) => question.category !== 'memory_synthetic').map((question) => question.id);
const goldSha256 = createHash('sha256').update(goldBytes).digest('hex');

test('retrieval eval frozen mapping and scoring contracts are offline and exact', () => {
  assert.equal(goldSha256, APPROVED_GOLD_SHA256);
  assert.equal(paperIds.length, PAPER_DENOMINATOR);
  assert.equal(new Set(paperIds).size, PAPER_DENOMINATOR);
  const frozen = { freezeStatus: 'FROZEN', immutableGoldSha256: goldSha256, mapping: paperIds.map((questionId) => ({ questionId })) };
  assert.equal(validateFrozenMapping(frozen, { goldSha256, questionIds: paperIds }), true);
  assert.equal(recallAt(['chunk-a', 'chunk-b'], ['chunk-b'], 2), true);
  assert.equal(recallAt(['chunk-a'], ['chunk-b'], 1), false);
  assert.equal(recallAt(['chunk-a'], [], 1), false);
  assert.throws(() => validateFrozenMapping({ ...frozen, mapping: [...frozen.mapping.slice(0, -1), { questionId: paperIds[0] }] }, { goldSha256, questionIds: paperIds }), /duplicate/u);
  assert.throws(() => validateFrozenMapping({ ...frozen, mapping: [...frozen.mapping.slice(0, -1), { questionId: 'not-approved' }] }, { goldSha256, questionIds: paperIds }), /exactly match/u);
});

test('memory fixture status and project scope use the real Research Base visibility rules', async () => {
  const root = await mkdtemp(path.resolve('.sciencescope-local/temp/retrieval-eval-unit-'));
  const database = openApplicationDatabaseSync({ stateDir: root });
  try {
    const research = createResearchBase({ database, resolveResourcePath: async () => { throw new Error('not used'); } });
    for (const record of [
      { id: 'confirmed-memory', project: 'local-validation-r4', status: 'confirmed', content: 'confirmed e5-small' },
      { id: 'candidate-memory', project: 'local-validation-r4', status: 'candidate', content: 'candidate e5-large' },
      { id: 'superseded-memory', project: 'local-validation-r4', status: 'superseded', content: 'old e5' },
      { id: 'private-other-project', project: 'other-project', status: 'confirmed', content: 'other private note' },
    ]) {
      const options = memoryRecordOptions(record);
      research.store.createItem({ id: record.id, type: 'memory', subtype: 'decision', projectId: options.projectId, scope: options.scope, title: record.id, body: record.content, visibility: options.visibility }, { status: options.status });
    }
    assert.equal(research.store.getItem('confirmed-memory').status, 'active');
    assert.equal(research.store.getItem('candidate-memory').status, 'proposed');
    assert.equal(research.store.getItem('superseded-memory').status, 'superseded');
    assert.deepEqual(research.retrieval.search({ query: 'confirmed e5-small', docTypes: ['item'], itemTypes: ['memory'], projectId: 'local-validation-r4', audience: 'agent', k: 10 }).map((hit) => hit.ref.id), ['confirmed-memory']);
    assert.equal(research.retrieval.search({ query: 'candidate e5-large', docTypes: ['item'], itemTypes: ['memory'], projectId: 'local-validation-r4', audience: 'agent', k: 10 }).some((hit) => hit.ref.id === 'candidate-memory'), false);
    assert.equal(research.retrieval.search({ query: 'old e5', docTypes: ['item'], itemTypes: ['memory'], projectId: 'local-validation-r4', audience: 'agent', k: 10 }).some((hit) => hit.ref.id === 'superseded-memory'), false);
    assert.equal(research.retrieval.search({ query: 'other private note', docTypes: ['item'], itemTypes: ['memory'], projectId: 'local-validation-r4', audience: 'agent', k: 10 }).some((hit) => hit.ref.id === 'private-other-project'), false);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});
