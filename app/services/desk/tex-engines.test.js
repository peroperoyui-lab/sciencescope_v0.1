import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../testing.js';
import { createTexEngines } from './tex-engines.js';
import { fakeTex } from './tex-fixture.js';

test('TeX discovery probes temporary PATH, caches results and refreshes without a local installation', async () => {
  const fixture = await tempDir('tex-detect');
  try {
    const fake = await fakeTex(path.join(fixture.dir, '中文 程序'), ['xelatex', 'bibtex']);
    const detector = createTexEngines({ env: fake.env, miktexDirs: [], texliveRoots: [] });
    const first = await detector.get();
    assert.equal(first.engines.length, 1);
    assert.equal(first.engines[0].path, fake.files.xelatex);
    assert.equal(first.engines[0].distribution, 'miktex');
    assert.equal(first.engines[0].version, 'xelatex (MiKTeX 25.12)');
    assert.equal(first.bibtex, fake.files.bibtex);
    assert.equal(first.latexmk, null);
    await fake.set({ version: '(TeX Live 2026)\nextra line' });
    assert.equal(await detector.get(), first);
    assert.equal((await detector.get(true)).engines[0].distribution, 'texlive');
    assert.equal((await detector.get()).engines[0].version, 'xelatex (TeX Live 2026)');
  } finally {
    await fixture.cleanup();
  }
});

test('TeX discovery includes MiKTeX standard directories and only latest TeX Live year', async () => {
  const fixture = await tempDir('tex-install-dirs');
  try {
    const miktex = await fakeTex(path.join(fixture.dir, 'Programs/MiKTeX/miktex/bin/x64'), [
      'xelatex',
    ]);
    const root = path.join(fixture.dir, 'texlive');
    const platform = process.platform === 'win32' ? 'windows' : 'x86_64-linux';
    await fakeTex(path.join(root, '2024/bin', platform), ['lualatex'], {
      version: 'TeX Live 2024',
    });
    const latest = await fakeTex(path.join(root, '2026/bin', platform), ['lualatex'], {
      version: 'TeX Live 2026',
    });
    const detector = createTexEngines({
      env: { PATH: '', LOCALAPPDATA: fixture.dir },
      miktexDirs: process.platform === 'win32' ? undefined : [miktex.folder],
      texliveRoots: [root],
    });
    const result = await detector.get();
    assert.equal(result.engines[0].path, miktex.files.xelatex);
    assert.equal(result.engines[1].path, latest.files.lualatex);
    const timed = createTexEngines({
      env: { PATH: latest.folder },
      miktexDirs: [],
      texliveRoots: [],
      probeTimeoutMs: 25,
      run: async (_file, _args, options) => {
        assert.equal(options.timeoutMs, 25);
        return { code: null, output: '', aborted: true };
      },
    });
    assert.deepEqual((await timed.get()).engines, []);
  } finally {
    await fixture.cleanup();
  }
});
