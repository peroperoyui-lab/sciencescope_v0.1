export const version = 29;
export const name = 'desk-annotations';

/**
 * @param {import('../database.js').Db} db
 * @returns {void}
 */
export function up(db) {
  db.exec(`
    CREATE TABLE manuscript_bindings (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES version_groups(id),
      version_id TEXT REFERENCES manuscript_versions(id), block_id TEXT NOT NULL,
      block_from INTEGER NOT NULL, block_to INTEGER NOT NULL, quote_json TEXT NOT NULL,
      kind TEXT NOT NULL, value TEXT NOT NULL DEFAULT '', sources_json TEXT NOT NULL DEFAULT '[]',
      derivation_json TEXT, note TEXT NOT NULL DEFAULT '', attributed_to TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'anchored', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX manuscript_bindings_group ON manuscript_bindings(group_id);
    CREATE TABLE manuscript_comments (
      id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES version_groups(id),
      version_id TEXT REFERENCES manuscript_versions(id), block_id TEXT NOT NULL,
      block_from INTEGER NOT NULL, block_to INTEGER NOT NULL, quote_json TEXT NOT NULL,
      author_id TEXT NOT NULL, text TEXT NOT NULL, parent_id TEXT,
      resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX manuscript_comments_group ON manuscript_comments(group_id);
    ALTER TABLE desk_changes ADD COLUMN annotations_json TEXT NOT NULL DEFAULT '[]';
  `);
}
