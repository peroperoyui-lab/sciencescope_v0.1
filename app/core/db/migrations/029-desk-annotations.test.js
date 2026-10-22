import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v28 upgrades annotation tables and retains existing desk journal entries', async () => {
  const fixture = await tempDir('desk-annotations-upgrade');
  const file = path.join(fixture.dir, 'app.sqlite');
  const backupDir = path.join(fixture.dir, 'backups');
  let db = await openDatabase(file, { migrations: migrations.slice(0, 28), backupDir });
  try {
    db.exec('PRAGMA foreign_keys=OFF');
    db.prepare(
      "INSERT INTO desk_changes(id,session_id,seq,block_id,op,before_json,after_json,created_at) VALUES ('chg_before','session',1,'p:old','edit','[]','[]','2026-10-22')",
    ).run();
    db.close();
    db = await openDatabase(file, { migrations: migrations.slice(0, 29), backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 29);
    assert.equal(
      db.prepare("SELECT annotations_json FROM desk_changes WHERE id='chg_before'").get()
        .annotations_json,
      '[]',
    );
    for (const table of ['manuscript_bindings', 'manuscript_comments']) {
      const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name);
      for (const name of ['group_id', 'version_id', 'block_from', 'block_to', 'quote_json'])
        assert.ok(columns.includes(name));
    }
  } finally {
    db.close();
    await fixture.cleanup();
  }
});
