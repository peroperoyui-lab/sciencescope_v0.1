export const version = 26;
export const name = 'knowledge-positions';

/**
 * Coordinates are a rebuildable projection, shared by every project view.
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`CREATE TABLE kb_positions (
    ref TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`);
}
