import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v4 upgrade adds minutes coverage without losing messages or revision history and backs up data', async () => {
  const { dir, cleanup } = await tempDir('minutes-migration');
  const file = path.join(dir, 'sciencescope.sqlite');
  const backupDir = path.join(dir, 'backups');
  let database;
  try {
    database = await openDatabase(file, { migrations: migrations.slice(0, 4), backupDir });
    const time = '2026-10-07T00:00:00.000Z';
    database
      .prepare('INSERT INTO participants (id, kind, name, created_at) VALUES (?, ?, ?, ?)')
      .run('person_user', 'human', '我', time);
    database
      .prepare(
        'INSERT INTO meetings (id, title, policy_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('meeting', '研究', '{}', time, time);
    database
      .prepare(
        'INSERT INTO messages (id, meeting_id, seq, author_id, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('message', 'meeting', 1, 'person_user', '不可丢失的完整原文', time, time);
    database
      .prepare(
        'INSERT INTO revisions (id, resource, resource_key, op, before_text, after_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('revision', 'minutes', 'minutes:meeting', 'write', null, '用户的旧纪要', time);
    database.close();
    database = await openDatabase(file, { migrations, backupDir });
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 5);
    assert.equal(database.prepare('SELECT text FROM messages').get().text, '不可丢失的完整原文');
    assert.equal(
      database.prepare('SELECT after_text FROM revisions').get().after_text,
      '用户的旧纪要',
    );
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM minutes_coverage').get().count, 0);
    assert.equal(
      (await readdir(backupDir)).filter((name) => name.startsWith('sciencescope-v4-')).length,
      1,
    );
  } finally {
    database?.close();
    await cleanup();
  }
});
