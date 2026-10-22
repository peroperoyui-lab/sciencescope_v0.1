export const version = 28;
export const name = 'version-diffs';

/**
 * @param {import('../database.js').Db} db
 * @returns {void}
 */
export function up(db) {
  db.exec(`CREATE TABLE version_diffs (
    baseline_id TEXT NOT NULL REFERENCES manuscript_versions(id) ON DELETE CASCADE,
    version_id TEXT NOT NULL REFERENCES manuscript_versions(id) ON DELETE CASCADE,
    algorithm INTEGER NOT NULL,
    diff_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (baseline_id, version_id)
  )`);
}
