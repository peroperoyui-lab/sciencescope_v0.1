import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from '../testing.js';
import { createStartupLog } from './startup.js';

test('startup writes one retained record per launch with native and render timing', async () => {
  const { dir, cleanup } = await tempDir('startup-log');
  try {
    for (let index = 0; index < 2; index++) {
      const log = createStartupLog(dir, { nativeStart: 100, nodeSpawn: 101, nodeStart: 102 });
      log.mark('createCoreStart');
      log.mark('createCoreEnd');
      await log.finish({ pageRendered: 200, renderStatus: 'rendered' });
      await log.finish();
    }
    const rows = (await readFile(path.join(dir, 'logs/startup.log'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 2);
    assert.equal(rows[0].points.nativeStart, 100);
    assert.equal(rows[0].points.pageRendered, 200);
    assert.equal(rows[0].points.renderStatus, 'rendered');
    assert.ok(rows[0].points.createCoreEnd >= rows[0].points.createCoreStart);
  } finally {
    await cleanup();
  }
});
