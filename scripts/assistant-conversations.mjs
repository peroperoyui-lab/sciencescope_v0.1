import { randomUUID } from "node:crypto";

const SCOPES = new Set(["global", "secretary"]);
const ID = /^[A-Za-z0-9_-]{1,160}$/u;

/** A stable, inspectable error for assistant-conversation boundary failures. */
export class AssistantConversationError extends Error {
  constructor(code, message = code, status = 400) {
    super(message);
    this.name = "AssistantConversationError";
    this.code = code;
    this.status = status;
  }
}

function checkScope(scope, ownerId) {
  if (!SCOPES.has(scope)) throw new AssistantConversationError('INVALID_SCOPE','助手作用域无效。');
  if (scope === "global" && ownerId !== "global")
    throw new AssistantConversationError('INVALID_OWNER','全局助手身份无效。');
  if (scope === "secretary" && (typeof ownerId !== "string" || !ID.test(ownerId)))
    throw new AssistantConversationError('INVALID_OWNER','请先创建任务对话。');
}

function routeOf(model) {
  if (model === undefined || model === null) return null;
  if (!model || typeof model !== "object" || Array.isArray(model))
    throw new TypeError("Invalid assistant model");
  if (typeof model.providerId !== "string" || typeof model.modelId !== "string")
    throw new TypeError("Invalid assistant model");
  return { providerId: model.providerId, modelId: model.modelId };
}

