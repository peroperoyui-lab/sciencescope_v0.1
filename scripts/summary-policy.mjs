import { estimateTokens } from './context/estimate.mjs';
import { DEFAULT_SUMMARY, getDefaultSummary } from './secretary-preferences.mjs';

function summaryOf(preferences) {
  const base = getDefaultSummary();
  const incoming = preferences?.summary ?? preferences ?? {};
  return {
    ...base,
    ...incoming,
    everyMessages: { ...base.everyMessages, ...(incoming.everyMessages || {}) },
    everyTokens: { ...base.everyTokens, ...(incoming.everyTokens || {}) },
    workbench: { ...base.workbench, ...(incoming.workbench || {}) },
  };
}

function dbHandle(db) { return db?.db && typeof db.prepare !== 'function' ? db.db : db; }

export function createSummaryPolicy({ db, events, minutes, chatStore, getPreferences, onDiagnostic = () => {}, onError = () => {}, pendingDelayMs = 30000 } = {}) {
  if (!events?.on || !minutes || !chatStore) throw new TypeError('events, minutes and chatStore are required');
  const database = dbHandle(db);
  database?.exec?.(`CREATE TABLE IF NOT EXISTS summary_pending(
    project_id TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
  const off = [];
  const queued = new Map();
  let pendingTimer = null;
  let closed = false;
  let focusedProject = null;

  const hasTable = (name) => Boolean(database?.prepare?.("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const mainChat = (chatId) => {
    if (!database?.prepare) return true;
    const columns = new Set(database.prepare('PRAGMA table_info(chats)').all().map((column) => column.name));
    const temporary = ['temporary', 'is_temporary', 'temporary_flag'].find((name) => columns.has(name));
    const row = database.prepare(`SELECT id,project_id,deleted_at${temporary ? `,"${temporary}" AS temporary` : ''} FROM chats WHERE id=?`).get(chatId);
    if (!row || row.deleted_at || row.temporary) return false;
    if (hasTable('assistant_conversations') && database.prepare('SELECT 1 FROM assistant_conversations WHERE chat_id=?').get(chatId)) return false;
    return true;
  };
  const chatInfo = (chatId) => chatStore.getChat(chatId);
  async function preferences(chatId, chat) {
    const value = await getPreferences?.(chatId, chat);
    return summaryOf(value);
  }
  function report(payload) { try { onDiagnostic(payload); } catch { /* diagnostics cannot break a turn */ } }
  function reportError(error, context) { try { onError(error, context); } catch { /* error reporting is isolated */ } }

  async function stats(chatId) {
    if (closed) return null;
    const chat = chatInfo(chatId);
    if (!chat || !mainChat(chatId)) return null;
    const record = minutes.get(chatId);
    const through = record?.throughOrdinal ?? 0;
    const messages = minutes.messagesAfter(chatId, through);
    const estimatedTokens = messages.reduce((total, message) => total + estimateTokens(message.text), 0);
    const summary = await preferences(chatId, chat);
    if (closed) return null;
    const messageRule = summary.everyMessages ?? DEFAULT_SUMMARY.everyMessages;
    const tokenRule = summary.everyTokens ?? DEFAULT_SUMMARY.everyTokens;
    return {
      chatId, projectId: chat.projectId ?? null, throughOrdinal: through, minutesRevision: record?.revision ?? 0,
      newMessages: messages.length, estimatedTokens,
      messages: { enabled: Boolean(messageRule.enabled), n: messageRule.n, remaining: messageRule.enabled ? Math.max(0, messageRule.n - messages.length) : null },
      tokens: { enabled: Boolean(tokenRule.enabled), n: tokenRule.n, remaining: tokenRule.enabled ? Math.max(0, tokenRule.n - estimatedTokens) : null },
      messagesRemaining: messageRule.enabled ? Math.max(0, messageRule.n - messages.length) : null,
      tokensRemaining: tokenRule.enabled ? Math.max(0, tokenRule.n - estimatedTokens) : null,
      dirty: messages.length > 0,
    };
  }

  async function shouldRun(chatId, reason) {
    const value = await stats(chatId);
    if (!value?.dirty) return { value, run: false };
    const summary = await preferences(chatId, chatInfo(chatId));
    const messageHit = summary.everyMessages?.enabled && value.newMessages >= summary.everyMessages.n;
    const tokenHit = summary.everyTokens?.enabled && value.estimatedTokens >= summary.everyTokens.n;
    const run = reason === 'discussion' ? Boolean(summary.afterDiscussion) :
      reason === 'enter' ? Boolean(summary.onEnterProject) :
      reason === 'leave' ? Boolean(summary.onLeaveProject) :
      reason === 'pending' ? Boolean(summary.onLeaveProject) :
      ['manual', 'follow-up'].includes(reason) ? true : Boolean(messageHit || tokenHit);
    return { value, run, messageHit, tokenHit };
  }

  async function runOne(chatId, reason) {
    if (closed || !mainChat(chatId)) return null;
    const check = await shouldRun(chatId, reason);
    if (!check.run) {
      if (check.value?.dirty) report({ type: 'summary-skip', reason, chatId, projectId: check.value.projectId, newMessages: check.value.newMessages, estimatedTokens: check.value.estimatedTokens });
      return check.value;
    }
    if (closed) return null;
    report({ type: 'summary-trigger', reason, chatId, projectId: check.value.projectId, newMessages: check.value.newMessages, estimatedTokens: check.value.estimatedTokens, messageThreshold: Boolean(check.messageHit), tokenThreshold: Boolean(check.tokenHit) });
    try {
      // Main-turn and discussion events use the minutes module's debounce and
      // one-run-per-chat guard. Project transitions are intentionally awaited
      // by projectChats so they update dirty chats in sequence.
      if ((reason === 'turn' || reason === 'discussion') && typeof minutes.schedule === 'function') {
        minutes.schedule(chatId,{reason:reason==='turn'?(check.messageHit?'messages':'tokens'):reason,
          shouldRefresh:async()=>!closed&&(await shouldRun(chatId,reason)).run});
        if (!closed) report({ type: 'summary-scheduled', reason, chatId, projectId: check.value.projectId });
        return check.value;
      }
      const result = await minutes.refresh(chatId,{reason});
      if (!closed) report({ type: 'summary-updated', reason, chatId, projectId: check.value.projectId, revision: result?.revision ?? null });
      return result;
    } catch (error) {
      reportError(error, { type: 'summary-refresh', reason, chatId, projectId: check.value.projectId });
      return null;
    }
  }

  function enqueue(chatId, reason) {
    if (closed || !chatId) return Promise.resolve(null);
    const previous = queued.get(chatId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(() => runOne(chatId, reason));
    queued.set(chatId, task);
    return task.finally(() => { if (queued.get(chatId) === task) queued.delete(chatId); });
  }

  async function projectChats(projectId, reason) {
    if (closed || projectId === null || projectId === undefined) return [];
    const chats = (chatStore.listChats(projectId) || []).slice().sort((a, b) => String(a.updated || '').localeCompare(String(b.updated || '')));
    const results = [];
    for (const chat of chats) { if (closed) break; results.push(await enqueue(chat.id, reason)); }
    return results;
  }

  function markPending(projectId, reason) {
    if (!database?.prepare || projectId === null || projectId === undefined) return;
    database.prepare(`INSERT INTO summary_pending(project_id,reason,created_at) VALUES(?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET reason=excluded.reason,created_at=excluded.created_at`).run(projectId, reason, new Date().toISOString());
  }

  async function processPending() {
    if (closed || !database?.prepare) return;
    const rows = database.prepare('SELECT project_id,reason FROM summary_pending ORDER BY created_at').all();
    for (const row of rows) {
      if (closed) break;
      const results = await projectChats(row.project_id, 'pending');
      if (!closed && results.every((result) => result !== null)) database.prepare('DELETE FROM summary_pending WHERE project_id=?').run(row.project_id);
    }
  }

  const onTurn = ({ chatId } = {}) => enqueue(chatId, 'turn');
  const onDiscussion = ({ chatId } = {}) => enqueue(chatId, 'discussion');
  const onEntered = ({ projectId } = {}) => projectChats(projectId, 'enter');
  const onLeft = ({ projectId } = {}) => {
    if (projectId === null || projectId === undefined || closed) return Promise.resolve();
    return projectChats(projectId, 'leave');
  };
  off.push(events.on('chat.turn.persisted', onTurn));
  off.push(events.on('discussion.finished', onDiscussion));
  off.push(events.on('project.entered', onEntered));
  off.push(events.on('project.left', onLeft));
  off.push(events.on('app.started', () => {
    if (closed) return;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingTimer = null; void processPending().catch((error) => reportError(error, { type: 'summary-pending' })); }, pendingDelayMs);
    pendingTimer.unref?.();
  }));

  function focus(projectId) {
    if (closed) return { projectId: focusedProject, closed: true };
    if (focusedProject === projectId) return { projectId, changed: false };
    const previous = focusedProject;
    focusedProject = projectId ?? null;
    if (previous !== null && previous !== undefined) void events.emit('project.left', { projectId: previous });
    if (focusedProject !== null) void events.emit('project.entered', { projectId: focusedProject });
    return { projectId: focusedProject, previous, changed: true };
  }

  async function shutdown(projectId = focusedProject) {
    if (closed || projectId === null || projectId === undefined) return false;
    const summary=await preferences();
    if(closed||!summary.onLeaveProject)return false;
    markPending(projectId, 'shutdown');
    return true;
  }

  async function close() {
    if (closed) return;
    closed = true;
    clearTimeout(pendingTimer); pendingTimer = null;
    for (const unsubscribe of off.splice(0)) unsubscribe();
    queued.clear();
  }

  return Object.freeze({ focus, shutdown, close, status: stats, trigger: enqueue });
}

export default { createSummaryPolicy };
