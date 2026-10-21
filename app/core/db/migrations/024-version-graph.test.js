import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v23 manuscript versions upgrade their lineage without reading missing originals', async () => {
  const fixture = await tempDir('version-graph-upgrade');
  const file = path.join(fixture.dir, 'app.sqlite');
  const backupDir = path.join(fixture.dir, 'backups');
  let db = await openDatabase(file, { migrations: migrations.slice(0, 23), backupDir });
  try {
    db.exec(`
      INSERT INTO projects (id,name,dir_name,created_at,updated_at) VALUES ('p','项目','p','old','old');
      INSERT INTO version_groups (id,project_id,name,created_at,updated_at) VALUES ('g','p','稿件','old','old');
      INSERT INTO manuscript_versions
        (id,group_id,number,original_name,original_path,baseline_id,created_at)
        VALUES ('v1','g',1,'首稿.docx','missing/first.docx',NULL,'old'),
               ('v2','g',2,'修改.docx','missing/second.docx','v1','old');
    `);
    db.close();
    db = await openDatabase(file, { migrations: migrations.slice(0, 24), backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 24);
    const rows = db.prepare('SELECT * FROM manuscript_versions ORDER BY number').all();
    assert.deepEqual(
      rows.map((row) => row.parent_id),
      [null, 'v1'],
    );
    assert.ok(rows.every((row) => row.parent_id === row.baseline_id && row.content_hash === null));
    assert.ok(rows.every((row) => row.branch === '' && row.origin === 'import'));
    const group = db.prepare('SELECT * FROM version_groups').get();
    assert.equal(group.source_path, null);
    assert.equal(group.format, 'other');
    assert.equal(db.prepare('SELECT count(*) AS n FROM desk_sessions').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM desk_changes').get().n, 0);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='desk_changes_session'").get());
  } finally {
    db.close();
    await fixture.cleanup();
  }
});
