import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { openApplicationDatabaseSync } from '../scripts/application-database.mjs';
import { createResearchBase } from '../scripts/research-base/index.mjs';
import { createScopedResearchTools } from '../scripts/context/research-tools.mjs';

async function fixture() {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'research-read-citation-'));
  const database = openApplicationDatabaseSync({ stateDir: root });
  const research = createResearchBase({ database, resolveResourcePath: async () => null });
  const source = research.store.addSource({ projectId: 'p1', kind: 'paper', title: 'Page selection' });
  research.store.replaceChunks(source.id, [
    { page: 1, text: 'PREVIOUS_PAGE_SENTINEL ' + 'x'.repeat(5900) },
    { page: 2, text: 'TARGET_PAGE_SENTINEL: libraries provide cross-department guidance.' },
    { page: 2, text: 'TARGET_PAGE_SECOND_PASSAGE' },
    { page: 3, text: 'OVERRIDE_PAGE_SENTINEL' },
  ], { parser: 'test', pages: 3 });
  const scoped = createScopedResearchTools({ research, projectIds: async () => ['p1', 'p2'] });
  return { research, scoped, source, close: async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  } };
}

for (const role of ['main', 'expert', 'secretary', 'global']) {
  test(`${role} reads the citation's exact page in both direct and scoped tools`, async () => {
    const f = await fixture();
    try {
      const ctx = { role, projectId: 'p1', expertId: 'e1' };
      for (const cite of ['[S1 p.2]', '[S1, p.2]', '[S1 p2]']) {
        for (const call of [f.research.toolCall, f.scoped]) {
          const result = await call('research_read', { cite }, ctx);
          assert.match(result.text, /TARGET_PAGE_SENTINEL/);
          assert.match(result.text, /TARGET_PAGE_SECOND_PASSAGE/);
          assert.doesNotMatch(result.text, /PREVIOUS_PAGE_SENTINEL|OVERRIDE_PAGE_SENTINEL/);
          assert.deepEqual(result.ref, { type: 'source', id: f.source.id });
          assert.equal(result.nextOrdinal, 3);
        }
      }
    } finally { await f.close(); }
  });
}

test('explicit page overrides citation page; missing citation page does not read unrelated pages', async () => {
  const f = await fixture();
  try {
    for (const call of [f.research.toolCall, f.scoped]) {
      const ctx = { role: 'main', projectId: 'p1' };
      const overridden = await call('research_read', { cite: '[S1 p.2]', page: 3 }, ctx);
      assert.match(overridden.text, /OVERRIDE_PAGE_SENTINEL/);
      assert.doesNotMatch(overridden.text, /TARGET_PAGE|PREVIOUS_PAGE/);
      const absent = await call('research_read', { cite: '[S1 p.9]' }, ctx);
      assert.equal(absent.text, '');
      assert.equal(absent.nextOrdinal, null);
    }
  } finally { await f.close(); }
});

test('exact chunk ref includes the selected passage despite a large predecessor, and takes precedence over cite', async () => {
  const f = await fixture();
  try {
    const ref = f.research.retrieval.resolveCitation('[S1 p.2]', { projectId: 'p1' }).ref;
    const expected = f.research.retrieval.read({ ref });
    assert.match(expected.text, /TARGET_PAGE_SENTINEL/);
    assert.doesNotMatch(expected.text, /PREVIOUS_PAGE_SENTINEL/);
    for (const role of ['main', 'expert', 'secretary', 'global']) {
      for (const call of [f.research.toolCall, f.scoped]) {
        const result = await call('research_read', { ref, cite: '[S1 p.3]' }, { role, projectId: 'p1', expertId: 'e1' });
        assert.deepEqual(result, expected);
      }
    }
  } finally { await f.close(); }
});

test('chunk reads retain chronological neighbors when all fit', async () => {
  const f = await fixture();
  try {
    f.research.store.replaceChunks(f.source.id, [
      { page: 1, section: 'Earlier', text: 'PREVIOUS_SENTINEL' },
      { page: 2, section: 'Selected', text: 'SELECTED_SENTINEL' },
      { page: 3, section: 'Later', text: 'NEXT_SENTINEL' },
    ], { parser: 'test', pages: 3 });
    const ref = { type: 'chunk', id: `${f.source.id}-c1` };
    const result = f.research.retrieval.read({ ref, maxChars: 500 });
    assert.match(result.text, /\[p\.1\][\s\S]*PREVIOUS_SENTINEL[\s\S]*\[p\.2\][\s\S]*SELECTED_SENTINEL[\s\S]*\[p\.3\][\s\S]*NEXT_SENTINEL/);
    assert.equal(result.nextOrdinal, 3);
    assert.ok(result.text.length <= 500);
  } finally { await f.close(); }
});

