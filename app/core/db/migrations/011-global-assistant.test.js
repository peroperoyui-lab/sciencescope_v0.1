import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v10 upgrade adds durable assistant identity without replacing existing tables', async () => {
  const { dir, cleanup } = await tempDir('assistant-migration');
  const file = path.join(dir, 'sciencescope.sqlite');
  const backupDir = path.join(dir, 'backups');
  let db;
  try {
    db = await openDatabase(file, { migrations: migrations.slice(0, 10), backupDir });
    db.close();
    db = await openDatabase(file, { migrations, backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 11);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM assistant_state').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM message_deliverables').get().count, 0);
    assert.equal(
      (await readdir(backupDir)).filter((name) => name.startsWith('sciencescope-v10-')).length,
      1,
    );
  } finally {
    db?.close();
    await cleanup();
  }
});
