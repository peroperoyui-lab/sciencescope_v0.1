import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v26 version groups gain an empty project-file sync record', async () => {
  const fixture = await tempDir('desk-source-sync');
  const file = path.join(fixture.dir, 'app.sqlite'),
    backupDir = path.join(fixture.dir, 'backups');
  let db = await openDatabase(file, { migrations: migrations.slice(0, 26), backupDir });
  try {
    db.close();
    db = await openDatabase(file, { migrations: migrations.slice(0, 27), backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 27);
    const columns = db
      .prepare('PRAGMA table_info(version_groups)')
      .all()
      .map((column) => column.name);
    assert.ok(columns.includes('source_hash') && columns.includes('source_version_id'));
  } finally {
    db.close();
    await fixture.cleanup();
  }
});
