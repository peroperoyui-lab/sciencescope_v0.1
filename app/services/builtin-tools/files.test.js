import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from '../../testing.js';
import { createFileTools } from './files.js';

async function fixture(work) {
  const { dir, cleanup } = await tempDir('builtin-files');
  const run = createFileTools({ secret: path.join(dir, 'secret'), temp: path.join(dir, 'temp') });
  const context = { workFolder: dir, signal: new AbortController().signal };
  try {
    await work({ dir, call: (name, args) => run(name, args, context) });
  } finally {
    await cleanup();
  }
}

test('read_file pages Chinese text and directs document and binary readers appropriately', async () => {
  await fixture(async ({ dir, call }) => {
    await writeFile(path.join(dir, '中文.txt'), '第一行\r\n第二行\r\n第三行');
    const result = await call('read_file', { path: '中文.txt', offset: 2, limit: 1 });
    assert.equal(result.output, '第二行');
    assert.equal(result.totalLines, 3);
    await writeFile(path.join(dir, 'paper.pdf'), '%PDF');
    await assert.rejects(call('read_file', { path: 'paper.pdf' }), /research_read/);
    await writeFile(path.join(dir, 'binary.bin'), Buffer.from([0, 1, 2]));
    await assert.rejects(call('read_file', { path: 'binary.bin' }), /binary/);
  });
});

test('write_file creates parent folders and overwrites the selected file', async () => {
  await fixture(async ({ dir, call }) => {
    const target = path.join(dir, '子目录', '脚本.py');
    await call('write_file', { path: target, content: 'print(1)' });
    await call('write_file', { path: target, content: 'print(2)' });
    assert.equal(await readFile(target, 'utf8'), 'print(2)');
  });
});

test('edit_file replaces a unique exact match and preserves ambiguous or missing content', async () => {
  await fixture(async ({ dir, call }) => {
    const target = path.join(dir, 'plan.md');
    await writeFile(target, '\ufeff开始\r\n待办\r\n待办\r\n结束');
    await call('edit_file', { path: target, oldText: '开始\r\n待办', newText: '开始\r\n完成' });
    const saved = await readFile(target, 'utf8');
    assert.equal(saved, '\ufeff开始\r\n完成\r\n待办\r\n结束');
    await assert.rejects(
      call('edit_file', { path: target, oldText: '\r\n', newText: '\n' }),
      /more than once/,
    );
    await assert.rejects(
      call('edit_file', { path: target, oldText: 'missing', newText: '' }),
      /not found/,
    );
    assert.equal(await readFile(target, 'utf8'), saved);
  });
});

async function tree(dir) {
  for (const folder of ['src', '.git', 'node_modules/library']) {
    await mkdir(path.join(dir, folder), { recursive: true });
    await writeFile(path.join(dir, folder, 'sample.js'), 'first\nEvidence = 42\nlast');
  }
}

test('list_files matches globs while skipping repository metadata and installed dependencies', async () => {
  await fixture(async ({ dir, call }) => {
    await tree(dir);
    const result = await call('list_files', { pattern: '**/*.js' });
    assert.equal(result.count, 1);
    assert.equal(result.output.replaceAll('\\', '/'), 'src/sample.js');
  });
});

test('grep_files returns matching file, line number and complete text', async () => {
  await fixture(async ({ dir, call }) => {
    await tree(dir);
    const result = await call('grep_files', { pattern: 'evidence\\s*=\\s*\\d+', ignoreCase: true });
    assert.equal(result.matches, 1);
    assert.match(result.output.replaceAll('\\', '/'), /src\/sample.js:2:Evidence = 42/);
  });
});
