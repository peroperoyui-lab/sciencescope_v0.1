import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { pruneProductionModules } from './prune.js';
import { generateNotices } from './notices.js';
import { buildOptions } from './build-options.js';

test('production pruning preserves live assets and licenses, with complete pre-prune notices', async () => {
  const root = path.resolve('.sciencescope-local/temp/package-prune');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'case-'));
  const modules = path.join(directory, 'node_modules');
  const keep = [
    'ordinary/LICENSE.md',
    'ordinary/NOTICE.txt',
    'ordinary/COPYING',
    'ordinary/tests/live.js',
    'ordinary/lib/index.js',
    'ordinary/font.woff2',
    'npm/lib/commands/test.js',
    'npm/node_modules/example/test/LICENSE',
  ];
  const remove = [
    'ordinary/index.d.ts',
    'ordinary/index.d.mts',
    'ordinary/index.d.cts',
    'ordinary/index.js.map',
    'ordinary/source.ts',
    'ordinary/source.mts',
    'ordinary/source.cts',
    'ordinary/README.md',
    'ordinary/docs/manual.md',
    'onnxruntime-web/index.js',
    'onnxruntime-web/LICENSE',
    'npm/node_modules/example/test/unused.js',
    'npm/node_modules/example/examples/demo.js',
  ];
  try {
    for (const file of [...keep, ...remove]) {
      await mkdir(path.dirname(path.join(modules, file)), { recursive: true });
      await writeFile(path.join(modules, file), 'original');
    }
    for (const name of ['ordinary', 'onnxruntime-web'])
      await writeFile(
        path.join(modules, name, 'package.json'),
        JSON.stringify({ name, version: '1', license: 'MIT' }),
      );
    const notices = path.join(directory, 'THIRD_PARTY_NOTICES');
    await generateNotices(modules, notices);
    const first = await pruneProductionModules(modules);
    for (const file of keep)
      assert.equal(await readFile(path.join(modules, file), 'utf8'), 'original');
    for (const file of remove)
      assert.equal(
        await access(path.join(modules, file)).then(
          () => true,
          () => false,
        ),
        false,
      );
    assert.match(await readFile(notices, 'utf8'), /onnxruntime-web 1[\s\S]*original/);
    assert.equal(first.files, remove.length + 1); // removed onnxruntime-web/package.json
    assert.equal((await pruneProductionModules(modules)).files, 0);
    assert.deepEqual(buildOptions({}), { prune: true });
    assert.deepEqual(
      buildOptions({ SCIENCESCOPE_BUILD_VARIANT: 'installtest', SCIENCESCOPE_BUILD_PRUNE: '0' }),
      {
        productName: 'ScienceScope Install Test',
        identifier: 'org.sciencescope.installtest',
        prune: false,
      },
    );
    assert.throws(() => buildOptions({ SCIENCESCOPE_BUILD_PRUNE: '0' }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
