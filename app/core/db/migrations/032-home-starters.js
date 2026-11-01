export const version = 32;
export const name = 'home-starters';

/**
 * Keep generated cards separate from research facts. The sequence protects the
 * global slot from an older project finishing after the user has left another.
 * @param {import('../database.js').Db} db
 * @returns {void}
 */
export function up(db) {
  db.exec(`
    CREATE TABLE home_starters (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      input_hash TEXT,
      result_json TEXT,
      written_at TEXT,
      error TEXT,
      pending_seq INTEGER
    );
    CREATE TABLE home_starters_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      slot_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      slot_result_json TEXT,
      slot_written_at TEXT,
      focused_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      request_seq INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO home_starters_state (id) VALUES (1);
  `);
}
