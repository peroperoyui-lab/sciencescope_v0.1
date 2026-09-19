import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { openApplicationDatabaseSync } from "./application-database.mjs";
const ID = /^[A-Za-z0-9_-]{1,160}$/u;
const clone = (v) => JSON.parse(JSON.stringify(v));
function safeId(v, n = "id") {
  if (typeof v !== "string" || !ID.test(v)) throw new TypeError(`Invalid ${n}`);
  return v;
}
const DEFAULT_PROFILE = Object.freeze({ displayName: "用户", bio: "" });
function validateProfile(v) {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    typeof v.displayName !== "string" ||
    typeof v.bio !== "string"
  )
    throw new TypeError("Invalid profile");
  const displayName = v.displayName.trim();
  if (!displayName || displayName.length > 80 || v.bio.length > 2000)
    throw new TypeError("Invalid profile");
  return { displayName, bio: v.bio };
}
export class ProfileStore {
  constructor({ stateDir }) {
    if (!stateDir) throw new TypeError("stateDir is required");
    this.stateDir = stateDir;
    this.profileFile = path.join(stateDir, "profile.json");
    this.db = null;
    this.queue = Promise.resolve();
  }
  async init() {
    await mkdir(this.stateDir, { recursive: true });
    this.db = openApplicationDatabaseSync({ stateDir: this.stateDir });
    const row = this.db.db
      .prepare("SELECT display_name,bio FROM profile WHERE id=1")
      .get();
    this.profile = row
      ? { displayName: row.display_name, bio: row.bio }
      : { ...DEFAULT_PROFILE };
    return this;
  }
  getProfile() {
    return { ...this.profile };
  }
  async updateProfile(input) {
    const profile = validateProfile(input);
    const task = this.queue.then(async () => {
      this.db.db
        .prepare(
          "INSERT OR REPLACE INTO profile(id,display_name,bio) VALUES(1,?,?)",
        )
        .run(profile.displayName, profile.bio);
      this.profile = profile;
      return this.getProfile();
    });
    this.queue = task.catch(() => {});
    return task;
  }
  close() {
    this.db?.close();
  }
}
export class ChatStore {
  constructor({ stateDir }) {
    if (!stateDir) throw new TypeError("stateDir is required");
    this.stateDir = stateDir;
    this.indexFile = path.join(stateDir, "chats.json");
    this.workspaceFile = path.join(stateDir, "workspace.json");
    this.transcriptDir = path.join(stateDir, "chat-pages");
    this.queue = Promise.resolve();
    this.db = null;
  }
  async init() {
    await mkdir(this.stateDir, { recursive: true });
    this.db = openApplicationDatabaseSync({ stateDir: this.stateDir });
    this.database = this.db;
    return this;
  }
  close() {
    this.db?.close();
  }
  _meta(c) {
    const { runtime_session_id: _, runtime_workspace: __, ...r } = c;
    return {
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      updated: r.updated,
      model: r.model_json ? JSON.parse(r.model_json) : null,
      messageCount: r.message_count,
      archived: Boolean(r.archived),
      unread: Boolean(r.unread),
      ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
    };
  }
  _chat(id) {
    return this.db.db.prepare("SELECT * FROM chats WHERE id=?").get(id);
  }
  _mutate(fn) {
    const t = this.queue.then(() => {
      this.db.db.exec("BEGIN IMMEDIATE");
      try {
        const result = fn();
        this.db.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.db.exec("ROLLBACK");
        throw error;
      }
    });
    this.queue = t.catch(() => {});
    return t;
  }
  listChats(projectId) {
    if (
      projectId !== undefined &&
      projectId !== null &&
      typeof projectId !== "string"
    )
      throw new TypeError("Invalid projectId");
    const q =
      projectId === undefined
        ? "SELECT * FROM chats WHERE deleted_at IS NULL ORDER BY updated DESC"
        : "SELECT * FROM chats WHERE deleted_at IS NULL AND project_id IS ? ORDER BY updated DESC";
    return this.db.db
      .prepare(q)
      .all(...(projectId === undefined ? [] : [projectId]))
      .map((c) => this._meta(c));
  }
  getChat(id) {
    const c = this._chat(safeId(id, "chatId"));
    return c ? this._meta(c) : null;
  }
  getBinding(id) {
    return this._chat(safeId(id, "chatId"))?.runtime_session_id ?? null;
  }
  getRuntimeWorkspace(id) {
    return this._chat(safeId(id, "chatId"))?.runtime_workspace ?? null;
  }
  async ensureChat({ chatId, projectId = null, title = "", model }) {
    chatId = safeId(chatId, "chatId");
    if (projectId !== null) safeId(projectId, "projectId");
    const route = model && {
      providerId: String(model.providerId),
      modelId: String(model.modelId),
    };
    return this._mutate(() => {
      const e = this._chat(chatId);
      if (e) {
        if (e.model_json && route && e.model_json !== JSON.stringify(route))
          throw new Error("CHAT_MODEL_CHANGED");
        return this._meta(e);
      }
      const now = new Date().toISOString();
      this.db.db
        .prepare(
          "INSERT INTO chats(id,project_id,title,updated,model_json) VALUES(?,?,?,?,?)",
        )
        .run(
          chatId,
          projectId,
          String(title || "新对话").slice(0, 200),
          now,
          route ? JSON.stringify(route) : null,
        );
      return this.getChat(chatId);
    });
  }
  async markRuntimeBinding(chatId, sessionId, runtimeWorkspace = null) {
    safeId(chatId, "chatId");
    safeId(sessionId, "sessionId");
    return this._mutate(() => {
      if (!this._chat(chatId)) throw new Error("CHAT_NOT_FOUND");
      this.db.db
        .prepare(
          "UPDATE chats SET runtime_session_id=?,runtime_workspace=? WHERE id=?",
        )
        .run(
          sessionId,
          runtimeWorkspace ? String(runtimeWorkspace) : null,
          chatId,
        );
      this.db.db
        .prepare("INSERT OR REPLACE INTO runtime_bindings VALUES(?,?,?)")
        .run(chatId, sessionId, runtimeWorkspace ?? null);
      return this.getChat(chatId);
    });
  }
  async appendMessage({
    chatId,
    id = `msg-${randomUUID()}`,
    role,
    text,
    created,
  }) {
    chatId = safeId(chatId, "chatId");
    id = safeId(id, "messageId");
    if (
      !["user", "assistant", "system"].includes(role) ||
      typeof text !== "string"
    )
      throw new TypeError("Invalid message");
    return this._mutate(() => {
      const c = this._chat(chatId);
      if (!c) throw new Error("CHAT_NOT_FOUND");
      const old = this.db.db
        .prepare(
          "SELECT id,role,text,created FROM messages WHERE chat_id=? AND id=?",
        )
        .get(chatId, id);
      if (old) return old;
      const at = created || new Date().toISOString(),
        ordinal = c.message_count;
      this.db.db
        .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?)")
        .run(chatId, ordinal, id, role, text, at);
      this.db.db
        .prepare("UPDATE chats SET message_count=?,updated=? WHERE id=?")
        .run(ordinal + 1, at, chatId);
      return { id, role, text, created: at };
    });
  }
  async pageMessages(chatId, { before, after, limit = 60 } = {}) {
    chatId = safeId(chatId, "chatId");
    const c = this._chat(chatId);
    if (!c) return null;
    limit = Math.max(1, Math.min(100, Number(limit) || 60));
    const total = c.message_count;
    let start =
      before === undefined
        ? after === undefined
          ? Math.max(0, total - limit)
          : Number(after)
        : Math.max(0, Number(before) - limit);
    if (!Number.isInteger(start) || start < 0)
      throw new TypeError("Invalid cursor");
    const boundary =
        before === undefined ? total : Math.min(total, Number(before)),
      end = Math.min(boundary, start + limit);
    const messages = this.db.db
      .prepare(
        "SELECT id,role,text,created FROM messages WHERE chat_id=? AND ordinal>=? AND ordinal<? ORDER BY ordinal",
      )
      .all(chatId, start, end);
    return {
      chat: this._meta(c),
      messages,
      total,
      before: start > 0 ? String(start) : null,
      after: end < total ? String(end) : null,
      hasMoreBefore: start > 0,
      hasMoreAfter: end < total,
    };
  }
  async updateMetadata(id, patch = {}) {
    safeId(id, "chatId");
    return this._mutate(() => {
      const c = this._chat(id);
      if (!c) throw new Error("CHAT_NOT_FOUND");
      const title =
        patch.title === undefined
          ? c.title
          : String(patch.title).trim().slice(0, 200) || c.title;
      this.db.db
        .prepare(
          "UPDATE chats SET title=?,archived=?,unread=?,updated=? WHERE id=?",
        )
        .run(
          title,
          patch.archived === undefined ? c.archived : patch.archived ? 1 : 0,
          patch.unread === undefined ? c.unread : patch.unread ? 1 : 0,
          new Date().toISOString(),
          id,
        );
      return this.getChat(id);
    });
  }
  async rename(id, title) {
    return this.updateMetadata(id, { title });
  }
  async move(id, projectId, { allowBound = false } = {}) {
    safeId(id, "chatId");
    if (projectId !== null) safeId(projectId, "projectId");
    return this._mutate(() => {
      const c = this._chat(id);
      if (!c) throw new Error("CHAT_NOT_FOUND");
      if (c.runtime_session_id && !allowBound)
        throw new Error("CHAT_WORKSPACE_MOVE_UNSUPPORTED");
      this.db.db
        .prepare("UPDATE chats SET project_id=?,updated=? WHERE id=?")
        .run(projectId, new Date().toISOString(), id);
      return this.getChat(id);
    });
  }
  async remove(id) {
    safeId(id, "chatId");
    return this._mutate(() => {
      if (!this._chat(id)) throw new Error("CHAT_NOT_FOUND");
      const at = new Date().toISOString();
      this.db.db
        .prepare("UPDATE chats SET deleted_at=?,updated=? WHERE id=?")
        .run(at, at, id);
      return { deleted: true, id };
    });
  }
  async getWorkspace() {
    const r = this.db.db
      .prepare("SELECT data_json FROM workspaces WHERE id='default'")
      .get();
    return r
      ? JSON.parse(r.data_json)
      : {
          version: 1,
          projects: [],
          pins: [],
          projectExpanded: {},
          lastChatId: null,
        };
  }
  async updateWorkspace(input = {}) {
    return this._mutate(() => {
      const old = this.db.db
          .prepare("SELECT data_json FROM workspaces WHERE id=?")
          .get("default"),
        w = old
          ? JSON.parse(old.data_json)
          : {
              version: 1,
              projects: [],
              pins: [],
              projectExpanded: {},
              lastChatId: null,
            };
      const projects = Array.isArray(input.projects)
        ? input.projects.map((p) => ({
            id: safeId(p.id, "projectId"),
            name: String(p.name || "").slice(0, 200),
            desc: String(p.desc || "").slice(0, 1000),
            archived: Boolean(p.archived),
          }))
        : w.projects;
      const pins = Array.isArray(input.pins)
        ? input.pins
            .filter(
              (p) =>
                p &&
                (p.type === "chat" || p.type === "project") &&
                typeof p.id === "string" &&
                ID.test(p.id),
            )
            .map((p) => ({ type: p.type, id: p.id }))
            .slice(0, 1000)
        : w.pins;
      const projectExpanded =
        input.projectExpanded && typeof input.projectExpanded === "object"
          ? Object.fromEntries(
              Object.entries(input.projectExpanded).filter(
                ([id, v]) => ID.test(id) && typeof v === "boolean",
              ),
            )
          : w.projectExpanded;
      const next = {
        version: 1,
        projects,
        pins,
        projectExpanded,
        lastChatId:
          input.lastChatId === null
            ? null
            : input.lastChatId === undefined
              ? w.lastChatId
              : safeId(input.lastChatId, "chatId"),
      };
      this.db.db
        .prepare("INSERT OR REPLACE INTO workspaces VALUES(?,?)")
        .run("default", JSON.stringify(next));
      this.db.db.exec("DELETE FROM projects");
      for (const p of projects)
        this.db.db
          .prepare("INSERT INTO projects VALUES(?,?,?,?)")
          .run(p.id, p.name, p.desc, p.archived ? 1 : 0);
      return clone(next);
    });
  }
}
export async function createChatStore({ stateDir }) {
  return new ChatStore({ stateDir }).init();
}
