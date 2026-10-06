// Sources and item revisions are durable; parsed passages and FTS can be rebuilt.
export const version = 3;
export const name = 'research-base';

/** @param {{ exec: (sql: string) => void }} db */
export function up(db) {
  db.exec(`
    CREATE TABLE rb_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      number INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      original_path TEXT,
      name TEXT,
      mime TEXT,
      content_status TEXT NOT NULL DEFAULT 'none',
      parser TEXT,
      parse_error TEXT,
      pages INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX rb_sources_number ON rb_sources(ifnull(project_id, ''), number);
    CREATE INDEX rb_sources_project ON rb_sources(project_id, created_at);

    CREATE TABLE rb_chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES rb_sources(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      page INTEGER,
      section TEXT,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      char_start INTEGER,
      char_end INTEGER,
      anchor_json TEXT,
      UNIQUE (source_id, ordinal)
    );

    CREATE TABLE rb_items (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      type TEXT NOT NULL,
      subtype TEXT NOT NULL,
      scope TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      visibility TEXT NOT NULL DEFAULT 'shared',
      revision INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      origin_json TEXT NOT NULL DEFAULT '{}',
      valid_from TEXT,
      valid_to TEXT,
      superseded_by TEXT REFERENCES rb_items(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX rb_items_project ON rb_items(project_id, type, status);

    CREATE TABLE rb_revisions (
      item_id TEXT NOT NULL REFERENCES rb_items(id),
      revision INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      changed_at TEXT NOT NULL,
      PRIMARY KEY (item_id, revision)
    );

    CREATE VIRTUAL TABLE rb_fts USING fts5(
      doc_type UNINDEXED, doc_id UNINDEXED, project_id UNINDEXED,
      title, body, tokenize='unicode61 remove_diacritics 2'
    );
  `);
}
