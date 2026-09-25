// Research Base schema (see docs/design/RESEARCH_BASE.md). One store for
// everything the research workstation may cite, recall or build on:
//   rb_sources   citable things (papers, books, web pages, datasets, files)
//   rb_chunks    parsed passages of a source, with page/section/anchor
//   rb_items     distilled records: knowledge, model (theory/formula/algorithm),
//                memory, claim, note — typed payload in body_json
//   rb_links     typed relations between any two records (evidence, citation…)
//   rb_proposals the write path for agents: pending changes the user decides
//   rb_revisions audit trail of item edits
//   rb_usage     which records were shown to / retrieved by a model turn
//   rb_fts       FTS5 index (CJK bigram text, see text-index.mjs)
// The application `resources` table stays the file registry; a source points
// at its original through resource_id.
export const RB_SCHEMA_VERSION = 1;

export const SOURCE_KINDS = ['paper', 'preprint', 'book', 'chapter', 'thesis', 'report', 'webpage', 'dataset', 'software', 'file', 'note'];
export const CONTENT_STATUS = ['none', 'queued', 'parsed', 'partial', 'failed', 'unsupported'];
export const CHUNK_KINDS = ['paragraph', 'heading', 'caption', 'table', 'equation', 'code', 'list', 'reference', 'abstract'];
export const ITEM_TYPES = ['knowledge', 'model', 'memory', 'claim', 'note'];
export const ITEM_SUBTYPES = {
  knowledge: ['finding', 'definition', 'method', 'fact', 'dataset-note', 'other'],
  model: ['theory', 'formula', 'algorithm', 'statistical-model', 'protocol'],
  memory: ['preference', 'goal', 'decision', 'convention', 'open-question', 'lesson', 'episode', 'profile'],
  claim: ['hypothesis', 'claim', 'conclusion'],
  note: ['note', 'mark', 'summary'],
};
export const ITEM_STATUS = ['proposed', 'active', 'superseded', 'archived', 'rejected'];
export const CLAIM_STATUS = ['hypothesis', 'supported', 'contested', 'refuted', 'uncertain', 'retracted'];
export const VISIBILITY = ['shared', 'private'];
export const LINK_RELATIONS = ['cites', 'supports', 'contradicts', 'qualifies', 'derived-from', 'defines', 'uses', 'about', 'supersedes', 'mentions', 'same-as', 'part-of'];
export const REF_TYPES = ['source', 'chunk', 'item', 'message', 'chat', 'resource'];
export const PROPOSAL_OPS = ['create', 'update', 'supersede', 'archive', 'link'];

export function applyResearchBaseSchema(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS rb_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rb_sources(
  id TEXT PRIMARY KEY, project_id TEXT, number INTEGER NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, authors_json TEXT NOT NULL DEFAULT '[]', year INTEGER, venue TEXT,
  doi TEXT, arxiv_id TEXT, pmid TEXT, isbn TEXT, url TEXT, abstract TEXT, language TEXT,
  citekey TEXT, csl_json TEXT, resource_id TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
  read_status TEXT NOT NULL DEFAULT 'unread', rating INTEGER,
  content_status TEXT NOT NULL DEFAULT 'none', parser TEXT, parse_error TEXT, pages INTEGER,
  added_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS rb_sources_number ON rb_sources(ifnull(project_id,''), number);
CREATE INDEX IF NOT EXISTS rb_sources_project ON rb_sources(project_id, added_at DESC);
CREATE INDEX IF NOT EXISTS rb_sources_resource ON rb_sources(resource_id);
CREATE INDEX IF NOT EXISTS rb_sources_doi ON rb_sources(doi);
CREATE TABLE IF NOT EXISTS rb_chunks(
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES rb_sources(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, page INTEGER, section TEXT, kind TEXT NOT NULL, text TEXT NOT NULL,
  char_start INTEGER, char_end INTEGER, anchor_json TEXT, UNIQUE(source_id, ordinal));
CREATE TABLE IF NOT EXISTS rb_items(
  id TEXT PRIMARY KEY, type TEXT NOT NULL, subtype TEXT NOT NULL, project_id TEXT, scope TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', body_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'shared', pinned INTEGER NOT NULL DEFAULT 0,
  confidence REAL, importance INTEGER NOT NULL DEFAULT 3,
  valid_from TEXT, valid_to TEXT, superseded_by TEXT, revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, origin_json TEXT NOT NULL DEFAULT '{}', legacy_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT, use_count INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS rb_items_project ON rb_items(project_id, type, status);
CREATE UNIQUE INDEX IF NOT EXISTS rb_items_legacy ON rb_items(legacy_id) WHERE legacy_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS rb_revisions(item_id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL, PRIMARY KEY(item_id, revision));
CREATE TABLE IF NOT EXISTS rb_links(
  id TEXT PRIMARY KEY, from_type TEXT NOT NULL, from_id TEXT NOT NULL, to_type TEXT NOT NULL, to_id TEXT NOT NULL,
  relation TEXT NOT NULL, note TEXT, quote TEXT, locator_json TEXT, strength REAL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(from_type, from_id, to_type, to_id, relation));
CREATE INDEX IF NOT EXISTS rb_links_to ON rb_links(to_type, to_id);
CREATE TABLE IF NOT EXISTS rb_proposals(
  id TEXT PRIMARY KEY, project_id TEXT, op TEXT NOT NULL, target_id TEXT, payload_json TEXT NOT NULL,
  rationale TEXT, origin_json TEXT NOT NULL DEFAULT '{}', dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', result_id TEXT, created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT);
CREATE INDEX IF NOT EXISTS rb_proposals_status ON rb_proposals(status, project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS rb_proposals_pending ON rb_proposals(dedupe_key) WHERE status='pending';
CREATE TABLE IF NOT EXISTS rb_usage(chat_id TEXT NOT NULL, message_id TEXT NOT NULL, ref_type TEXT NOT NULL, ref_id TEXT NOT NULL, how TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(chat_id, message_id, ref_type, ref_id, how));
CREATE VIRTUAL TABLE IF NOT EXISTS rb_fts USING fts5(doc_type UNINDEXED, doc_id UNINDEXED, project_id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2');
`);
  db.prepare("INSERT OR IGNORE INTO rb_meta VALUES('schema_version', ?)").run(String(RB_SCHEMA_VERSION));
}
