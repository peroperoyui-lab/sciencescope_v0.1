export const version = 10;
export const name = 'message-deliverables';

/** @param {import('../database.js').Db} db */
export function up(db) {
  db.exec(`
    CREATE TABLE message_deliverables (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id),
      turn_id TEXT REFERENCES turns(id),
      tool_call_id TEXT,
      source_path TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX deliverables_by_message ON message_deliverables(message_id, created_at);
    CREATE UNIQUE INDEX deliverables_by_call ON message_deliverables(message_id, turn_id, tool_call_id, source_path);
  `);
}
