export const version = 7;
export const name = 'memory-consolidation';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`
    CREATE TABLE memory_cursors (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id),
      minutes_revision_id TEXT REFERENCES revisions(id),
      through_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE memory_checkpoints (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id),
      checkpoint_json TEXT NOT NULL
    );
    CREATE TABLE memory_runs (
      meeting_id TEXT PRIMARY KEY REFERENCES meetings(id),
      status_json TEXT NOT NULL
    );
    CREATE TABLE memory_dedup (
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      candidate_hash TEXT NOT NULL,
      item_id TEXT NOT NULL REFERENCES rb_items(id),
      PRIMARY KEY (meeting_id, candidate_hash)
    );
    CREATE TABLE memory_item_history (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES rb_items(id),
      before_json TEXT,
      after_json TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      turn_id TEXT REFERENCES turns(id),
      meeting_id TEXT REFERENCES meetings(id),
      undone_by TEXT REFERENCES memory_item_history(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX memory_history_item ON memory_item_history(item_id, created_at);
  `);
}
