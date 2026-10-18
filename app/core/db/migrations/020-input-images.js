export const version = 20;
export const name = 'input-images';

/**
 * Image attachments keep their identity independently of the research index.
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`CREATE TABLE input_images (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL,
    original_path TEXT NOT NULL, bytes INTEGER NOT NULL
  )`);
}
