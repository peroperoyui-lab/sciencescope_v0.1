export const version = 16;
export const name = 'version-notes';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`ALTER TABLE projects ADD COLUMN auto_version_notes INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE manuscript_versions ADD COLUMN notes_references_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE manuscript_versions ADD COLUMN notes_turn_id TEXT REFERENCES turns(id);
    CREATE TABLE version_note_meetings (
      project_id TEXT PRIMARY KEY REFERENCES projects(id),
      meeting_id TEXT NOT NULL REFERENCES meetings(id)
    );`);
}
