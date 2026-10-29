import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { summarizeStartupProfile } from './startup-observe.mjs';

test('startup samples retain inclusive stack attribution without adding overlapping groups', () => {
  const frame = (functionName, url) => ({ functionName, url, lineNumber: 0 });
  const report = summarizeStartupProfile({
    nodes: [
      { id: 1, callFrame: frame('(root)', ''), children: [2, 5] },
      {
        id: 2,
        callFrame: frame('openDatabase', 'file:///C:/fixture/app/core/db/database.js'),
        children: [3],
      },
      {
        id: 3,
        callFrame: frame('up', 'file:///C:/fixture/app/core/db/migrations/001-initial.js'),
        children: [4],
      },
      { id: 4, callFrame: frame('exec', 'file:///C:/fixture/app/core/db/database.js') },
      { id: 5, callFrame: frame('(idle)', '') },
    ],
    samples: [4, 5],
    timeDeltas: [3000, 7000],
  });
  assert.equal(report.sampledMs, 10);
  assert.equal(report.idleMs, 7);
  assert.deepEqual(report.inclusiveSampledStackMs, {
    databaseOpen: 3,
    databaseMigrations: 3,
    projectIndex: 0,
  });
  assert.equal(report.topFunctions[0].script, '/app/core/db/database.js');
  assert.equal(report.topFunctions[0].selfSampledMs, 3);
});

test('preload writes actual Node milestones and stops sampling on the first rendered response', async () => {
  const root = path.resolve('.sciencescope-local/temp');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'startup-observer-'));
  const prefix = path.join(directory, 'startup');
  try {
    await promisify(execFile)(
      process.execPath,
      [
        '--import',
        pathToFileURL(path.resolve('tools/perf/startup-observe.mjs')).href,
        '--input-type=module',
        '--eval',
        `import { createServer } from 'node:http';
         const server = createServer((request, response) => response.end('ok'));
         await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
         await fetch('http://127.0.0.1:' + server.address().port + '/api/startup/rendered', {method:'POST'});
         server.closeAllConnections();
         await new Promise(resolve => server.close(resolve));`,
      ],
      {
        env: { ...process.env, SCIENCESCOPE_PERF_STARTUP: prefix, SCIENCESCOPE_PERF_HTTP: '' },
        windowsHide: true,
        timeout: 15000,
      },
    );
    const report = JSON.parse(await readFile(`${prefix}.json`, 'utf8'));
    const profile = JSON.parse(await readFile(`${prefix}.cpuprofile`, 'utf8'));
    assert.equal(report.reason, 'page-rendered-response');
    assert.ok(report.observedWallMs > 0);
    assert.ok(report.nodeTiming.bootstrapComplete >= report.nodeTiming.nodeStart);
    assert.ok(report.profileStartMs >= report.observedStartMs);
    assert.ok(report.processCpuMs.user >= 0);
    assert.ok(profile.nodes.length > 0);
    assert.ok(report.samples > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
