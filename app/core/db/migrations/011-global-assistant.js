export const version = 11;
export const name = 'global-assistant';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE assistant_state (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id),
      overview_hash TEXT
    );
  `);
}
