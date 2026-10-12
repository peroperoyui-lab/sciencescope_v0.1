export const version = 17;
export const name = 'log-file-references';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`CREATE TABLE log_file_references (
    project_id TEXT NOT NULL REFERENCES projects(id),
    entry_line INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    reference_json TEXT NOT NULL,
    PRIMARY KEY (project_id, entry_line, ordinal)
  );`);
}
