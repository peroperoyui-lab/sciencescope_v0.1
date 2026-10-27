export const version = 30;
export const name = 'version-marks';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`ALTER TABLE manuscript_versions ADD COLUMN description TEXT NOT NULL DEFAULT '';
    ALTER TABLE manuscript_versions ADD COLUMN is_key INTEGER NOT NULL DEFAULT 0;`);
}
