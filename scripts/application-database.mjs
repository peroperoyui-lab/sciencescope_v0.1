import path from "node:path";
import { mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;
const ID = /^[A-Za-z0-9_-]{1,160}$/u;
const json = (value) => JSON.stringify(value ?? {});
function validId(value, name = "id") {
  if (typeof value !== "string" || !ID.test(value))
    throw new TypeError(`Invalid ${name}`);
  return value;
}

const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL, updated TEXT NOT NULL, model_json TEXT, message_count INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 0, deleted_at TEXT, runtime_session_id TEXT, runtime_workspace TEXT);
CREATE INDEX IF NOT EXISTS chats_project_updated ON chats(project_id, updated DESC);
CREATE TABLE IF NOT EXISTS messages(chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(chat_id, ordinal), UNIQUE(chat_id, id));
CREATE INDEX IF NOT EXISTS messages_chat_ordinal ON messages(chat_id, ordinal);
CREATE TABLE IF NOT EXISTS runtime_bindings(chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE, session_id TEXT NOT NULL, runtime_workspace TEXT);
CREATE TABLE IF NOT EXISTS profile(id INTEGER PRIMARY KEY CHECK(id=1), display_name TEXT NOT NULL, bio TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL, kind TEXT NOT NULL, path TEXT, metadata_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge(id TEXT PRIMARY KEY, namespace TEXT NOT NULL CHECK(namespace IN ('canonical','heuristic','private')), project_id TEXT, title TEXT NOT NULL, content TEXT NOT NULL, source_ids_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('candidate','accepted')), created_at TEXT NOT NULL);
`;

export function openApplicationDatabaseSync({ stateDir }) {
  if (!stateDir) throw new TypeError("stateDir is required");
  const dbPath = path.join(stateDir, "sciencescope.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    db.exec(schema);
    migrateLegacy(db, stateDir);
  } catch(error) {
    try { db.close(); } catch {}
    throw error;
  }
  let closed = false;
  return {
    db,
    dbPath,
    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
    listResources(opts = {}) {
      const { projectId, query, limit = 60 } = opts;
      const clauses = [];
      const params = {};
      if (projectId !== undefined) {
        clauses.push("project_id IS :projectId");
        params.projectId = projectId;
      }
      if (query) {
        clauses.push(
          "(title LIKE :query OR kind LIKE :query OR path LIKE :query)",
        );
        params.query = `%${query}%`;
      }
      params.limit = Math.max(1, Math.min(200, Number(limit) || 60));
      const rows = db
        .prepare(
          `SELECT * FROM resources ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY id LIMIT :limit`,
        )
        .all(params);
      return rows.map(resourceRow);
    },
    addResource({
      id,
      projectId = null,
      title,
      kind,
      path: resourcePath = null,
      metadata = {},
    }) {
      validId(id);
      if (projectId !== null) validId(projectId, "projectId");
      if (!title || !kind) throw new TypeError("title and kind are required");
      db.prepare(
        "INSERT INTO resources(id,project_id,title,kind,path,metadata_json) VALUES(?,?,?,?,?,?)",
      ).run(
        id,
        projectId,
        String(title),
        String(kind),
        resourcePath === null ? null : String(resourcePath),
        json(metadata),
      );
      return this.getResource(id);
    },
    getResource(id) {
      validId(id);
      const row = db.prepare("SELECT * FROM resources WHERE id=?").get(id);
      return row ? resourceRow(row) : null;
    },
    proposeKnowledge({
      id,
      namespace = "canonical",
      projectId = null,
      title,
      content,
      sourceIds = [],
    }) {
      validId(id);
      if (!["canonical", "heuristic", "private"].includes(namespace))
        throw new TypeError("Invalid namespace");
      if (projectId !== null) validId(projectId, "projectId");
      if (!Array.isArray(sourceIds))
        throw new TypeError("sourceIds must be an array");
      if(typeof title!=='string'||!title.trim()||typeof content!=='string'||!content.trim())throw new TypeError('KNOWLEDGE_CONTENT_REQUIRED');
      if(namespace!=='private'&&!sourceIds.length)throw new TypeError('KNOWLEDGE_SOURCE_REQUIRED');
      for (const sourceId of sourceIds) {
        validId(sourceId, "sourceId");
        if (!db.prepare("SELECT 1 FROM resources WHERE id=?").get(sourceId))
          throw new Error("RESOURCE_NOT_FOUND");
      }
      db.prepare(
        "INSERT INTO knowledge(id,namespace,project_id,title,content,source_ids_json,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        id,
        namespace,
        projectId,
        String(title || ""),
        String(content || ""),
        JSON.stringify(sourceIds),
        "candidate",
        new Date().toISOString(),
      );
      return this.getKnowledge(id);
    },
    getKnowledge(id) {
      validId(id);
      const row = db.prepare("SELECT * FROM knowledge WHERE id=?").get(id);
      return row ? knowledgeRow(row) : null;
    },
    listKnowledge({ namespace, projectId, query, limit = 60 } = {}) {
      const clauses = [];
      const p = {};
      if (namespace) {
        if (!["canonical", "heuristic", "private"].includes(namespace))
          throw new TypeError("Invalid namespace");
        clauses.push("namespace=:namespace");
        p.namespace = namespace;
      } else clauses.push("namespace <> 'private'");
      if (projectId !== undefined) {
        clauses.push("project_id IS :projectId");
        p.projectId = projectId;
      }
      if (query) {
        clauses.push("(title LIKE :query OR content LIKE :query)");
        p.query = `%${query}%`;
      }
      p.limit = Math.max(1, Math.min(200, Number(limit) || 60));
      return db
        .prepare(
          `SELECT * FROM knowledge WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT :limit`,
        )
        .all(p)
        .map(knowledgeRow);
    },
    acceptKnowledge(id) {
      validId(id);
      const result = db
        .prepare(
          "UPDATE knowledge SET status='accepted' WHERE id=? AND status='candidate'",
        )
        .run(id);
      if (!result.changes)
        throw new Error("KNOWLEDGE_NOT_FOUND_OR_ALREADY_ACCEPTED");
      return this.getKnowledge(id);
    },
  };
}
export async function openApplicationDatabase({ stateDir }) {
  await mkdir(stateDir, { recursive: true });
  return openApplicationDatabaseSync({ stateDir });
}

function resourceRow(r) {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    kind: r.kind,
    path: r.path,
    metadata: JSON.parse(r.metadata_json || "{}"),
  };
}
function knowledgeRow(r) {
  return {
    id: r.id,
    namespace: r.namespace,
    projectId: r.project_id,
    title: r.title,
    content: r.content,
    sourceIds: JSON.parse(r.source_ids_json || "[]"),
    status: r.status,
    createdAt: r.created_at,
  };
}
function migrateLegacy(db, stateDir) {
  if (
    db
      .prepare("SELECT 1 FROM schema_migrations WHERE version=?")
      .get(SCHEMA_VERSION)
  )
    return;
  db.exec("BEGIN");
  try {
    const chats = optionalSync(path.join(stateDir, "chats.json"), {
      chats: {},
    });
    const workspace = optionalSync(path.join(stateDir, "workspace.json"), {});
    const profile = optionalSync(path.join(stateDir, "profile.json"), null);
    if (workspace && Array.isArray(workspace.projects))
      for (const p of workspace.projects)
        if (p?.id && ID.test(p.id))
          db.prepare("INSERT OR IGNORE INTO projects VALUES(?,?,?,?)").run(
            p.id,
            String(p.name || ""),
            String(p.desc || ""),
            p.archived ? 1 : 0,
          );
    if (workspace && Object.keys(workspace).length)
      db.prepare("INSERT OR REPLACE INTO workspaces VALUES(?,?)").run(
        "default",
        json(workspace),
      );
    for (const c of Object.values(chats?.chats || {})) {
      if (!c?.id || !ID.test(c.id)) continue;
      db.prepare(
        "INSERT OR IGNORE INTO chats VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        c.id,
        c.projectId ?? null,
        String(c.title || ""),
        c.updated || new Date().toISOString(),
        c.model ? json(c.model) : null,
        Number(c.messageCount) || 0,
        c.archived ? 1 : 0,
        c.unread ? 1 : 0,
        c.deletedAt ?? null,
        c.runtimeSessionId ?? null,
        c.runtimeWorkspace ?? null,
      );
      if (c.runtimeSessionId)
        db.prepare("INSERT OR IGNORE INTO runtime_bindings VALUES(?,?,?)").run(
          c.id,
          c.runtimeSessionId,
          c.runtimeWorkspace ?? null,
        );
      const dir = path.join(stateDir, "chat-pages", c.id);
      const fs = process.getBuiltinModule("node:fs");
      if (fs.existsSync(dir)) {
        for (const name of fs
          .readdirSync(dir)
          .filter((n) => n.endsWith(".json"))
          .sort()) {
          const page = JSON.parse(
            fs.readFileSync(path.join(dir, name), "utf8"),
          );
          const base = Number.parseInt(name, 10) * 50;
          for (let i = 0; i < page.length; i++) {
            const m = page[i];
            db.prepare(
              "INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?,?)",
            ).run(c.id, base + i, m.id, m.role, m.text, m.created);
          }
        }
      }
      const imported=db.prepare('SELECT COUNT(*) AS count,MAX(ordinal) AS last FROM messages WHERE chat_id=?').get(c.id);
      if(imported.count!==Number(c.messageCount||0)||(imported.count&&imported.last!==imported.count-1))throw new Error('LEGACY_CHAT_INCOMPLETE');
    }
    if (profile?.displayName && typeof profile.bio === "string")
      db.prepare("INSERT OR IGNORE INTO profile VALUES(1,?,?)").run(
        profile.displayName,
        profile.bio,
      );
    db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
      SCHEMA_VERSION,
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function optionalSync(file, fallback) {
  try {
    return JSON.parse(requireRead(file));
  } catch (e) {
    if (e?.code === "ENOENT") return fallback;
    throw e;
  }
}
// Database migration is synchronous by design; avoid importing a second sqlite implementation.
function requireRead(file) {
  const fs = process.getBuiltinModule("node:fs");
  return fs.readFileSync(file, "utf8");
}
