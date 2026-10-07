export const version = 8;
export const name = 'resource-snapshots';

/** @param {import('../database.js').Db} db */
export function up(db) {
  db.exec(`
    CREATE TABLE resource_snapshots (
      id TEXT PRIMARY KEY,
      resource TEXT NOT NULL,
      resource_key TEXT NOT NULL,
      project_id TEXT,
      content_text TEXT,
      content_hash TEXT,
      revision_id TEXT,
      actor_id TEXT,
      meeting_id TEXT,
      turn_id TEXT,
      source TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX snapshots_by_key ON resource_snapshots(resource_key, created_at);
    CREATE INDEX snapshots_by_project ON resource_snapshots(project_id, created_at);
    CREATE UNIQUE INDEX snapshots_by_turn ON resource_snapshots(turn_id, resource_key)
      WHERE source = 'ai-turn-end';
    ALTER TABLE revisions ADD COLUMN restored_from_revision_id TEXT;
  `);
}
