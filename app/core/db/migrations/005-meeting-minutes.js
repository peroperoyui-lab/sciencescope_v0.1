export const version = 5;
export const name = 'meeting-minutes';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE minutes_coverage (
      revision_id TEXT PRIMARY KEY REFERENCES revisions(id),
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      through_seq INTEGER NOT NULL,
      covered_message_ids_json TEXT NOT NULL
    );
    CREATE INDEX minutes_coverage_meeting ON minutes_coverage(meeting_id);
    CREATE TABLE minutes_status (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id),
      error TEXT,
      incomplete_output TEXT,
      export_path TEXT,
      export_error TEXT,
      workbench_error TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE minutes_workbench_updates (
      revision_id TEXT PRIMARY KEY REFERENCES revisions(id),
      minutes_revision_id TEXT NOT NULL REFERENCES revisions(id)
    );
    CREATE TABLE secretary_pending_projects (
      project_id TEXT PRIMARY KEY REFERENCES projects(id),
      created_at TEXT NOT NULL
    );
  `);
}
