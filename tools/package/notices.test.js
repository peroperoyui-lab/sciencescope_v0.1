import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { generateNotices } from './notices.js';

test('installer notices include nested production packages and native library notices', async () => {
  const root = path.resolve('.sciencescope-local/temp/package-notices');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'case-'));
  try {
    const modules = path.join(directory, 'node_modules');
    for (const [folder, name] of [
      ['@img/sharp-win32-x64', '@img/sharp-win32-x64'],
      ['parent', 'parent'],
      ['parent/node_modules/child', 'child'],
    ]) {
      const target = path.join(modules, folder);
      await mkdir(target, { recursive: true });
      await writeFile(
        path.join(target, 'package.json'),
        JSON.stringify({ name, version: '1.2.3', license: 'MIT' }),
      );
      await writeFile(path.join(target, 'LICENSE'), 'Original license text');
    }
    await writeFile(path.join(modules, '@img/sharp-win32-x64/README.md'), 'libvips: LGPLv3');
    const output = path.join(directory, 'THIRD_PARTY_NOTICES');
    assert.equal(await generateNotices(modules, output), 3);
    const text = await readFile(output, 'utf8');
    assert.match(text, /child 1\.2\.3/);
    assert.match(text, /Original license text/);
    assert.match(text, /libvips: LGPLv3/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
