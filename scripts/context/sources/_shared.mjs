import { createHash } from 'node:crypto';
import { ContextAccessError } from '../policy.mjs';

export const READ_LIMIT = 40;
export const READ_CHARS = 60000;
export const MAX_OVERVIEW_PROJECTS = 20;
export const MAX_OVERVIEW_CHATS = 3;

export function sqlDb(input) {
  const db = input?.db ?? input;
  if (!db || typeof db.prepare !== 'function') throw new TypeError('A SQLite database handle is required.');
  return db;
}

export function databaseOf({ db, chatStore } = {}) {
  return sqlDb(db ?? chatStore?.db?.db ?? chatStore?.db);
}

export function stableHash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function ensureMainChat(db, chatId, { required = true } = {}) {
  if (!chatId) {
    if (required) throw new ContextAccessError('CHAT_REQUIRED', 'A Main conversation is required for this lookup.');
    return null;
  }
  const assistantTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='assistant_conversations'").get());
  const chatColumns = new Set(db.prepare('PRAGMA table_info(chats)').all().map((column) => column.name));
  const temporaryColumn = ['temporary', 'is_temporary', 'temporary_flag'].find((name) => chatColumns.has(name));
  const row = db.prepare(`SELECT c.id,c.project_id,c.title,c.updated,c.message_count,c.deleted_at
    FROM chats c
    WHERE c.id=? AND c.deleted_at IS NULL
      ${temporaryColumn ? `AND COALESCE(c."${temporaryColumn}",0)=0` : ''}
      ${assistantTable ? "AND NOT EXISTS (SELECT 1 FROM assistant_conversations a WHERE a.chat_id=c.id)" : ''}`).get(chatId);
  if (!row && required) throw new ContextAccessError('CHAT_NOT_FOUND', 'The requested conversation is not an available Main conversation.', 404);
  return row ?? null;
}

export function projectRow(db, projectId) {
  if (!projectId) return null;
  const row = db.prepare('SELECT id,name,description,archived FROM projects WHERE id=?').get(projectId);
  if (!row) throw new ContextAccessError('PROJECT_NOT_FOUND', 'The requested project is not available.', 404);
  return { id: row.id, name: row.name, description: row.description, archived: Boolean(row.archived) };
}

export function checkScopeTarget(db, role, ctx, args = {}) {
  const chatId = role === 'global' ? (args.chatId ?? null) : (ctx?.mainChatId ?? null);
  const chat = ensureMainChat(db, chatId, { required: role !== 'global' || Boolean(chatId) });
  const projectId = role === 'global' ? (args.projectId ?? chat?.project_id ?? null) : (ctx?.projectId ?? chat?.project_id ?? null);
  if (chat && args.projectId !== undefined && chat.project_id !== args.projectId) {
    throw new ContextAccessError('TARGET_MISMATCH', 'The selected conversation does not belong to the selected project.');
  }
  if (role !== 'global' && chat && ctx?.projectId !== undefined && ctx.projectId !== chat.project_id) {
    throw new ContextAccessError('SCOPE_MISMATCH', 'This conversation is outside the session project.');
  }
  const project = projectId ? projectRow(db, projectId) : null;
  return { chat, chatId: chat?.id ?? null, project, projectId: project?.id ?? null };
}

export function workbenchFacade({ db, workbench }) {
  if (!workbench || typeof workbench.get !== 'function') throw new TypeError('workbench is required.');
  const database = sqlDb(db);
  return {
    async get(projectId) {
      const project = projectRow(database, projectId);
      const value = await workbench.get(projectId, project?.name);
      const snapshot = value?.snapshot ?? value ?? {};
      let folder = value?.folder ?? value?.projectFolder ?? null;
      if (!folder && typeof workbench._folder === 'function') folder = await workbench._folder(projectId);
      return { ...snapshot, snapshot, projectName: project?.name ?? value?.projectName ?? null, folder };
    },
    async plans() {
      if (typeof workbench.plans === 'function') return workbench.plans();
      if (typeof workbench.getPlans === 'function') return workbench.getPlans();
      return [];
    },
  };
}

export function scopeProjectId(target) { return target.projectId ?? target.chat?.project_id ?? null; }

export function publicChatRow(row) {
  return row && { id: row.id, projectId: row.project_id, title: row.title, updated: row.updated, messageCount: row.message_count };
}
