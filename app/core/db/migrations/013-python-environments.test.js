import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v12 upgrades Python state alongside existing research input', async () => {
  const { dir, cleanup } = await tempDir('python-migration');
  let db;
  try {
    const file = path.join(dir, 'sciencescope.sqlite'),
      backupDir = path.join(dir, 'backups');
    db = await openDatabase(file, { migrations: migrations.slice(0, 12), backupDir });
    db.prepare('INSERT INTO research_input_drafts(owner_id,input_json) VALUES(?,?)').run(
      'meeting',
      '{}',
    );
    db.close();
    db = await openDatabase(file, { migrations, backupDir });
    assert.equal(db.prepare('SELECT input_json FROM research_input_drafts').get().input_json, '{}');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM python_environments').get().n, 0);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, migrations.at(-1).version);
  } finally {
    db?.close();
    await cleanup();
  }
});
