export const version = 14;
export const name = 'meeting-goals';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`CREATE TABLE meeting_goals (
    meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    status TEXT NOT NULL,
    rounds INTEGER NOT NULL DEFAULT 0,
    max_rounds INTEGER NOT NULL DEFAULT 30,
    reason TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}
