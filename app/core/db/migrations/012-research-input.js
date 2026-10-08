export const version = 12;
export const name = 'research-input';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE research_input_drafts (
      owner_id TEXT PRIMARY KEY,
      input_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE message_research_input (
      message_id TEXT PRIMARY KEY REFERENCES messages(id),
      input_json TEXT NOT NULL
    );
    ALTER TABLE meeting_outbox ADD COLUMN input_json TEXT;
  `);
}
