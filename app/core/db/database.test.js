import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from './database.js';
import { tempDir } from '../../testing.js';

const first = {
  version: 1,
  name: 'first',
  up: (db) => db.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, text TEXT)'),
};
const second = {
  version: 2,
  name: 'second',
  up: (db) => db.exec('ALTER TABLE notes ADD COLUMN tag TEXT'),
};

test('migrations run in order, back up the old database and keep its data', async () => {
  const { dir, cleanup } = await tempDir('database');
  const file = path.join(dir, 'app.sqlite');
  const backupDir = path.join(dir, 'backups');
  try {
    const v1 = await openDatabase(file, { migrations: [first], backupDir });
    v1.prepare('INSERT INTO notes (id, text) VALUES (?, ?)').run('n1', 'kept');
    v1.close();

    const v2 = await openDatabase(file, { migrations: [first, second], backupDir });
    assert.equal(v2.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(v2.prepare('SELECT text FROM notes').get().text, 'kept');
    v2.close();

    const backups = await readdir(backupDir);
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^sciencescope-v1-/);
  } finally {
    await cleanup();
  }
});

test('a database from a newer program version is refused', async () => {
  const { dir, cleanup } = await tempDir('database');
  const file = path.join(dir, 'app.sqlite');
  const backupDir = path.join(dir, 'backups');
  try {
    (await openDatabase(file, { migrations: [first, second], backupDir })).close();
    await assert.rejects(openDatabase(file, { migrations: [first], backupDir }), {
      code: 'DATA_TOO_NEW',
    });
  } finally {
    await cleanup();
  }
});

test('afterCommit callbacks run only when the transaction commits', async () => {
  const { dir, cleanup } = await tempDir('database');
  try {
    const db = await openDatabase(path.join(dir, 'app.sqlite'), {
      migrations: [first],
      backupDir: path.join(dir, 'backups'),
    });
    const calls = [];
    db.transaction(() => {
      db.prepare('INSERT INTO notes (id) VALUES (?)').run('a');
      db.afterCommit(() => calls.push('committed'));
      assert.deepEqual(calls, []);
    });
    assert.deepEqual(calls, ['committed']);

    assert.throws(() =>
      db.transaction(() => {
        db.prepare('INSERT INTO notes (id) VALUES (?)').run('b');
        db.afterCommit(() => calls.push('rolled back'));
        throw new Error('stop');
      }),
    );
    assert.deepEqual(calls, ['committed']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 1);
    db.close();
  } finally {
    await cleanup();
  }
});

test('a callback added while commit callbacks run waits for the ones before it', async () => {
  const { dir, cleanup } = await tempDir('database-order');
  try {
    const db = await openDatabase(path.join(dir, 'app.sqlite'), {
      migrations: [first],
      backupDir: path.join(dir, 'backups'),
    });
    const calls = [];
    db.transaction(() => {
      db.afterCommit(() => {
        calls.push('a');
        // A listener's own change, outside a transaction and inside a rolled back one.
        db.afterCommit(() => calls.push('c'));
        assert.throws(() =>
          db.transaction(() => {
            db.afterCommit(() => calls.push('rolled back'));
            throw new Error('stop');
          }),
        );
        db.transaction(() => db.afterCommit(() => calls.push('d')));
        assert.deepEqual(calls, ['a']);
      });
      db.afterCommit(() => calls.push('b'));
    });
    assert.deepEqual(calls, ['a', 'b', 'c', 'd']);
    db.afterCommit(() => calls.push('now'));
    assert.equal(calls.at(-1), 'now');
    db.close();
  } finally {
    await cleanup();
  }
});
