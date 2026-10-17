import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v16 upgrades log references without changing manuscript records or log history', async () => {
  const { dir, cleanup } = await tempDir('journal-migration');
  let db;
  try {
    const file = path.join(dir, 'sciencescope.sqlite');
    const backupDir = path.join(dir, 'backups');
    db = await openDatabase(file, { migrations: migrations.slice(0, 16), backupDir });
    db.exec(
      "INSERT INTO projects (id,name,dir_name,created_at,updated_at) VALUES ('project','中文项目','中文目录','date','date'); INSERT INTO version_groups (id,project_id,name,created_at,updated_at) VALUES ('group','project','稿件','date','date'); INSERT INTO manuscript_versions (id,group_id,number,original_name,original_path,created_at) VALUES ('version','group',1,'稿件.pdf','versions/稿件.pdf','date');",
    );
    db.close();
    db = await openDatabase(file, { migrations, backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, migrations.at(-1).version);
    assert.equal(
      db.prepare('SELECT original_name FROM manuscript_versions').get().original_name,
      '稿件.pdf',
    );
    db.prepare('INSERT INTO log_file_references VALUES (?,?,?,?)').run(
      'project',
      0,
      0,
      JSON.stringify({ schema: 1, kind: 'version', id: 'version' }),
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM log_file_references').get().n, 1);
  } finally {
    db?.close();
    await cleanup();
  }
});
