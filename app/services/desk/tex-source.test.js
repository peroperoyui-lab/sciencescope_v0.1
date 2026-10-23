import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from '../../testing.js';
import { selectTexRoot, selectTexEngine, texDiagnostics } from './tex-source.js';
import { settings } from '../../core/workspace/resources/settings.js';

test('TeX main selection uses explicit root, header directive, self and unique direct parent', async () => {
  const fixture = await tempDir('tex-source');
  try {
    await mkdir(path.join(fixture.dir, 'chapters'));
    const write = (file, text) => writeFile(path.join(fixture.dir, file), text);
    await write('main.tex', '\\documentclass{article}\n\\include{chapters/method}\n');
    await write('chapters/method.tex', '方法正文');
    const select = (root) => selectTexRoot(fixture.dir, 'chapters/method.tex', root);
    assert.equal((await select()).root, 'main.tex');
    assert.equal((await selectTexRoot(fixture.dir, 'main.tex')).root, 'main.tex');
    await write('second.tex', '\\documentclass{article}\n\\subfile{chapters/method.tex}');
    await assert.rejects(
      select,
      (/** @type {any} */ error) =>
        error.code === 'DESK_TEX_ROOT' &&
        error.details.candidates.join(',') === 'main.tex,second.tex',
    );
    await write('chapters/method.tex', '% !TEX root = ../second.tex\n方法正文');
    assert.equal((await select()).root, 'second.tex');
    assert.equal((await select('main.tex')).root, 'main.tex');
    await write('chapters/method.tex', '方法正文');
    await rm(path.join(fixture.dir, 'main.tex'));
    await rm(path.join(fixture.dir, 'second.tex'));
    await assert.rejects(
      select,
      (/** @type {any} */ error) =>
        error.code === 'DESK_TEX_ROOT' && error.details.candidates.length === 0,
    );
    await write('main.tex', '\\documentclass{article}\n\\input chapters/method\n');
    assert.equal((await select()).root, 'main.tex');
  } finally {
    await fixture.cleanup();
  }
});

test('TeX engine choice consumes settings, magic comments, packages and installed fallback', () => {
  const engines = ['xelatex', 'lualatex', 'pdflatex'].map((id) => ({ id }));
  const choose = (text, engine = 'auto', available = engines) =>
    selectTexEngine(available, { text, sourceText: text }, engine).id;
  assert.equal(choose('\\documentclass{ctexart}'), 'xelatex');
  assert.equal(choose('\\usepackage{luatexja}'), 'lualatex');
  assert.equal(choose('% !TEX program = lualatex\n\\usepackage{fontspec}'), 'lualatex');
  assert.equal(choose('% !TEX program = lualatex\n\\usepackage{fontspec}', 'pdflatex'), 'pdflatex');
  assert.equal(choose('text'), 'pdflatex');
  assert.equal(choose('text', 'pdflatex', engines.slice(0, 2)), 'xelatex');
  assert.equal(settings.parse(null).desk.tex.engine, 'auto');
  assert.equal(
    settings.parse(
      settings.apply(null, 'patch', { changes: { desk: { tex: { engine: 'lualatex' } } } }),
    ).desk.tex.engine,
    'lualatex',
  );
  assert.throws(
    () => settings.apply(null, 'patch', { changes: { desk: { tex: { engine: 'invalid' } } } }),
    { code: 'INVALID_TEX_ENGINE' },
  );
});

test('TeX diagnostics parse file-line and classic log forms, warnings and last 40 lines', () => {
  // Standard TeX diagnostic forms: file-line-error and the interactive engine log.
  const log =
    '(./main.tex\n(./chapters/method.tex\n! Undefined control sequence.\nl.42 \\notacommand\n' +
    "LaTeX Warning: Reference `missing' on page 1 undefined on input line 12.\n" +
    'Overfull \\hbox (12.0pt too wide) in paragraph at lines 10--11\n' +
    './chapters/method.tex:44: Missing $ inserted.\n';
  const result = texDiagnostics(log, process.cwd(), 'main.tex');
  assert.deepEqual(result.errors, [
    { file: 'chapters/method.tex', line: 42, message: 'Undefined control sequence.' },
    { file: 'chapters/method.tex', line: 44, message: 'Missing $ inserted.' },
  ]);
  assert.equal(result.warnings, 2);
  assert.equal(
    texDiagnostics(
      Array.from({ length: 60 }, (_, n) => String(n)).join('\n'),
      '',
      '',
    ).logTail.split('\n')[0],
    '20',
  );
});

test('MiKTeX wrapped Windows paths identify the actual chapter rather than a truncated suffix', () => {
  // Shape reproduced by the real MiKTeX acceptance run in a long data path.
  const project = path.resolve('research-folder-with-a-long-name');
  const target = path.join(project, 'chapters/bad.tex').split(path.sep).join('/');
  const split = target.indexOf('long-name') + 4;
  const log =
    target.slice(0, split) +
    '\n' +
    target.slice(split) +
    ':3: Undefined control sequence.\nl.3 \\badcommand\n';
  const parsed = texDiagnostics(log + log, project, 'main.tex');
  assert.deepEqual(parsed.errors, [
    { file: 'chapters/bad.tex', line: 3, message: 'Undefined control sequence.' },
  ]);
});
