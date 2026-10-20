import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('project file metadata upgrades an existing v22 catalog without replacing sources', async () => {
  const fixture = await tempDir('project-index-upgrade');
  const file = path.join(fixture.dir, 'app.sqlite');
  const backupDir = path.join(fixture.dir, 'backups');
  let db = await openDatabase(file, { migrations: migrations.slice(0, 22), backupDir });
  try {
    db.prepare(
      `INSERT INTO rb_sources
      (id,number,kind,title,original_path,name,created_at,updated_at)
      VALUES ('source',1,'paper','Existing','originals/paper.pdf','paper.pdf','old','old')`,
    ).run();
    db.close();
    db = await openDatabase(file, { migrations, backupDir });
    const source = db.prepare("SELECT * FROM rb_sources WHERE id='source'").get();
    assert.equal(source.original_path, 'originals/paper.pdf');
    assert.equal(source.file_size, null);
    assert.equal(source.file_mtime_ms, null);
    assert.equal(source.content_hash, null);
  } finally {
    db.close();
    await fixture.cleanup();
  }
});
