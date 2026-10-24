import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { tempDir } from '../../testing.js';
import { createCore } from '../../core/index.js';
import { createAppServer } from '../server.js';

test(
  'full export routes validate destinations and expose a completed, readable job',
  { timeout: 30_000 },
  async () => {
    const { dir, cleanup } = await tempDir('full-export-api');
    const core = await createCore({ dataRoot: path.join(dir, 'data') });
    const server = createAppServer({ core, token: 'export-test-token' });
    const target = path.join(dir, 'exports');
    await mkdir(target);
    const url = await server.listen();
    const call = async (method, route, body) => {
      const response = await fetch(`${url}${route}`, {
        method,
        headers: { authorization: 'Bearer export-test-token', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    let unsubscribe = () => {};
    try {
      const invalid = await call('POST', '/api/export/all', { target: core.paths.root });
      assert.equal(invalid.status, 400);
      const finished = new Promise((resolve) => {
        unsubscribe = core.events.subscribe((event) => {
          if (event.type === 'export.finished') resolve(event.payload);
        });
      });
      const started = await call('POST', '/api/export/all', { target });
      assert.equal(started.status, 200);
      assert.equal(typeof started.body.jobId, 'string');
      assert.match(started.body.folder, /（未完成）/u);
      const event = /** @type {any} */ (await finished);
      assert.equal(event.jobId, started.body.jobId);
      assert.equal(event.cancelled, false);
      const status = await call('GET', `/api/export/all/${started.body.jobId}`);
      assert.equal(status.status, 200);
      assert.equal(status.body.phase, 'finished');
      assert.equal(status.body.folder, event.folder);
      assert.doesNotMatch(status.body.folder, /（未完成）/u);
      assert.match(
        await readFile(path.join(status.body.folder, 'README.md'), 'utf8'),
        /ScienceScope/u,
      );
      const cancelFinished = await call('DELETE', `/api/export/all/${started.body.jobId}`);
      assert.equal(cancelFinished.status, 200);
      assert.equal(cancelFinished.body.phase, 'finished');
      assert.equal((await call('GET', '/api/export/all/missing')).status, 404);
      assert.equal((await call('POST', '/api/export/all/missing/open', {})).status, 404);
    } finally {
      unsubscribe();
      await server.close();
      core.close();
      await cleanup();
    }
  },
);
