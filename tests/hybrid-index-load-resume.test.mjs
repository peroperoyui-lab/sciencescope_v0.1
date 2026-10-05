import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import {
  assertResumeMetadata,
  fixtureDisposition,
  validateFixtureRows,
  validateResumeDirectory,
} from '../scripts/evals/hybrid-index-load.mjs';

const template = (id, text) => ({
  id,
  kind: 'file',
  title: `Title ${id}`,
  authors_json: '[]',
  year: 2024,
  venue: null,
  abstract: `Abstract ${id}`,
  language: 'en',
  chunks: [{ ordinal: 0, page: 1, section: null, kind: 'paragraph', text, char_start: 0, char_end: text.length, anchor_json: null }],
});
const corpus = [template('source-a', 'alpha'), template('source-b', 'beta')];
const sourceRow = (index, parser = 't10-load-fixture') => {
  const row = corpus[index % corpus.length];
  return {
    id: `src_t10load_${String(index + 1).padStart(4, '0')}`,
    project_id: 't10_load_fixture',
    kind: row.kind,
    title: row.title,
    authors_json: row.authors_json,
    year: row.year,
    venue: row.venue,
    abstract: row.abstract,
    language: row.language,
    content_status: 'parsed',
    parser,
  };
};
const chunkRow = (source, row) => ({
  id: `${source.id}-c0`, source_id: source.id, ...row.chunks[0],
});

test('fixture resume reuses complete records and repairs one source-only tail', () => {
  const complete = sourceRow(0);
  const partial = sourceRow(1, null);
  const state = validateFixtureRows({
    sourceRows: [complete, partial],
    chunkRows: [chunkRow(complete, corpus[0])],
    corpus,
  });
  assert.deepEqual(state, { completeSourceCount: 1, sourceOnlyIndex: 1, sourceCount: 2, chunkCount: 1 });
  assert.equal(fixtureDisposition(0, state, true), 'reuse');
  assert.equal(fixtureDisposition(1, state, true), 'repair');
  assert.equal(fixtureDisposition(2, state, true), 'add');
  assert.equal(fixtureDisposition(1, state, false), 'add');
});

test('fixture resume rejects corrupted or unrelated records', () => {
  const complete = sourceRow(0);
  const wrongChunk = { ...chunkRow(complete, corpus[0]), text: 'unrelated text' };
  assert.throws(() => validateFixtureRows({ sourceRows: [complete], chunkRows: [wrongChunk], corpus }), /CHUNK_MISMATCH/);
  assert.throws(() => validateFixtureRows({ sourceRows: [{ ...complete, id: 'src_unrelated' }], chunkRows: [], corpus }), /SOURCE_MISMATCH/);
  assert.throws(() => validateFixtureRows({ sourceRows: [complete], chunkRows: [{ ...chunkRow(complete, corpus[0]), source_id: 'src_orphan' }], corpus }), /ORPHAN_CHUNK/);
});

test('resume metadata must match the run configuration and remain before semantic setup', () => {
  const plan = {
    sourceDatabase: 'fixed-source.sqlite', frozenSourceCount: 2, frozenChunkCount: 2,
    fixtureSourceCount: 500, fixtureChunkCount: 500, expectedVectorCount: 1000,
    modelId: 'model', modelRevision: 'revision', dimensions: 384,
  };
  const report = { ...plan, mode: 'run', result: 'running', runDirectory: 'C:/validation/index-load-one', indexedDocuments: 0 };
  assert.doesNotThrow(() => assertResumeMetadata(report, plan, 'C:/validation/index-load-one'));
  assert.throws(() => assertResumeMetadata({ ...report, dimensions: 768 }, plan, report.runDirectory), /METADATA_MISMATCH/);
  assert.throws(() => assertResumeMetadata({ ...report, indexedDocuments: 1 }, plan, report.runDirectory), /METADATA_MISMATCH/);
});

test('resume directory is limited to a real direct child of the validation root', async (t) => {
  const tempRoot = path.resolve('.sciencescope-local/temp/t10-validation');
  await mkdir(tempRoot, { recursive: true });
  const ownedRoot = await mkdtemp(path.join(tempRoot, 'resume-helper-test-'));
  t.after(() => rm(ownedRoot, { recursive: true, force: true }));
  const validationRoot = path.join(ownedRoot, 'validation');
  const runDir = path.join(validationRoot, 'index-load-fixture');
  await mkdir(path.join(runDir, 'state'), { recursive: true });
  await writeFile(path.join(runDir, 'state', 'sciencescope.sqlite'), 'test');
  assert.equal((await validateResumeDirectory(runDir, validationRoot)).runDir, runDir);
  await assert.rejects(validateResumeDirectory(path.join(ownedRoot, 'index-load-outside'), validationRoot), /OUTSIDE_VALIDATION_ROOT/);
  const target = path.join(ownedRoot, 'outside-target');
  await mkdir(target);
  const junction = path.join(validationRoot, 'index-load-escape');
  await symlink(target, junction, 'junction');
  await assert.rejects(validateResumeDirectory(junction, validationRoot), /RUN_DIRECTORY_INVALID|OUTSIDE_VALIDATION_ROOT/);
});
