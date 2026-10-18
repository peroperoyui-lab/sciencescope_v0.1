// Core tables for the five primitives. See docs/architecture/CORE_MODEL.md §2.

export const version = 1;
export const name = 'core';

/** @param {{ exec: (sql: string) => void }} db */
export function up(db) {
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      dir_name TEXT NOT NULL UNIQUE,
      folder TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE participants (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('human', 'ai')),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      title TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      parent_meeting_id TEXT REFERENCES meetings(id),
      fork_message_id TEXT,
      attached_to_meeting_id TEXT REFERENCES meetings(id),
      work_folder TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      temporary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX meetings_by_project ON meetings(project_id, updated_at);

    CREATE TABLE meeting_members (
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      participant_id TEXT NOT NULL REFERENCES participants(id),
      role_note TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL,
      PRIMARY KEY (meeting_id, participant_id)
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      seq INTEGER NOT NULL,
      author_id TEXT NOT NULL REFERENCES participants(id),
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'done'
        CHECK (status IN ('streaming', 'done', 'max_tokens', 'failed', 'cancelled')),
      turn_id TEXT,
      reply_to TEXT,
      refs_json TEXT NOT NULL DEFAULT '{}',
      adopted INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (meeting_id, seq)
    );

    CREATE TABLE turns (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      participant_id TEXT NOT NULL REFERENCES participants(id),
      trigger_message_id TEXT,
      status TEXT NOT NULL,
      stop_reason TEXT,
      usage_json TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );

    CREATE TABLE tool_calls (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES turns(id),
      seq INTEGER NOT NULL,
      name TEXT NOT NULL,
      args_json TEXT NOT NULL,
      result_json TEXT,
      status TEXT NOT NULL,
      presented INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT
    );

    CREATE TABLE runtime_sessions (
      meeting_id TEXT NOT NULL REFERENCES meetings(id),
      participant_id TEXT NOT NULL REFERENCES participants(id),
      runtime TEXT NOT NULL,
      session_id TEXT NOT NULL,
      last_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (meeting_id, participant_id)
    );

    CREATE TABLE revisions (
      id TEXT PRIMARY KEY,
      resource TEXT NOT NULL,
      resource_key TEXT NOT NULL,
      op TEXT NOT NULL,
      before_text TEXT,
      after_text TEXT,
      after_hash TEXT,
      actor_id TEXT,
      meeting_id TEXT,
      turn_id TEXT,
      undone_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX revisions_by_key ON revisions(resource_key, created_at);

    CREATE TABLE events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      project_id TEXT,
      meeting_id TEXT,
      actor_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}
