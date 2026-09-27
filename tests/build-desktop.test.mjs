import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { defaultRoot } from '../scripts/prepare-desktop.mjs';
import { buildDesktop, DESKTOP_ASSETS } from '../scripts/build-desktop.mjs';

test('desktop extension is generated without changing approved prototype', async () => {
  const tempRoot = path.join(defaultRoot, '.sciencescope-local', 'temp');
  await mkdir(tempRoot, {recursive:true});
  const outputDir = await mkdtemp(path.join(tempRoot, 'desktop-extension-'));
  const original = await readFile(path.join(defaultRoot, 'ScienceScope.html'));
  try {
    const entry = await buildDesktop({outputDir});
    const generated = await readFile(entry, 'utf8');
    assert.match(generated, /type="module" src="\.\/desktop\/model-settings\.mjs"/);
    assert.ok(generated.indexOf('href="./desktop/chat.css"') < generated.indexOf('</head>'));
    const copyPath=generated.match(/iconPaths\.copy \|\|= '([^']+)'/)?.[1];
    assert.ok(copyPath,'copy icon remains available');
    assert.match(copyPath,/^M/);
    assert.doesNotMatch(copyPath,/[<>]/,'ic() requires SVG path data, not nested markup');
    assert.deepEqual(await readFile(path.join(defaultRoot, 'ScienceScope.html')), original);
    for (const asset of DESKTOP_ASSETS) {
      assert.deepEqual(await readFile(path.join(outputDir, 'desktop', asset)), await readFile(path.join(defaultRoot, 'desktop', asset)));
      if(asset.endsWith('.mjs')) {
        const source=await readFile(path.join(defaultRoot,'desktop',asset),'utf8');
        for(const match of source.matchAll(/(?:from\s*|import\s*)['"]\.\/([^'"]+)['"]/g)) {
          assert.ok(match[1].startsWith('vendor/')||DESKTOP_ASSETS.includes(match[1]),`${asset} imports an asset absent from the desktop HTTP manifest: ${match[1]}`);
        }
      }
    }
  } finally { await rm(outputDir, {recursive:true, force:true}); }
});
