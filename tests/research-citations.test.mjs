import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { parseCitationLabel, extractCitationLabels } from '../scripts/research-base/citations.mjs';
import { openApplicationDatabaseSync } from '../scripts/application-database.mjs';
import { createResearchBase } from '../scripts/research-base/index.mjs';

test('citation syntax variants retain source identity and exact page windows', () => {
  for (const raw of ['[S3, p.4]', '[S3 p4]', '(S3 p.4)', '（S3，p．4）', '【S3 第4页】']) {
    const result = parseCitationLabel(raw);
    assert.equal(result.raw, raw);
    assert.equal(result.parseStatus, 'parsed');
    assert.equal(result.citations[0].label, 'S3');
    assert.equal(result.citations[0].page, 4);
    assert.equal(result.citations[0].fromPage, 4);
    assert.equal(result.citations[0].toPage, 4);
    assert.equal(result.citations[0].normalized, '[S3 p.4]');
  }
  for (const dash of ['-', '–', '—']) {
    const result = parseCitationLabel(`[S3 p.4${dash}5]`);
    assert.equal(result.parseStatus, 'parsed');
    assert.equal(result.citations[0].page, null);
    assert.equal(result.citations[0].fromPage, 4);
    assert.equal(result.citations[0].toPage, 5);
  }
});

test('compound groups preserve every member and unknown raw text', () => {
  for (const raw of ['[S3; S5]', '[S3, S5]', '（S3；S5）']) {
    const result = parseCitationLabel(raw);
    assert.equal(result.parseStatus, 'parsed');
    assert.deepEqual(result.citations.map(c => c.label), ['S3', 'S5']);
  }
  const mixed = parseCitationLabel('[S3 p.4–5; nonsense; @a1b2c3d4]');
  assert.equal(mixed.raw, '[S3 p.4–5; nonsense; @a1b2c3d4]');
  assert.equal(mixed.parseStatus, 'partial');
  assert.equal(mixed.citations.length, 2);
  assert.deepEqual(mixed.unrecognized, [{ raw: 'nonsense', reason: 'unsupported-format' }]);
  for (const raw of ['[3]', '[3, 5]', '[S³]', '[S3 pp.4, 5]', '[S3 p.5–4]', '[S3 p.0]', '[S0]', '[S3 p.4)', '[S3 p.9007199254740992]', '[S9007199254740992]']) {
    const result = parseCitationLabel(raw);
    assert.equal(result.raw, raw);
    assert.equal(result.parseStatus, 'unrecognized', raw);
    assert.equal(result.citations.length, 0, raw);
    assert.ok(result.unrecognized.length, raw);
  }
  assert.equal(parseCitationLabel(`[${Array(33).fill('S3').join(';')}]`).citations.length, 33);
  assert.equal(parseCitationLabel('S'.repeat(2049)).unrecognized[0].reason, 'unsupported-format');
});

test('prose extraction preserves whole groups and offsets without guessing bibliography numbers', () => {
  const text = 'Proof [S3; S5] and （S3 p.4–5）. Unknown [S3 pp.4] plus [1, 2] and (2026).';
  const results = extractCitationLabels(text);
  assert.deepEqual(results.map(r => r.raw), ['[S3; S5]', '（S3 p.4–5）', '[S3 pp.4]']);
  for (const result of results) assert.equal(text.slice(result.start, result.end), result.raw);
  assert.equal(results[2].parseStatus, 'unrecognized');
});

test('malformed explicit source labels remain auditable prose candidates', () => {
  const text='Bad [S3 p.4) and (S3 p.4] and [S³]. Valid [S3; S5] and （S3 p.4–5）.';
  const results=extractCitationLabels(text);
  assert.deepEqual(results.map(row=>row.raw),['[S3 p.4)','(S3 p.4]','[S³]','[S3; S5]','（S3 p.4–5）']);
  assert.deepEqual(results.map(row=>row.parseStatus),['unrecognized','unrecognized','unrecognized','parsed','parsed']);
  for(const row of results)assert.equal(text.slice(row.start,row.end),row.raw);
  assert.deepEqual(extractCitationLabels('[1, 2] (2026) [section] [paper](https://example.test) [S3\np.4]'),[]);
  assert.deepEqual(extractCitationLabels('(source [S3][S5])').map(row=>row.raw),['[S3]','[S5]'],'outer prose parentheses cannot swallow explicit inner source labels');
  const large=extractCitationLabels('[S3 '+ 'x'.repeat(2049)+']');
  assert.equal(large[0].unrecognized[0].reason,'unsupported-format');
});

test('cite API adds compound resolution, keeps legacy single citation and reports missing members', async () => {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'research-citations-'));
  const database = openApplicationDatabaseSync({ stateDir: root });
  try {
    const research = createResearchBase({ database, resolveResourcePath: async () => null });
    const source = research.store.addSource({ projectId: 'p1', kind: 'paper', title: 'One' });
    const second = research.store.addSource({ projectId: 'p1', kind: 'paper', title: 'Two' });
    research.store.replaceChunks(source.id, [{ page: 4, text: 'FOUR' }, { page: 5, text: 'FIVE' }], { parser: 'test', pages: 5 });
    const call = label => research.handleGet('/api/research/cite', new URL(`http://localhost/api/research/cite?projectId=p1&label=${encodeURIComponent(label)}`));
    const single = await call('[S1, p.4]');
    assert.equal(single.citation.source.id, source.id);
    assert.equal(single.citation.page, 4);
    assert.deepEqual(single.citations, [single.citation]);
    const range = await call('[S1 p.4–5]');
    assert.equal(range.citation.fromPage, 4);
    assert.equal(range.citation.toPage, 5);
    const compound = await call('[S1 p.4–5; S2]');
    assert.equal(compound.citation, null);
    assert.equal(compound.parseStatus, 'parsed');
    assert.deepEqual(compound.citations.map(c => c.source.id), [source.id, second.id]);
    assert.equal(research.retrieval.resolveCitation('[S1; S2]', { projectId: 'p1' }), null);
    const partial = await call('[S1; S999; S2 pp.5]');
    assert.equal(partial.citation, null);
    assert.equal(partial.parseStatus, 'partial');
    assert.equal(partial.raw, '[S1; S999; S2 pp.5]');
    assert.deepEqual(partial.unrecognized, [{ raw: 'S2 pp.5', reason: 'unsupported-format' }, { raw: 'S999', reason: 'not-found' }]);
    for (const cite of ['[S1; S2]', '[S1; S999]']) {
      await assert.rejects(research.toolCall('research_read', { cite }, { projectId: 'p1' }), error => ['AMBIGUOUS_CITATION', 'INVALID_CITATION'].includes(error.code));
      await assert.rejects(research.toolCall('research_propose', { op: 'create', item: { type: 'claim', subtype: 'hypothesis', title: 'No flattening', body: 'Text' }, evidence: [{ cite, relation: 'supports' }] }, { projectId: 'p1' }), error => ['AMBIGUOUS_CITATION', 'INVALID_CITATION'].includes(error.code));
    }
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
