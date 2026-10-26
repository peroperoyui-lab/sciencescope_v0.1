import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v29 versions gain empty descriptions and no key flag while retaining labels and lineage', async () => {
  const fixture = await tempDir('version-marks-migration');
  const file = path.join(fixture.dir, 'app.sqlite');
  const backupDir = path.join(fixture.dir, 'backups');
  let db = await openDatabase(file, { migrations: migrations.slice(0, 29), backupDir });
  try {
    db.exec(`INSERT INTO projects (id,name,dir_name,created_at,updated_at)
      VALUES ('p','项目','p','old','old');
      INSERT INTO version_groups (id,project_id,name,created_at,updated_at)
      VALUES ('g','p','稿件','old','old');
      INSERT INTO manuscript_versions
      (id,group_id,number,original_name,original_path,parent_id,label,title,branch,created_at)
      VALUES ('v1','g',1,'首稿.md','first.md',NULL,'原标签','首稿','主线','old'),
      ('v2','g',2,'修订.md','second.md','v1','次标签','修订稿','主线','old');`);
    const previous = db.prepare('SELECT * FROM manuscript_versions ORDER BY number').all();
    db.close();
    db = await openDatabase(file, { migrations, backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 30);
    const upgraded = db.prepare('SELECT * FROM manuscript_versions ORDER BY number').all();
    for (const [index, row] of upgraded.entries()) {
      assert.equal(row.description, '');
      assert.equal(row.is_key, 0);
      for (const field of Object.keys(previous[index]))
        assert.deepEqual(row[field], previous[index][field]);
    }
    assert.throws(
      () => db.prepare('UPDATE manuscript_versions SET description=NULL WHERE id=?').run('v1'),
      /NOT NULL/u,
    );
  } finally {
    db.close();
    await fixture.cleanup();
  }
});
