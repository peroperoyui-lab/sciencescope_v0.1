import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './ui/browser-testing.js';
import { createStartupLog } from './services/startup.js';
import { tempDir } from './testing.js';

test(
  'the existing interface reports its first painted render without changing components',
  { skip: browserSkip },
  async () => {
    const { dir, cleanup } = await tempDir('startup-render');
    const startup = createStartupLog(dir, { nodeStart: performance.timeOrigin });
    let reportFinished;
    const rendered = new Promise((resolve) => {
      reportFinished = resolve;
    });
    try {
      await withBrowserApp(
        'startup-page',
        async function* () {},
        async () => {
          await rendered;
          const log = JSON.parse(
            (await readFile(path.join(dir, 'logs/startup.log'), 'utf8')).trim(),
          );
          assert.equal(log.points.renderStatus, 'rendered');
          assert.ok(log.points.pageRendered > log.points.createCoreStart);
        },
        {
          startup: {
            mark: startup.mark,
            async finish(page) {
              await startup.finish(page);
              reportFinished(undefined);
            },
          },
        },
      );
    } finally {
      await cleanup();
    }
  },
);
