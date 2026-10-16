import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from '../../testing.js';
import { createRequestLog } from './request-log.js';

test('concurrent request metadata rotates an oversized log once and retains the previous launch', async () => {
  const { dir, cleanup } = await tempDir('pi-request-log');
  try {
    await writeFile(path.join(dir, 'model-requests.jsonl'), ' '.repeat(5 * 1024 * 1024 + 1));
    const log = createRequestLog(dir);
    await Promise.all([log({ session: 'a', usage: null }), log({ session: 'b', usage: null })]);
    const rows = (await readFile(path.join(dir, 'model-requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((row) => JSON.parse(row));
    assert.deepEqual(
      rows.map((row) => row.session),
      ['a', 'b'],
    );
    assert.equal(
      (await readFile(path.join(dir, 'model-requests.previous.jsonl'))).length,
      5 * 1024 * 1024 + 1,
    );
  } finally {
    await cleanup();
  }
});
