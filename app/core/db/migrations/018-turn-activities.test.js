import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v17 upgrades existing turns and tool calls with empty phases and tool activity kinds', async () => {
  const { dir, cleanup } = await tempDir('activity-migration');
  let db;
  try {
    const file = path.join(dir, 'sciencescope.sqlite');
    const backupDir = path.join(dir, 'backups');
    db = await openDatabase(file, { migrations: migrations.slice(0, 17), backupDir });
    db.exec(`INSERT INTO participants VALUES ('main','ai','Main','date');
      INSERT INTO meetings (id,title,policy_json,created_at,updated_at) VALUES ('meeting','Meeting','{}','date','date');
      INSERT INTO turns (id,meeting_id,participant_id,status,started_at) VALUES ('turn','meeting','main','done','date');
      INSERT INTO tool_calls (id,turn_id,seq,name,args_json,status,started_at) VALUES ('call','turn',1,'read','{}','done','date');`);
    db.close();
    db = await openDatabase(file, { migrations, backupDir });
    assert.equal(db.prepare('SELECT phase FROM turns').get().phase, '');
    assert.equal(db.prepare('SELECT kind FROM tool_calls').get().kind, 'tool');
  } finally {
    db?.close();
    await cleanup();
  }
});
