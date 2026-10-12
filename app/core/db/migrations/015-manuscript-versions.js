export const version = 15;
export const name = 'manuscript-versions';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`CREATE TABLE version_groups (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    next_number INTEGER NOT NULL DEFAULT 1,
    auto_organize INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE manuscript_versions (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES version_groups(id),
    number INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    original_path TEXT NOT NULL,
    baseline_id TEXT REFERENCES manuscript_versions(id),
    notes_status TEXT NOT NULL DEFAULT 'pending',
    notes_error TEXT NOT NULL DEFAULT '',
    generated_at TEXT,
    imported_by TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(group_id, number)
  );
  CREATE INDEX manuscript_versions_group ON manuscript_versions(group_id, number);`);
}
