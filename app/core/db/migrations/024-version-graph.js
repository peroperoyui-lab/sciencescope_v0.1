export const version = 24;
export const name = 'version-graph';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`
    ALTER TABLE version_groups ADD COLUMN source_path TEXT;
    ALTER TABLE version_groups ADD COLUMN format TEXT NOT NULL DEFAULT 'other';
    ALTER TABLE manuscript_versions ADD COLUMN parent_id TEXT REFERENCES manuscript_versions(id);
    ALTER TABLE manuscript_versions ADD COLUMN branch TEXT NOT NULL DEFAULT '';
    ALTER TABLE manuscript_versions ADD COLUMN tier TEXT NOT NULL DEFAULT '';
    ALTER TABLE manuscript_versions ADD COLUMN label TEXT NOT NULL DEFAULT '';
    ALTER TABLE manuscript_versions ADD COLUMN title TEXT NOT NULL DEFAULT '';
    ALTER TABLE manuscript_versions ADD COLUMN origin TEXT NOT NULL DEFAULT 'import';
    ALTER TABLE manuscript_versions ADD COLUMN content_hash TEXT;
    ALTER TABLE manuscript_versions ADD COLUMN session_id TEXT;
    UPDATE manuscript_versions SET parent_id = baseline_id;
    CREATE INDEX manuscript_versions_parent ON manuscript_versions(parent_id);
    CREATE TABLE desk_sessions (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES version_groups(id),
      base_version_id TEXT NOT NULL REFERENCES manuscript_versions(id),
      meeting_id TEXT REFERENCES meetings(id),
      status TEXT NOT NULL DEFAULT 'open',
      seq INTEGER NOT NULL DEFAULT 0,
      saved_seq INTEGER NOT NULL DEFAULT 0,
      result_version_id TEXT REFERENCES manuscript_versions(id),
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE desk_changes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES desk_sessions(id),
      version_id TEXT REFERENCES manuscript_versions(id),
      seq INTEGER NOT NULL,
      block_id TEXT NOT NULL,
      op TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      actor_id TEXT,
      meeting_id TEXT,
      turn_id TEXT,
      instruction TEXT NOT NULL DEFAULT '',
      settled INTEGER NOT NULL DEFAULT 0,
      undone_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX desk_changes_session ON desk_changes(session_id, seq);
    CREATE INDEX desk_changes_version ON desk_changes(version_id);
  `);
}
