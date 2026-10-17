import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tempDir } from '../../testing.js';
import { fetchPage } from './web.js';
import { presentOutput } from './output.js';

test('a fetched research page returns readable external content without executable markup', async () => {
  const { dir, cleanup } = await tempDir('builtin-web');
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      '<html><head><style>.hidden{}</style></head><body><h1>研究报告</h1><p>结果 &amp; 证据。</p><script>hidden()</script></body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  try {
    const url = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/report`;
    const result = await fetchPage({ url }, { temp: dir });
    assert.equal(result.origin, 'external');
    assert.equal(result.url, url);
    assert.match(result.output, /研究报告[\s\S]*结果 & 证据/);
    assert.doesNotMatch(result.output, /hidden/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await cleanup();
  }
});

test('large Chinese output preserves both ends and saves every original byte', async () => {
  const { dir, cleanup } = await tempDir('builtin-output');
  try {
    const original = '开头\n' + '中文资料🙂\n'.repeat(20000) + '结束';
    const result = await presentOutput(original, dir);
    assert.ok(result.output.startsWith('开头'));
    assert.ok(result.output.endsWith('结束'));
    assert.doesNotMatch(result.output, /\ufffd/);
    assert.equal(result.totalBytes, Buffer.byteLength(original));
    assert.ok(result.omittedBytes > 0);
    assert.match(result.output, /省略了中间.*完整输出在/);
    assert.equal(await readFile(result.fullOutputPath, 'utf8'), original);
  } finally {
    await cleanup();
  }
});
