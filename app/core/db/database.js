import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { AppError } from '../errors.js';

/**
 * Thin wrapper over node:sqlite: one connection, synchronous statements,
 * transactions that run callbacks only after a successful commit.
 * @typedef {ReturnType<typeof wrap>} Db
 */
function wrap(raw) {
  let depth = 0;
  const pending = [];
  // While commit callbacks run, newer callbacks wait their turn: an event
  // recorded by a listener must not reach other listeners before the event
  // that caused it (the event stream drops sequence numbers it has passed).
  let flushing = false;

  function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (pending.length) pending.shift()();
    } finally {
      flushing = false;
    }
  }

  return {
    raw,
    /** @param {string} sql */
    prepare: (sql) => raw.prepare(sql),
    /** @param {string} sql */
    exec: (sql) => raw.exec(sql),

    /**
     * Run `work` in a transaction. Nested calls join the outer transaction.
     * @template T
     * @param {() => T} work Synchronous; do file I/O before or after, not inside.
     * @returns {T}
     */
    transaction(work) {
      if (depth > 0) {
        depth++;
        try {
          return work();
        } finally {
          depth--;
        }
      }
      depth = 1;
      // Callbacks still waiting from an outer commit stay when this one rolls back.
      const waiting = pending.length;
      raw.exec('BEGIN IMMEDIATE');
      let result;
      try {
        result = work();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        depth = 0;
        pending.length = waiting;
        throw error;
      }
      depth = 0;
      flush();
      return result;
    },

    /**
     * Run `callback` after the current transaction commits, or now if none is open.
     * @param {() => void} callback
     */
    afterCommit(callback) {
      pending.push(callback);
      if (depth === 0) flush();
    },

    close: () => raw.close(),
  };
}

/**
 * Open (and create or migrate) the application database.
 * Before migrating an existing database it is backed up into `backupDir`.
 * A database written by a newer version of the program is refused.
 *
 * @param {string} file
 * @param {{ migrations: Array<{ version: number, name: string, up: (db: any) => void }>,
 *   backupDir: string }} options
 */
export async function openDatabase(file, { migrations, backupDir }) {
  await mkdir(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file, { allowExtension: true });
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');
  const db = wrap(raw);

  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Migration ${migration.name} must have version ${index + 1}`);
    }
  });

  const current = Number(raw.prepare('PRAGMA user_version').get().user_version);
  const target = migrations.length;
  if (current > target) {
    raw.close();
    throw new AppError(
      'DATA_TOO_NEW',
      '数据由更新版本的 ScienceScope 写入，请先升级程序再打开。',
      409,
    );
  }
  if (current === target) return db;

  if (current > 0) {
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await backup(raw, path.join(backupDir, `sciencescope-v${current}-${stamp}.sqlite`));
  }

  for (const migration of migrations.slice(current)) {
    db.transaction(() => {
      migration.up(db);
      raw.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
  return db;
}
