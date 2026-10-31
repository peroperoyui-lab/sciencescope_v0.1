import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tempDir } from '../../testing.js';
import { openDatabase } from './database.js';
import { migrations } from './migrations/index.js';

test('v30 import index upgrade backs up all rows and uses the partial expression index', async () => {
  const { dir, cleanup } = await tempDir('source-import-index');
  const file = path.join(dir, 'app.sqlite'),
    backupDir = path.join(dir, 'backups');
  let db;
  try {
    db = await openDatabase(file, { migrations: migrations.slice(0, 30), backupDir });
    db.prepare(`INSERT INTO events(type,payload_json,created_at) VALUES(?,?,?)`).run(
      'research.changed',
      JSON.stringify({ action: 'source.imported', sourceId: 'fixture' }),
      'kept',
    );
    const before = db.prepare('SELECT * FROM events').all();
    db.close();
    db = await openDatabase(file, { migrations: migrations.slice(0, 31), backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 31);
    assert.deepEqual(db.prepare('SELECT * FROM events').all(), before);
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT json_extract(payload_json,'$.sourceId'),max(seq)
      FROM events WHERE type='research.changed' AND json_extract(payload_json,'$.action')='source.imported'
      GROUP BY json_extract(payload_json,'$.sourceId')`,
      )
      .all();
    assert.match(plan.map((item) => item.detail).join(' '), /USING INDEX events_source_import/);
    const backups = await readdir(backupDir);
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(path.join(backupDir, backups[0]), { readOnly: true });
    try {
      assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 30);
      assert.deepEqual(backup.prepare('SELECT * FROM events').all(), before);
    } finally {
      backup.close();
    }
  } finally {
    db?.close();
    await cleanup();
  }
});
