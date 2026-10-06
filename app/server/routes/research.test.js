import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { withCore } from '../../testing.js';
import { createAppServer } from '../server.js';
import { createResearchFixtures } from '../../services/research/testing.js';

test('import PDF and DOCX through the API, retrieve paged citations and preserve originals', () =>
  withCore('research-api', async (core, dir) => {
    const fixtures = await createResearchFixtures(dir);
    const project = await core.projects.create({ name: '中文资料库' });
    const server = createAppServer({ core, token: 'research-test' });
    const url = await server.listen();
    const events = [];
    const unsubscribe = core.events.subscribe((event) => {
      if (event.type === 'research.changed') events.push(event);
    });
    const call = async (method, route, body) => {
      const response = await fetch(url + route, {
        method,
        headers: { authorization: 'Bearer research-test', 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(response.status, 200, route);
      return response.json();
    };
    try {
      for (const fixture of [fixtures.pdf, fixtures.docx]) {
        const source = await call('POST', '/api/research/sources', {
          name: fixture.name,
          projectId: project.id,
          base64: Buffer.from(fixture.bytes).toString('base64'),
        });
        assert.ok(['parsed', 'partial'].includes(source.contentStatus), source.parseError);
        assert.deepEqual(
          await readFile(path.join(core.paths.library, source.originalPath)),
          Buffer.from(fixture.bytes),
        );
        const page = await call('GET', `/api/research/sources/${source.id}?limit=1`);
        assert.equal(page.chunks.length, 1);
        assert.ok(page.total >= 1);
        assert.equal(page.remaining, page.total - 1);
        assert.ok(page.chunks[0].text.length);
        assert.match(page.chunks[0].citation, /^\[S\d+ p\.\d+\]$/);
        const rest = await call('GET', `/api/research/sources/${source.id}?offset=1&limit=1`);
        assert.equal(rest.chunks.length, 1);
        assert.equal(rest.remaining, Math.max(0, page.total - 2));
        const all = await call('GET', `/api/research/sources/${source.id}?limit=${page.total}`);
        assert.ok(all.chunks.some((chunk) => chunk.page === 2 && chunk.citation.endsWith('p.2]')));
        const query = page.chunks[0].text.split(/\s+/u).filter(Boolean).slice(-3).join(' ');
        const found = await call(
          'GET',
          `/api/research/search?q=${encodeURIComponent(query)}&projectId=${project.id}`,
        );
        assert.ok(
          found.hits.some((hit) => hit.sourceId === source.id),
          query,
        );
      }
      const sources = await call('GET', `/api/research/sources?projectId=${project.id}`);
      assert.equal(sources.length, 2);
      assert.equal(events.length, 2);
      const item = await call('POST', '/api/research/items', {
        projectId: project.id,
        type: 'knowledge',
        title: '清洗规则',
        body: '保留异常值标记',
      });
      const changed = await call('PATCH', '/api/research/items', {
        id: item.id,
        body: '核查异常值来源',
        expectedRevision: item.revision,
      });
      assert.equal(changed.revision, 2);
      const historical = await call('GET', `/api/research/items/${item.id}`);
      assert.ok(historical.revisions.some((r) => (r.snapshot ?? r).body === '保留异常值标记'));
      const replacement = await call('POST', '/api/research/items', {
        supersedes: item.id,
        title: '新清洗规则',
        body: '人工复核并留痕',
      });
      assert.equal(replacement.superseded.status, 'superseded');
      assert.equal(
        (await call('GET', `/api/research/items/${item.id}`)).item.supersededBy,
        replacement.item.id,
      );
      const active = await call(
        'GET',
        `/api/research/search?q=${encodeURIComponent('核查异常值来源')}&projectId=${project.id}`,
      );
      assert.ok(!active.hits.some((hit) => hit.id === item.id));
      const history = await call(
        'GET',
        `/api/research/search?q=${encodeURIComponent('核查异常值来源')}&projectId=${project.id}&includeSuperseded=1`,
      );
      assert.ok(history.hits.some((hit) => hit.id === item.id));
      assert.equal(events.length, 5);
    } finally {
      unsubscribe();
      await server.close();
    }
  }));
