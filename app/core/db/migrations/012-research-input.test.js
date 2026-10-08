import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v11 upgrades research input without replacing existing message and outbox tables', async () => {
  const { dir, cleanup } = await tempDir('input-migration');
  let db;
  try {
    const file = path.join(dir, 'sciencescope.sqlite');
    const backupDir = path.join(dir, 'backups');
    db = await openDatabase(file, { migrations: migrations.slice(0, 11), backupDir });
    db.close();
    db = await openDatabase(file, { migrations, backupDir });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, migrations.at(-1).version);
    db.prepare('INSERT INTO research_input_drafts(owner_id,input_json) VALUES(?,?)').run(
      'new:global',
      '{"materials":[]}',
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM research_input_drafts').get().count, 1);
    assert.equal(
      db.prepare('SELECT COUNT(input_json) AS count FROM meeting_outbox').get().count,
      0,
    );
  } finally {
    db?.close();
    await cleanup();
  }
});
