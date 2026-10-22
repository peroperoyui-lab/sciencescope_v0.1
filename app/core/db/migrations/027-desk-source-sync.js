export const version = 27;
export const name = 'desk-source-sync';

/**
 * What ScienceScope last saw in or wrote to a group's project file: its hash,
 * and the version it descends from. Saving to the project file makes no
 * version, so the latest version's hash cannot tell an external edit apart.
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`
    ALTER TABLE version_groups ADD COLUMN source_hash TEXT;
    ALTER TABLE version_groups ADD COLUMN source_version_id TEXT REFERENCES manuscript_versions(id);
  `);
}
