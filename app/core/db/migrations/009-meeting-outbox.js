export const version = 9;
export const name = 'meeting-outbox';

/** @param {import('../database.js').Db} db */
export function up(db) {
  db.exec(`
    CREATE TABLE meeting_outbox_state (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id),
      paused INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE meeting_outbox (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      author_id TEXT NOT NULL REFERENCES participants(id),
      text TEXT NOT NULL,
      refs_json TEXT NOT NULL DEFAULT '{}',
      reply_to TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX outbox_by_meeting ON meeting_outbox(meeting_id, created_at);
  `);
}
