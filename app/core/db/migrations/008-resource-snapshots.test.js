import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v7 upgrade preserves internal revisions and adds durable history snapshots with a backup', async () => {
  const { dir, cleanup } = await tempDir('snapshots-migration');
  const file = path.join(dir, 'sciencescope.sqlite');
  const backupDir = path.join(dir, 'backups');
  let db;
  try {
    db = await openDatabase(file, { migrations: migrations.slice(0, 7), backupDir });
    db.prepare(
      'INSERT INTO revisions (id,resource,resource_key,op,after_text,created_at) VALUES (?,?,?,?,?,?)',
    ).run('rev-old', 'plans', 'plans:global', 'write', '原计划', '2026-10-07');
    db.close();
    db = await openDatabase(file, { migrations, backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8);
    assert.equal(
      db.prepare('SELECT after_text FROM revisions WHERE id = ?').get('rev-old').after_text,
      '原计划',
    );
    db.prepare(
      'INSERT INTO resource_snapshots (id,resource,resource_key,content_text,source,created_at) VALUES (?,?,?,?,?,?)',
    ).run('snapshot-old', 'plans', 'plans:global', '原计划', 'leave-page', '2026-10-07');
    db.close();
    db = await openDatabase(file, { migrations, backupDir });
    assert.equal(
      db.prepare('SELECT content_text FROM resource_snapshots').get().content_text,
      '原计划',
    );
    assert.equal(
      (await readdir(backupDir)).filter((name) => name.startsWith('sciencescope-v7-')).length,
      1,
    );
  } finally {
    db?.close();
    await cleanup();
  }
});
