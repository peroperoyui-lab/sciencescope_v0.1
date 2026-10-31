import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v31 gains durable per-project starters and one recoverable home slot without changing project data', async () => {
  const fixture = await tempDir('home-starters-migration');
  const file = path.join(fixture.dir, 'app.sqlite');
  const backupDir = path.join(fixture.dir, 'backups');
  let db = await openDatabase(file, {
    migrations: migrations.filter((migration) => migration.version <= 31),
    backupDir,
  });
  try {
    db.exec(`INSERT INTO projects (id,name,dir_name,created_at,updated_at)
      VALUES ('project','公开合成项目','project','old','old');`);
    const previous = db.prepare('SELECT * FROM projects').get();
    db.close();
    db = await openDatabase(file, {
      migrations: migrations.filter((migration) => migration.version <= 32),
      backupDir,
    });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 32);
    assert.deepEqual(db.prepare('SELECT * FROM projects').get(), previous);
    assert.equal((await readdir(backupDir)).filter((name) => name.endsWith('.sqlite')).length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM home_starters').get().count, 0);
    assert.deepEqual(
      { ...db.prepare('SELECT * FROM home_starters_state').get() },
      {
        id: 1,
        slot_project_id: null,
        slot_result_json: null,
        slot_written_at: null,
        focused_project_id: null,
        request_seq: 0,
      },
    );

    const json = JSON.stringify({ progress: '等待复核', cards: [] });
    db.prepare(
      `INSERT INTO home_starters
      (project_id,input_hash,result_json,written_at,error,pending_seq)
      VALUES (?,?,?,?,?,?)`,
    ).run('project', 'fingerprint', json, 'written', 'previous failure', 3);
    db.prepare(
      `UPDATE home_starters_state SET slot_project_id=?,slot_result_json=?,
      slot_written_at=?,focused_project_id=?,request_seq=? WHERE id=1`,
    ).run('project', json, 'written', 'project', 3);
    const cached = db.prepare('SELECT * FROM home_starters').get();
    const state = db.prepare('SELECT * FROM home_starters_state').get();
    db.close();
    db = await openDatabase(file, {
      migrations: migrations.filter((migration) => migration.version <= 32),
      backupDir,
    });
    assert.deepEqual(db.prepare('SELECT * FROM home_starters').get(), cached);
    assert.deepEqual(db.prepare('SELECT * FROM home_starters_state').get(), state);
    assert.throws(
      () => db.prepare('INSERT INTO home_starters_state(id) VALUES (2)').run(),
      /CHECK/u,
    );
    db.prepare('DELETE FROM projects WHERE id=?').run('project');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM home_starters').get().count, 0);
    const deleted = db.prepare('SELECT * FROM home_starters_state').get();
    assert.equal(deleted.slot_project_id, null);
    assert.equal(deleted.focused_project_id, null);
    assert.equal(deleted.request_seq, 3);
  } finally {
    db.close();
    await fixture.cleanup();
  }
});
