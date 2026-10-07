export const version = 6;
export const name = 'secretary-chats';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE secretary_chats (
      main_meeting_id TEXT PRIMARY KEY REFERENCES meetings(id),
      meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id)
    );
    CREATE TABLE secretary_cursors (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id),
      main_meeting_id TEXT NOT NULL REFERENCES meetings(id),
      through_seq INTEGER NOT NULL DEFAULT 0,
      minutes_revision_id TEXT REFERENCES revisions(id),
      consumed_message_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE main_draft_proposals (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      main_meeting_id TEXT NOT NULL REFERENCES meetings(id),
      text TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'filled', 'dismissed')),
      actor_id TEXT NOT NULL REFERENCES participants(id),
      turn_id TEXT REFERENCES turns(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX main_draft_proposals_main ON main_draft_proposals(main_meeting_id, created_at);
    CREATE TABLE main_draft_proposal_history (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES main_draft_proposals(id),
      before_json TEXT,
      after_json TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES participants(id),
      undone_by TEXT REFERENCES main_draft_proposal_history(id),
      created_at TEXT NOT NULL
    );
  `);
}
