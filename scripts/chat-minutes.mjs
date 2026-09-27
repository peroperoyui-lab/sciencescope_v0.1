import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { presentedFiles } from './discussion-service.mjs';
import { estimateTokens } from './context/estimate.mjs';

const BATCH_CHARS = 60000;       // new messages per update step
const MAX_MESSAGE_CHARS = 20000; // bounded input with an explicit recall note
const DEBOUNCE_MS = 1500;

export class MinutesError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

const MINUTES_PROMPT = `You keep the minutes of a research conversation in ScienceScope for the whole team (the user, the Main expert and the invited experts).
Update the minutes with the new messages. Rules:
- Keep these sections, in this order (use the conversation's main language for headings and text):
  1. Research questions and goals
  2. Decisions and conclusions (each with the message number, e.g. #42)
  3. Rejected or superseded options, and why
  4. Open questions and disagreements
  5. Positions of each participant (Main expert and each named expert)
  6. Manuscript, files and deliverables (paths and their current state)
  7. To-dos and next steps
- Keep everything from the previous minutes that is still true; mark what changed. Never drop a decision because it is old.
- If the previous minutes were edited by the user, treat that text as authoritative.
- Record facts, not your own opinions. Do not invent anything that is not in the minutes or the messages.
- Reply with the complete updated minutes in Markdown only, no preamble.`;

function filenamePart(value) {
  const clean = String(value || 'conversation').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').replace(/[. ]+$/u, '').trim();
  return clean || 'conversation';
}

function isSaveMarkdownEnabled(preferences) {
  return preferences?.summary?.saveMarkdown ?? preferences?.saveMarkdown ?? true;
}

