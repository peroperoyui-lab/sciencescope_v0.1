import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v8 upgrade preserves snapshots and creates durable draft storage with a backup', async () => {
  const { dir, cleanup } = await tempDir('outbox-migration');
  const file = path.join(dir, 'sciencescope.sqlite');
  const backupDir = path.join(dir, 'backups');
  let db;
  try {
    db = await openDatabase(file, { migrations: migrations.slice(0, 8), backupDir });
    db.prepare(
      'INSERT INTO resource_snapshots (id,resource,resource_key,source,created_at) VALUES (?,?,?,?,?)',
    ).run('snapshot', 'plans', 'plans:global', 'leave-page', '2026-10-07');
    db.close();
    db = await openDatabase(file, { migrations, backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, migrations.at(-1).version);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM resource_snapshots').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM meeting_outbox').get().count, 0);
    assert.equal(
      (await readdir(backupDir)).filter((name) => name.startsWith('sciencescope-v8-')).length,
      1,
    );
  } finally {
    db?.close();
    await cleanup();
  }
});
