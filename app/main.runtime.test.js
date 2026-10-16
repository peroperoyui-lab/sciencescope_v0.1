// The native shell requests cooperative shutdown before its Job fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { tempDir } from './testing.js';

test('the native host publishes its UI and closes SQLite through its shutdown endpoint', async () => {
  const { dir, cleanup } = await tempDir('原生关闭');
  const child = spawn(process.execPath, ['app/main.js', '--data', dir], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  try {
    let output = '';
    const launch = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdout.on('data', (bytes) => {
        output += bytes.toString('utf8');
        if (output.includes('\n')) resolve(JSON.parse(output.split('\n')[0]));
      });
      child.once('exit', () => reject(new Error('Host exited before startup')));
    });
    assert.equal(launch.dataRoot, dir);
    assert.equal(launch.ui, `${launch.url}/?token=${launch.token}`);
    assert.ok(existsSync(path.join(dir, 'sciencescope.sqlite-wal')));
    const pageRendered = Date.now();
    const rendered = await fetch(`${launch.url}/api/startup/rendered`, {
      method: 'POST',
      headers: { authorization: `Bearer ${launch.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pageRendered, renderStatus: 'rendered' }),
    });
    assert.equal(rendered.status, 200);
    const startup = JSON.parse((await readFile(path.join(dir, 'logs/startup.log'), 'utf8')).trim());
    assert.equal(startup.points.pageRendered, pageRendered);
    assert.ok(startup.points.httpListening >= startup.points.createAppEnd);
    assert.ok(startup.points.createCoreEnd >= startup.points.createCoreStart);
    assert.ok(startup.points.semanticEnd >= startup.points.semanticStart);
    assert.ok(startup.points.pythonEnd >= startup.points.pythonStart);
    const response = await fetch(`${launch.url}${launch.shutdownPath}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${launch.shutdownToken}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { closing: true });
    assert.deepEqual(await exited, [0, null]);
    assert.equal(existsSync(path.join(dir, 'sciencescope.sqlite-wal')), false);
    assert.equal(existsSync(path.join(dir, 'sciencescope.sqlite-shm')), false);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
    await cleanup();
  }
});
