export const version = 22;
export const name = 'knowledge-base';

/**
 * Catalog facts and their history survive rebuilding any search projection.
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`CREATE TABLE kb_entities (
  id TEXT PRIMARY KEY,                -- ent_<uuid>
  kind TEXT NOT NULL,                 -- method / variant / dataset / variable / metric / software / concept / person / org，可自定义
  name TEXT NOT NULL, name_en TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  attrs_json TEXT NOT NULL DEFAULT '{}',
  layer TEXT NOT NULL,                -- extracted / curated
  origin TEXT NOT NULL,               -- user / ai
  created_by TEXT NOT NULL, meeting_id TEXT, turn_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'shared',
  status TEXT NOT NULL DEFAULT 'active',  -- active / merged / removed
  merged_into TEXT REFERENCES kb_entities(id),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX kb_entities_name ON kb_entities(name COLLATE NOCASE, status);
CREATE INDEX kb_entities_kind ON kb_entities(kind, status);

CREATE TABLE kb_edges (
  id TEXT PRIMARY KEY,                -- edg_<uuid>
  from_ref TEXT NOT NULL, to_ref TEXT NOT NULL,
  relation TEXT NOT NULL,
  attrs_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  layer TEXT NOT NULL,                -- derived / extracted / curated
  origin TEXT NOT NULL,               -- user / ai / system
  method TEXT,                        -- citation / similar / folder / card / topic
  produced_from TEXT,                 -- extracted 边来自哪份资料，重新整理时按它替换
  weight REAL,                        -- 相似度或模型置信度；curated 为空
  created_by TEXT NOT NULL, meeting_id TEXT, turn_id TEXT,
  valid_from TEXT, valid_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX kb_edges_from ON kb_edges(from_ref, status, relation);
CREATE INDEX kb_edges_to ON kb_edges(to_ref, status, relation);
CREATE INDEX kb_edges_produced ON kb_edges(produced_from, layer);
CREATE UNIQUE INDEX kb_edges_derived ON kb_edges(from_ref, to_ref, relation) WHERE layer = 'derived';

CREATE TABLE kb_labels (
  ref TEXT NOT NULL, label TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (ref, label)
);
CREATE INDEX kb_labels_label ON kb_labels(label);

CREATE TABLE kb_memberships (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ref TEXT NOT NULL, added_by TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, ref)
);
CREATE INDEX kb_memberships_ref ON kb_memberships(ref);

CREATE TABLE kb_versions (            -- 一组修改 = 一个历史版本
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,               -- ai-turn-end / leave-page / build / before-restore
  project_id TEXT, actor_id TEXT, meeting_id TEXT, turn_id TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',  -- 新增、修改、删除各几项
  description TEXT NOT NULL DEFAULT '',
  restored_by TEXT,                   -- 被撤回时指向撤回产生的版本
  created_at TEXT NOT NULL, closed_at TEXT
);
CREATE INDEX kb_versions_project ON kb_versions(project_id, created_at);
CREATE UNIQUE INDEX kb_versions_turn ON kb_versions(turn_id) WHERE turn_id IS NOT NULL;

CREATE TABLE kb_revisions (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES kb_versions(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,                  -- entity:… / edge:… / label:<ref>#<label> / membership:<project>#<ref>
  op TEXT NOT NULL,                   -- create / update / remove / merge
  before_json TEXT, after_json TEXT,
  actor_id TEXT, origin TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX kb_revisions_ref ON kb_revisions(ref, created_at);
CREATE INDEX kb_revisions_version ON kb_revisions(version_id);

CREATE TABLE kb_jobs (                -- 每份资料每层一行，界面状态从这里汇总
  source_id TEXT NOT NULL REFERENCES rb_sources(id) ON DELETE CASCADE,
  layer TEXT NOT NULL,                -- derived / card / topic
  topic TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,                -- queued / running / done / failed / skipped
  content_version TEXT,               -- 做这一步时段落的哈希，变了就重做
  error TEXT, attempts INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
  PRIMARY KEY (source_id, layer, topic)
);

ALTER TABLE rb_sources ADD COLUMN folder_path TEXT;
CREATE UNIQUE INDEX rb_sources_folder ON rb_sources(project_id, folder_path) WHERE folder_path IS NOT NULL;
`);
}
