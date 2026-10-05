// Every Chinese string literal in the interface needs an English entry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { en } from './en.js';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every Chinese interface string has an English entry', async () => {
  const files = (await readdir(uiRoot, { recursive: true })).filter(
    (file) => file.endsWith('.js') && !file.endsWith('.test.js') && !file.endsWith('en.js'),
  );
  const missing = [];
  for (const file of files) {
    const source = await readFile(path.join(uiRoot, file), 'utf8');
    for (const [, text] of source.matchAll(/'([^'\n]*[一-鿿][^'\n]*)'/g)) {
      const value = text.replace(/\\n/g, '\n');
      if (!(value in en)) missing.push(`${file}: ${text}`);
    }
  }
  assert.deepEqual(missing, []);
});
