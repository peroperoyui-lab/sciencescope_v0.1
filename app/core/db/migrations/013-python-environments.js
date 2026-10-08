export const version = 13;
export const name = 'python-environments';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE python_environments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
      status TEXT NOT NULL, error TEXT,
      packages_json TEXT NOT NULL DEFAULT '[]', lock_json TEXT NOT NULL DEFAULT '[]',
      failed_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
    );
    CREATE TABLE python_bindings (
      scope TEXT NOT NULL, target_id TEXT NOT NULL, environment_id TEXT NOT NULL,
      PRIMARY KEY(scope,target_id)
    );
    CREATE TABLE python_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, environment_id TEXT, actor_id TEXT NOT NULL,
      action TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL,
      detail_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
}
