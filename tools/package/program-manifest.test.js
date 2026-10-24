import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { writeProgramManifest } from './program-manifest.js';

test('the installation manifest lists program resources and excludes user data and build inputs', async () => {
  const parent = path.resolve('.sciencescope-local/temp/r6c/manifest');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'case-'));
  try {
    for (const file of [
      'app/main.js',
      'node_modules/native/addon.node',
      'data/private.txt',
      'package-lock.json',
    ]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), 'fixture');
    }
    const file = await writeProgramManifest(root, { mainBinary: 'fixture.exe' });
    assert.deepEqual((await readFile(file, 'utf8')).split('\r\n').filter(Boolean), [
      'LICENSE',
      'THIRD_PARTY_NOTICES',
      'app/main.js',
      'fixture.exe',
      'node_modules/native/addon.node',
      'package.json',
      'program-files.txt',
    ]);
  } finally {
    assert.equal(path.dirname(root), parent);
    await rm(root, { recursive: true, force: true });
  }
});
