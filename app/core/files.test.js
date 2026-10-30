import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { writeBytesAtomic } from './files.js';
import { writeTextAtomic } from './workspace/files.js';
import { writeAtomic } from '../services/desk/storage.js';
import { dataPaths } from './paths.js';
import { saveKeys, readCredentials } from '../services/providers.js';

test('workspace text, desk bytes and concurrent credential merges retain complete files', async () => {
  const base = path.resolve('.sciencescope-local/temp/p4c/part6');
  await mkdir(base, { recursive: true });
  const folder = await mkdtemp(path.join(base, 'atomic-paths-'));
  try {
    const textFile = path.join(folder, 'workspace', 'plans.md');
    await writeTextAtomic(textFile, '原计划\n');
    await writeTextAtomic(textFile, '中文新计划🧪\n完整末尾');
    assert.equal(await readFile(textFile, 'utf8'), '中文新计划🧪\n完整末尾');
    const bytesFile = path.join(folder, 'desk', 'document.bin');
    const bytes = Uint8Array.from([0, 255, 1, 128, 42]);
    await writeAtomic(bytesFile, Buffer.from('old'));
    await writeAtomic(bytesFile, bytes);
    assert.deepEqual(await readFile(bytesFile), Buffer.from(bytes));
    const restricted = path.join(folder, 'direct.bin');
    await writeBytesAtomic(restricted, bytes, { mode: 0o600 });
    assert.deepEqual(await readFile(restricted), Buffer.from(bytes));
    if (process.platform !== 'win32') assert.equal((await stat(restricted)).mode & 0o777, 0o600);

    const paths = dataPaths(folder);
    await saveKeys(paths, { retained: 'public-fixture', obsolete: 'public-old' });
    await Promise.all([
      saveKeys(paths, { provider: 'public-provider' }),
      saveKeys(paths, { mcp: 'public-mcp' }),
      saveKeys(paths, {}, ['obsolete']),
    ]);
    assert.deepEqual((await readCredentials(paths)).refs, {
      retained: 'public-fixture',
      provider: 'public-provider',
      mcp: 'public-mcp',
    });
    assert.deepEqual(await readdir(path.dirname(textFile)), ['plans.md']);
    assert.deepEqual(await readdir(path.dirname(bytesFile)), ['document.bin']);
    assert.deepEqual(await readdir(paths.secret), ['credentials.yaml']);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
