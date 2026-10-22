import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v27 upgrades to a pair-keyed version diff cache without changing originals or lineage', async () => {
  const fixture = await tempDir('version-diff-migration');
  const file = path.join(fixture.dir, 'app.sqlite');
  const backupDir = path.join(fixture.dir, 'backups');
  let db = await openDatabase(file, { migrations: migrations.slice(0, 27), backupDir });
  try {
    db.exec(`INSERT INTO projects (id,name,dir_name,created_at,updated_at) VALUES ('p','项目','p','old','old');
      INSERT INTO version_groups (id,project_id,name,created_at,updated_at) VALUES ('g','p','稿件','old','old');
      INSERT INTO manuscript_versions (id,group_id,number,original_name,original_path,parent_id,created_at)
      VALUES ('v1','g',1,'首稿.docx','first.docx',NULL,'old'),('v2','g',2,'修订.docx','second.docx','v1','old');`);
    const versions = db.prepare('SELECT * FROM manuscript_versions ORDER BY number').all();
    db.close();
    db = await openDatabase(file, { migrations: migrations.slice(0, 28), backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 28);
    assert.deepEqual(
      db.prepare('SELECT * FROM manuscript_versions ORDER BY number').all(),
      versions,
    );
    const insert = db.prepare('INSERT INTO version_diffs VALUES (?,?,?,?,?)');
    insert.run('v1', 'v2', 1, '{}', 'now');
    assert.throws(() => insert.run('v1', 'v2', 1, '{}', 'now'), /UNIQUE/u);
    assert.throws(() => insert.run('missing', 'v2', 1, '{}', 'now'), /FOREIGN KEY/u);
    assert.throws(() => insert.run('v1', 'missing', 1, '{}', 'now'), /FOREIGN KEY/u);
  } finally {
    db.close();
    await fixture.cleanup();
  }
});