test('a selected chunk larger than maxChars is returned whole without unrelated neighbors', async () => {
  const f = await fixture();
  try {
    const selected = 'SELECTED_START ' + 'y'.repeat(700) + ' SELECTED_END';
    f.research.store.replaceChunks(f.source.id, [
      { page: 1, text: 'PREVIOUS_SENTINEL' },
      { page: 2, section: 'Selected', text: selected },
      { page: 2, text: 'NEXT_SENTINEL' },
    ], { parser: 'test', pages: 2 });
    const ref = { type: 'chunk', id: `${f.source.id}-c1` };
    for (const call of [f.research.toolCall, f.scoped]) {
      const result = await call('research_read', { ref, maxChars: 500 }, { role: 'main', projectId: 'p1' });
      assert.ok(result.text.includes(selected), 'selected paragraph must not be truncated');
      assert.doesNotMatch(result.text, /PREVIOUS_SENTINEL|NEXT_SENTINEL/);
      assert.match(result.text, /\[p\.2\]\n## Selected/);
      assert.equal(result.nextOrdinal, 2);
    }
  } finally { await f.close(); }
});

test('scoped page reads retain global label ambiguity and cross-project isolation', async () => {
  const f = await fixture();
  try {
    const p2 = f.research.store.addSource({ projectId: 'p2', kind: 'paper', title: 'Another S1' });
    f.research.store.replaceChunks(p2.id, [{ page: 2, text: 'OTHER_PROJECT_SENTINEL' }], { parser: 'test', pages: 2 });
    await assert.rejects(f.scoped('research_read', { cite: '[S1 p.2]' }, { role: 'global' }), error => error.code === 'AMBIGUOUS_CITATION');
    for (const role of ['main', 'expert', 'secretary']) {
      const ctx = { role, projectId: 'p1', expertId: 'e1' };
      const result = await f.scoped('research_read', { cite: '[S1 p.2]' }, ctx);
      assert.match(result.text, /TARGET_PAGE_SENTINEL/);
      assert.doesNotMatch(result.text, /OTHER_PROJECT_SENTINEL/);
      await assert.rejects(f.scoped('research_read', { ref: { type: 'source', id: p2.id }, page: 2 }, ctx), error => error.code === 'REFERENCE_OUT_OF_SCOPE');
    }
    const globalRead = await f.scoped('research_read', { ref: { type: 'source', id: p2.id }, page: 2 }, { role: 'global' });
    assert.match(globalRead.text, /OTHER_PROJECT_SENTINEL/);
  } finally { await f.close(); }
});

test('citation resolution keeps private items and other experts isolated', async () => {
  const f = await fixture();
  try {
    const hidden = f.research.store.createItem({ type: 'memory', subtype: 'preference', projectId: 'p1', scope: 'project', visibility: 'private', title: 'Private', body: 'PRIVATE_SENTINEL' });
    const expert = f.research.store.createItem({ type: 'memory', subtype: 'lesson', projectId: 'p1', scope: 'expert:e2', title: 'Expert private scope', body: 'EXPERT_SENTINEL' });
    for (const item of [hidden, expert]) {
      const cite = `[@${item.id.slice(4, 12)}]`;
      for (const role of ['main', 'expert', 'secretary', 'global']) {
        await assert.rejects(f.scoped('research_read', { cite }, { role, projectId: 'p1', expertId: 'e1' }), error => error.code === 'REFERENCE_NOT_FOUND');
      }
    }
  } finally { await f.close(); }
});

test('citation ranges read only requested pages and reject multiple sources for every role', async () => {
  const f = await fixture();
  try {
    for (const role of ['main', 'expert', 'secretary', 'global']) {
      const ctx = { role, projectId: 'p1', expertId: 'e1' };
      for (const call of [f.research.toolCall, f.scoped]) {
        const result = await call('research_read', { cite: '[S1 p.2–3]' }, ctx);
        assert.match(result.text, /TARGET_PAGE_SENTINEL/);
        assert.match(result.text, /OVERRIDE_PAGE_SENTINEL/);
        assert.doesNotMatch(result.text, /PREVIOUS_PAGE_SENTINEL/);
        assert.equal(result.fromPage, 2);
        assert.equal(result.toPage, 3);
        assert.equal(result.cite, '[S1 p.2–3]');
        assert.deepEqual(result.readPages, [2, 3]);
        assert.equal(result.truncated, false);
        const override = await call('research_read', { cite: '[S1 p.2–3]', page: 3 }, ctx);
        assert.match(override.text, /OVERRIDE_PAGE_SENTINEL/);
        assert.doesNotMatch(override.text, /TARGET_PAGE/);
        await assert.rejects(call('research_read', { cite: '[S1; S2]' }, ctx), error => ['AMBIGUOUS_CITATION', 'INVALID_CITATION'].includes(error.code));
      }
    }
  } finally { await f.close(); }
});

test('large page ranges stay bounded and expose continuation within the requested range', async () => {
  const f = await fixture();
  try {
    f.research.store.replaceChunks(f.source.id, Array.from({ length: 450 }, (_, i) => ({ page: i + 2, text: `PAGE_${i + 2} ` + 'x'.repeat(100) })), { parser: 'test', pages: 451 });
    for (const call of [f.research.toolCall, f.scoped]) {
      const ctx = { role: 'main', projectId: 'p1' };
      const first = await call('research_read', { cite: '[S1 p.2–1000000000]', maxChars: 500 }, ctx);
      assert.equal(first.truncated, true);
      assert.equal(first.fromPage, 2);
      assert.equal(first.toPage, 1000000000);
      assert.ok(first.text.length <= 500);
      const next = await call('research_read', { cite: '[S1 p.2–1000000000]', fromOrdinal: first.nextOrdinal, maxChars: 500 }, ctx);
      assert.ok(next.readPages[0] > first.readPages.at(-1));
      assert.doesNotMatch(next.text, /PAGE_2\s/u);
      const bounded = await call('research_read', { cite: '[S1 p.2–451]', maxChars: 20000 }, ctx);
      assert.equal(bounded.truncated, true);
      assert.ok(bounded.text.length <= 20000);
      for (const args of [
        { ref: { type: 'chunk', id: `${f.source.id}-c0` }, page: 2, toPage: 3 },
        { ref: { type: 'source', id: f.source.id }, page: 3, toPage: 2 },
        { ref: { type: 'source', id: f.source.id }, toPage: 3 },
      ]) await assert.rejects(call('research_read', args, ctx), error => error.code === 'INVALID_CITATION');
    }
  } finally { await f.close(); }
});
