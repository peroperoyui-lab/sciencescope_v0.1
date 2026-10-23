import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tempDir } from '../../testing.js';
import { snapshotProjectFile } from './project-copies.js';

test('concurrent project snapshots share one immutable copy and leave no temporary files', async () => {
  const { dir, cleanup } = await tempDir('project-snapshot');
  try {
    const folder = path.join(dir, 'project');
    const library = path.join(dir, 'library');
    await mkdir(folder);
    const bytes = Buffer.from('Shared research evidence.\n');
    const first = path.join(folder, 'first.md');
    const second = path.join(folder, 'second.txt');
    await writeFile(first, bytes);
    await writeFile(second, bytes);
    const results = await Promise.all([
      snapshotProjectFile(library, 'project', first),
      snapshotProjectFile(library, 'project', second),
    ]);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual(
      results.map((result) => result.contentHash),
      [hash, hash],
    );
    assert.deepEqual(results.map((result) => result.reused).sort(), [false, true]);
    assert.equal(results[0].originalPath, results[1].originalPath);
    assert.equal(results[0].fileSize, bytes.length);
    assert.equal(results[0].fileMtimeMs, (await stat(first)).mtimeMs);
    assert.deepEqual(await readFile(path.join(library, results[0].originalPath)), bytes);
    assert.deepEqual(await readdir(path.join(library, 'project-files', 'project')), [hash]);
    const again = await snapshotProjectFile(library, 'project', first, results[0]);
    assert.equal(again.reused, true);
    assert.deepEqual(await readFile(first), bytes);
  } finally {
    await cleanup();
  }
});

test('a changed listing stamp rejects the snapshot and preserves the original and saved copy', async () => {
  const { dir, cleanup } = await tempDir('project-snapshot-changed');
  try {
    const library = path.join(dir, 'library');
    const file = path.join(dir, 'evidence.md');
    await writeFile(file, 'Earlier evidence.');
    const saved = await snapshotProjectFile(library, 'project', file);
    const updated = 'Updated evidence with a different size.';
    await writeFile(file, updated);
    await assert.rejects(snapshotProjectFile(library, 'project', file, saved), {
      code: 'INDEX_FILE_CHANGED',
    });
    assert.equal(await readFile(file, 'utf8'), updated);
    assert.equal(
      await readFile(path.join(library, saved.originalPath), 'utf8'),
      'Earlier evidence.',
    );
    assert.deepEqual(await readdir(path.join(library, 'project-files', 'project')), [
      saved.contentHash,
    ]);
  } finally {
    await cleanup();
  }
});
