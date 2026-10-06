import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { withCore } from '../../testing.js';
import { createResearch } from './index.js';
import { createAppServer } from '../../server/server.js';
import { createResearchFixtures } from './testing.js';

test('source metadata, filters, reparse and original opening are wired through the API', () =>
  withCore('research-management', async (core, dir) => {
    const fixtures = await createResearchFixtures(dir);
    const project = await core.projects.create({ name: '材料管理' });
    const opened = [];
    const research = createResearch(core, {
      open: async (file) => {
        opened.push(file);
      },
    });
    const server = createAppServer({ core, token: 'test', research });
    const url = await server.listen();
    const call = async (method, route, body) => {
      const response = await fetch(url + route, {
        method,
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(response.status, 200, route);
      return response.json();
    };
    try {
      const source = await research.importSource({
        name: fixtures.pdf.name,
        bytes: fixtures.pdf.bytes,
        projectId: project.id,
      });
      const modified = await call('PATCH', `/api/research/sources/${source.id}`, {
        title: '城市恢复的新证据',
        kind: 'paper',
        metadata: {
          authors: [{ literal: '王研究员' }],
          year: 2026,
          venue: '城市研究',
          tags: ['恢复'],
          readStatus: 'reading',
        },
      });
      assert.equal(modified.metadata.year, 2026);
      assert.equal(
        (
          await call(
            'GET',
            `/api/research/search?q=${encodeURIComponent('城市恢复的新证据')}&projectId=${project.id}`,
          )
        ).hits[0].title,
        modified.title,
      );
      await research.importSource({
        name: '其他.txt',
        bytes: Buffer.from('其他研究内容。'),
        projectId: project.id,
      });
      const query = `projectId=${project.id}&kind=paper&readStatus=reading&tag=${encodeURIComponent('恢复')}&page=1&pageSize=1&sort=year&direction=asc`;
      const page = await call('GET', `/api/research/sources?${query}`);
      assert.equal(page.total, 1);
      assert.equal(page.sources[0].id, source.id);
      const noMatch = await call(
        'GET',
        `/api/research/sources?projectId=${project.id}&tag=missing&page=1`,
      );
      assert.equal(noMatch.total, 0);
      const reparsed = await call('POST', `/api/research/sources/${source.id}/reparse`, {});
      assert.equal(reparsed.id, source.id);
      assert.equal(reparsed.title, modified.title);
      assert.equal(reparsed.metadata.readStatus, 'reading');
      assert.equal(reparsed.metadata.authors[0].literal, '王研究员');
      assert.deepEqual(
        await readFile(path.join(core.paths.library, source.originalPath)),
        Buffer.from(fixtures.pdf.bytes),
      );
      await call('POST', `/api/research/sources/${source.id}/open`, {});
      assert.deepEqual(opened, [path.join(core.paths.library, source.originalPath)]);
      const item = await call('POST', '/api/research/items', {
        type: 'model',
        title: '恢复方程',
        body: '恢复率',
        payload: { latex: 'x=1', pinned: true },
      });
      assert.equal((await call('GET', '/api/research/items?type=model&pinned=1'))[0].id, item.id);
      await call('PATCH', `/api/research/items/${item.id}`, { status: 'archived' });
      assert.equal(
        (await call('GET', '/api/research/items?type=model&status=archived'))[0].id,
        item.id,
      );
      assert.ok(
        core.events
          .since(0)
          .some(
            (event) =>
              event.type === 'research.changed' && event.payload.action === 'source.updated',
          ),
      );
    } finally {
      await server.close();
    }
  }));