export function createChatMinutes({ db, host, chatStore, modelFor, getPreferences, onUpdated, onDiagnostic, onError }) {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_minutes(
    chat_id TEXT NOT NULL, revision INTEGER NOT NULL, text TEXT NOT NULL, through_ordinal INTEGER NOT NULL,
    author TEXT NOT NULL CHECK(author IN ('secretary','user')), updated_at TEXT NOT NULL,
    PRIMARY KEY(chat_id, revision));
    CREATE TABLE IF NOT EXISTS chat_minutes_markdown_status(
      chat_id TEXT PRIMARY KEY, path TEXT, error TEXT, updated_at TEXT NOT NULL
    );`);
  const timers = new Map(), running = new Map(), publishes = new Map(), ownedSessions = new Set();
  let closed = false;

  const current = (chatId) => {
    const row = db.prepare('SELECT * FROM chat_minutes WHERE chat_id=? ORDER BY revision DESC LIMIT 1').get(chatId);
    return row ? { chatId, revision: row.revision, text: row.text, throughOrdinal: row.through_ordinal, author: row.author, updatedAt: row.updated_at } : null;
  };
  const insert = (chatId, text, throughOrdinal, author) => {
    const previous = current(chatId);
    const revision = (previous?.revision ?? 0) + 1;
    db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run(chatId, revision, text, throughOrdinal, author, new Date().toISOString());
    return { previous, minutes: current(chatId) };
  };

  // Messages as the team sees them: final texts with speakers; an unadopted
  // review is left out. `ordinal` here is the 1-based message number.
  const has = (table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  function messagesAfter(chatId, ordinal, { until = Infinity, limit = Number.MAX_SAFE_INTEGER } = {}) {
    const experts = has('discussion_entries');
    const rows = db.prepare(`SELECT m.ordinal, m.id, m.role, m.text${experts ? ', e.label, e.role AS expert_role, e.review, e.adopted' : ''}
      FROM messages m${experts ? ' LEFT JOIN discussion_entries e ON e.chat_id=m.chat_id AND e.message_id=m.id' : ''}
      WHERE m.chat_id=? AND m.ordinal>=? AND m.ordinal<? AND m.role IN ('user','assistant') ORDER BY m.ordinal LIMIT ?`).all(chatId, ordinal, Number.isFinite(until) ? until : Number.MAX_SAFE_INTEGER, limit);
    const kept = rows.filter((row) => !(row.review === 1 && row.adopted !== 1) && String(row.text || '').trim());
    const files = new Map();
    if (has('tool_activity') && kept.length) {
      for (const call of db.prepare(`SELECT assistant_message_id AS id, name, status, is_error, arguments_preview FROM tool_activity WHERE chat_id=? AND name='present'`).all(chatId)) {
        const list = files.get(call.id) ?? []; list.push(...presentedFiles({ name: call.name, status: call.status, isError: call.is_error === 1, argumentsPreview: call.arguments_preview })); files.set(call.id, list);
      }
    }
    return kept.map((row) => ({
      ordinal: row.ordinal + 1, id: row.id, role: row.role, text: String(row.text), files: files.get(row.id) ?? [],
      speaker: row.role === 'user' ? 'User' : row.label ? `${row.label}${row.review === 1 ? ' (reviewer)' : ''}` : 'Main expert',
      ...(row.expert_role ? { speakerRole: row.expert_role } : {}),
    }));
  }
  const format = (message, cap = Infinity) => `<message n="${message.ordinal}" speaker="${message.speaker.replace(/"/g, "'")}"${message.speakerRole ? ` role="${message.speakerRole.replace(/"/g, "'")}"` : ''}>\n${message.text.length > cap ? `${message.text.slice(0, cap)}\n[…long message shortened here; read it in full with chat_recall from ${message.ordinal} to ${message.ordinal}]` : message.text}${message.files?.length ? `\n[Files presented with this answer]\n${message.files.map((file) => `- ${file.path}${file.description ? ` — ${file.description}` : ''}`).join('\n')}` : ''}\n</message>`;

  function markdownStatus(chatId) {
    const row = db.prepare('SELECT chat_id,path,error,updated_at FROM chat_minutes_markdown_status WHERE chat_id=?').get(chatId);
    return row ? { chatId, path: row.path, error: row.error, updatedAt: row.updated_at } : { chatId, path: null, error: null, updatedAt: null };
  }

  async function summaryStatus(chatId) {
    const chat = chatStore.getChat(chatId);
    const record = current(chatId);
    const pending = messagesAfter(chatId, record?.throughOrdinal ?? 0);
    const preferences = await getPreferences?.(chatId, chat);
    const summary = preferences?.summary ?? preferences ?? {};
    const messageRule = summary.everyMessages ?? { enabled: true, n: 20 };
    const tokenRule = summary.everyTokens ?? { enabled: true, n: 30000 };
    return {
      messagesRemaining: messageRule.enabled ? Math.max(0, messageRule.n - pending.length) : null,
      tokensRemaining: tokenRule.enabled ? Math.max(0, tokenRule.n - pending.reduce((total, message) => total + estimateTokens(message.text), 0)) : null,
    };
  }

  function saveMarkdownStatus(chatId, filePath, error = null) {
    db.prepare(`INSERT INTO chat_minutes_markdown_status(chat_id,path,error,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(chat_id) DO UPDATE SET path=excluded.path,error=excluded.error,updated_at=excluded.updated_at`)
      .run(chatId, filePath, error, new Date().toISOString());
  }

  async function writeMarkdown(chatId, minutes, chat) {
    let preferences;
    try { preferences = await getPreferences?.(chatId, chat); } catch (error) { onDiagnostic?.({ type: 'preferences-error', chatId, error }); }
    if (!isSaveMarkdownEnabled(preferences)) return;
    const workspace = chatStore.getRuntimeWorkspace?.(chatId);
    if (!workspace) return;
    const filePath = path.join(workspace, 'minutes', `${filenamePart(chat?.title)}-${String(chatId).slice(0, 8)}.md`);
    const header = `<!-- ScienceScope conversation minutes -->\n<!-- Revision ${minutes.revision}; covers messages through #${minutes.throughOrdinal}. Edit this in the ScienceScope conversation minutes window. -->\n\n`;
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(temporary, `${header}${minutes.text}\n`, 'utf8');
      await rename(temporary, filePath);
      saveMarkdownStatus(chatId, filePath, null);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      const detail = String(error?.message || error);
      saveMarkdownStatus(chatId, filePath, detail);
      onDiagnostic?.({ type: 'markdown-write-error', chatId, path: filePath, error: detail });
    }
  }

  function publish(chatId, previous, minutes) {
    const prior = publishes.get(chatId) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(async () => {
      const chat = chatStore.getChat(chatId);
      await writeMarkdown(chatId, minutes, chat);
      if (!(closed && minutes.author === 'secretary')) {
        try { await onUpdated?.({ chatId, previous, minutes, chat }); }
        catch (error) { try { onError?.(error); } catch { /* diagnostics are isolated */ } }
      }
    });
    publishes.set(chatId, task);
    return task.finally(() => { if (publishes.get(chatId) === task) publishes.delete(chatId); });
  }

  async function update(chatId, reason, shouldRefresh) {
    if (closed) return current(chatId);
    if(shouldRefresh&&!await shouldRefresh())return current(chatId);
    if(closed)return current(chatId);
    const chat = chatStore.getChat(chatId);
    if (!chat) return null;
    const model = await modelFor?.(chatId);
    if (!model) return null;
    let minutes = current(chatId);
    let baseRevision = minutes?.revision ?? 0;
    let pending = messagesAfter(chatId, minutes?.throughOrdinal ?? 0);
    if (!pending.some((message) => message.role === 'assistant')) return minutes;
    try { onDiagnostic?.({type:'minutes-update',chatId,reason}); } catch { /* diagnostics are isolated */ }
    while (pending.length) {
      if (closed) return current(chatId);
      const batch = []; let size = 0;
      for (const message of pending) { const block = format(message, MAX_MESSAGE_CHARS); if (batch.length && size + block.length > BATCH_CHARS) break; batch.push(message); size += block.length; }
      const prompt = `${MINUTES_PROMPT}\n\n[Previous minutes${minutes ? ` (revision ${minutes.revision}, by the ${minutes.author}, covering messages up to #${minutes.throughOrdinal})` : ''}]\n${minutes?.text || '(none yet)'}\n[End of previous minutes]\n\n[New messages #${batch[0].ordinal}–#${batch.at(-1).ordinal}]\n${batch.map((message) => format(message, MAX_MESSAGE_CHARS)).join('\n')}\n[End of new messages]`;
      let sessionId;
      try {
        if (closed) return current(chatId);
        sessionId = await host.startSession({ model, workspace: chatStore.getRuntimeWorkspace?.(chatId) || undefined, runtimeConfig: await host.getRuntimeConfig?.(), noTools: true });
        ownedSessions.add(sessionId);
        if (closed) { await Promise.resolve(host.interrupt?.(sessionId)).catch(() => {}); return current(chatId); }
        const response = await host.send({ sessionId, text: prompt });
        if (closed || response?.cancelled || ['cancelled', 'failed', 'error', 'stopped'].includes(response?.type ?? response?.status)) return current(chatId);
        const text = String(response?.finalResponse ?? response?.text ?? '').trim();
        if (!text) throw new Error('EMPTY_MINUTES');
        // A user edit made while this ran wins, including the initial edit
        // where there was no secretary revision to compare against.
        const latest = current(chatId);
        if (closed) return latest;
        if ((latest?.revision ?? 0) !== baseRevision) return latest;
        const saved = insert(chatId, text, batch.at(-1).ordinal, 'secretary');
        minutes = saved.minutes; baseRevision = minutes.revision;
        await publish(chatId, saved.previous, minutes);
      } finally {
        if (sessionId) { ownedSessions.delete(sessionId); await Promise.resolve(host.releaseSession?.(sessionId)).catch(() => {}); }
      }
      pending = pending.slice(batch.length);
    }
    return minutes;
  }

  function schedule(chatId, {reason='automatic',shouldRefresh} = {}) {
    if (closed || !host?.startSession || !chatId) return;
    clearTimeout(timers.get(chatId));
    const timer = setTimeout(() => { timers.delete(chatId); void refresh(chatId,{reason,shouldRefresh}).catch((error) => onError?.(error)); }, DEBOUNCE_MS);
    timer.unref?.(); timers.set(chatId, timer);
  }
  function refresh(chatId, {reason='manual',shouldRefresh} = {}) {
    if (closed) return Promise.resolve(current(chatId));
    if (running.has(chatId)) return running.get(chatId).then(() => refresh(chatId,{reason,shouldRefresh}));
    const work = update(chatId,reason,shouldRefresh).finally(() => running.delete(chatId));
    running.set(chatId, work);
    return work;
  }

  return {
    get: current,
    updating: (chatId) => running.has(chatId) || timers.has(chatId),
    history: (chatId) => db.prepare('SELECT revision, author, through_ordinal AS throughOrdinal, updated_at AS updatedAt FROM chat_minutes WHERE chat_id=? ORDER BY revision DESC').all(chatId),
    revisions: (chatId) => db.prepare('SELECT revision, text, through_ordinal AS throughOrdinal, author, updated_at AS updatedAt FROM chat_minutes WHERE chat_id=? ORDER BY revision DESC').all(chatId),
    status: markdownStatus,
    markdownStatus,
    exportStatus: markdownStatus,
    summaryStatus,
    /** A user's edit becomes the next revision; it keeps the coverage it replaced. */
    edit(chatId, text, expectedRevision) {
      if (closed) throw new MinutesError('MINUTES_CLOSED', '纪要服务已关闭。', 409);
      if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new MinutesError('INVALID_MINUTES', '纪要须为 1–100000 个字符。');
      const latest = current(chatId);
      if ((latest?.revision ?? 0) !== expectedRevision) throw new MinutesError('MINUTES_CHANGED', '纪要已被更新，请刷新后再编辑。', 409);
      const saved = insert(chatId, text.trim(), latest?.throughOrdinal ?? 0, 'user');
      void publish(chatId, saved.previous, saved.minutes).catch((error) => onError?.(error));
      return saved.minutes;
    },
    schedule, refresh, messagesAfter, format,
    async close() {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer); timers.clear();
      for (const sessionId of ownedSessions) await Promise.resolve(host.interrupt?.(sessionId)).catch(() => {});
      await Promise.allSettled(running.values());
      await Promise.allSettled(publishes.values());
    },
  };
}