function sameRoute(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function rowValue(db, scope, ownerId) {
  return db
    .prepare(
      `SELECT a.scope,a.owner_id,a.chat_id,c.project_id,c.title,c.updated,
              c.model_json,c.message_count,c.archived,c.unread,c.deleted_at,c.runtime_session_id
         FROM assistant_conversations a JOIN chats c ON c.id=a.chat_id
        WHERE a.scope=? AND a.owner_id=?`,
    )
    .get(scope, ownerId) ?? null;
}

function publicValue(row) {
  if (!row) return null;
  const chat = {
      id: row.chat_id,
      projectId: row.project_id,
      title: row.title,
      updated: row.updated,
      model: row.model_json ? JSON.parse(row.model_json) : null,
      messageCount: row.message_count,
      archived: Boolean(row.archived),
      unread: Boolean(row.unread),
      ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  };
  // Preserve ChatStore metadata shape for callers while exposing the
  // relationship identity explicitly as well.
  return { ...chat, chatId: row.chat_id, scope: row.scope, ownerId: row.owner_id, chat };
}

export function createAssistantConversations({ chatStore }) {
  if (!chatStore?.db?.db || typeof chatStore.ensureChat !== "function")
    throw new TypeError("chatStore is required");
  const db = chatStore.db.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_conversations(
      scope TEXT NOT NULL CHECK(scope IN ('global','secretary')),
      owner_id TEXT NOT NULL,
      chat_id TEXT NOT NULL UNIQUE REFERENCES chats(id),
      PRIMARY KEY(scope, owner_id)
    );
    CREATE TABLE IF NOT EXISTS assistant_drafts(
      scope TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      text TEXT NOT NULL,
      updated TEXT NOT NULL,
      PRIMARY KEY(scope, owner_id)
    );
    CREATE TABLE IF NOT EXISTS assistant_settings(
      scope TEXT NOT NULL, owner_id TEXT NOT NULL, model_json TEXT, reasoning_effort TEXT, execution_mode TEXT,
      PRIMARY KEY(scope, owner_id)
    );
    CREATE TABLE IF NOT EXISTS assistant_draft_proposals(
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created TEXT NOT NULL
    );
  `);
  try { db.exec('ALTER TABLE assistant_settings ADD COLUMN execution_mode TEXT'); } catch {}

  // ChatStore serializes its own writes; this queue also keeps relationship
  // creation atomic from this service's perspective (and makes same-process
  // concurrent ensure calls converge on one relationship).
  let queue = Promise.resolve();
  const serial = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };

  function ownerChat(scope, ownerId) {
    if (scope === "global") return null;
    const owner = chatStore.getChat(ownerId);
    if (!owner || owner.deletedAt)
      throw new AssistantConversationError("ASSISTANT_OWNER_NOT_FOUND", "请先在主工作区发送首条消息，再使用任务秘书。", 404);
    if (db.prepare("SELECT 1 FROM assistant_conversations WHERE chat_id=?").get(ownerId))
      throw new AssistantConversationError("ASSISTANT_OWNER_ASSISTANT", "Assistant conversations cannot own secretary chats", 409);
    return owner;
  }

  async function ensure(scope, ownerId, model) {
    checkScope(scope, ownerId);
    const route = routeOf(model);
    return serial(async () => {
      const owner = ownerChat(scope, ownerId);
      const existing = rowValue(db, scope, ownerId);
      if (existing) {
        const existingModel = existing.model_json ? JSON.parse(existing.model_json) : null;
        if (route && !sameRoute(existingModel, route)) {
          if (existing.message_count > 0 || existing.runtime_session_id) {
            throw new AssistantConversationError(
              "ASSISTANT_MODEL_CHANGE_FORBIDDEN",
              "当前助手已绑定模型；暂不支持在此会话中更换模型。",
              409,
            );
          }
          // Empty, unbound conversations may be explicitly retargeted.
          db.prepare("UPDATE chats SET model_json=? WHERE id=?").run(JSON.stringify(route), existing.chat_id);
        }
        return publicValue(rowValue(db, scope, ownerId));
      }

      const chatId = `aux-${randomUUID()}`;
      await chatStore._mutate(()=>{
        db.prepare('INSERT INTO chats(id,project_id,title,updated,model_json) VALUES(?,?,?,?,?)')
          .run(chatId,owner?.projectId??null,scope==='global'?'全局助手':'会议秘书',new Date().toISOString(),route?JSON.stringify(route):null);
        db.prepare("INSERT INTO assistant_conversations(scope,owner_id,chat_id) VALUES(?,?,?)")
          .run(scope, ownerId, chatId);
      });
      return publicValue(rowValue(db, scope, ownerId));
    });
  }

  return {
    get(scope, ownerId) {
      checkScope(scope, ownerId);
      ownerChat(scope, ownerId);
      return publicValue(rowValue(db, scope, ownerId));
    },
    ensure,
    setModel(scope, ownerId, model, reasoningEffort, executionMode) {
      checkScope(scope, ownerId); routeOf(model); ownerChat(scope, ownerId);
      db.prepare(`INSERT INTO assistant_settings(scope,owner_id,model_json,reasoning_effort,execution_mode) VALUES(?,?,?,?,?)
        ON CONFLICT(scope,owner_id) DO UPDATE SET model_json=excluded.model_json,reasoning_effort=excluded.reasoning_effort,execution_mode=COALESCE(excluded.execution_mode,assistant_settings.execution_mode)`)
        .run(scope,ownerId,JSON.stringify(routeOf(model)),reasoningEffort ?? null,executionMode ?? null);
      const chat=this.get(scope,ownerId); if(chat) db.prepare('UPDATE chats SET model_json=? WHERE id=?').run(JSON.stringify(routeOf(model)),chat.chatId);
      return this.getSettings(scope,ownerId);
    },
    getSettings(scope, ownerId) {
      checkScope(scope, ownerId); ownerChat(scope, ownerId);
      const row=db.prepare('SELECT model_json,reasoning_effort,execution_mode FROM assistant_settings WHERE scope=? AND owner_id=?').get(scope,ownerId);
      const chat=rowValue(db,scope,ownerId);
      return {model:row?.model_json?JSON.parse(row.model_json):(chat?.model_json?JSON.parse(chat.model_json):null),reasoningEffort:row?.reasoning_effort??null,executionMode:row?.execution_mode??'ask'};
    },
    saveProposal(id,ownerId,text){if(typeof text!=='string'||!text.trim()||text.length>64000)throw new TypeError('Invalid proposal');db.prepare('INSERT INTO assistant_draft_proposals(id,owner_id,text,status,created) VALUES(?,?,?,\'pending\',?)').run(id,ownerId,text,new Date().toISOString());return {id,ownerId,text,status:'pending'};},
    listProposals(ownerId){return db.prepare('SELECT id,owner_id AS ownerId,text,status,created FROM assistant_draft_proposals WHERE owner_id=? ORDER BY created').all(ownerId);},
    resolveProposal(ownerId,id){const result=db.prepare("UPDATE assistant_draft_proposals SET status='handled' WHERE id=? AND owner_id=? AND status='pending'").run(id,ownerId);if(!result.changes)throw new AssistantConversationError('PROPOSAL_NOT_FOUND','提案不存在或已处理。',404);return this.listProposals(ownerId).find(p=>p.id===id);},
    isAssistant(chatId) {
      if (typeof chatId !== "string" || !ID.test(chatId)) return false;
      return Boolean(db.prepare("SELECT 1 FROM assistant_conversations WHERE chat_id=?").get(chatId));
    },
    listPrivateChatIds() {
      return db.prepare("SELECT chat_id FROM assistant_conversations ORDER BY chat_id").all().map((r) => r.chat_id);
    },
    saveDraft(scope, ownerId, text) {
      checkScope(scope, ownerId);
      if (typeof text !== "string"||text.length>64000) throw new AssistantConversationError('INVALID_DRAFT','助手草稿过长或格式无效。');
      return serial(() => {
        ownerChat(scope,ownerId);
        db.prepare(`INSERT INTO assistant_drafts(scope,owner_id,text,updated) VALUES(?,?,?,?)
          ON CONFLICT(scope,owner_id) DO UPDATE SET text=excluded.text,updated=excluded.updated`)
          .run(scope, ownerId, text, new Date().toISOString());
        return text;
      });
    },
    getDraft(scope, ownerId) {
      checkScope(scope, ownerId);
      return db.prepare("SELECT text FROM assistant_drafts WHERE scope=? AND owner_id=?").get(scope, ownerId)?.text ?? "";
    },
  };
}
