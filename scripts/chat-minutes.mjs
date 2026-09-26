// Conversation minutes (user decision 2026-09-26): the secretary keeps a
// running record of the whole conversation — goals, decisions, rejected
// options, open questions, positions, manuscript state, to-dos — so every
// expert can understand the project's history without the transcript being
// truncated. Updates are incremental: the previous minutes plus the messages
// they do not cover yet, in batches, so cost does not grow with the length of
// the conversation. Every revision is kept; a user's edit is authoritative.
import { presentedFiles } from './discussion-service.mjs';

const BATCH_CHARS = 60000;       // new messages per update step
const MAX_MESSAGE_CHARS = 20000; // a single very long message is cut in the minutes input only
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

export function createChatMinutes({ db, host, chatStore, modelFor, onError }) {
  db.exec(`CREATE TABLE IF NOT EXISTS chat_minutes(
    chat_id TEXT NOT NULL, revision INTEGER NOT NULL, text TEXT NOT NULL, through_ordinal INTEGER NOT NULL,
    author TEXT NOT NULL CHECK(author IN ('secretary','user')), updated_at TEXT NOT NULL,
    PRIMARY KEY(chat_id, revision));`);
  const timers = new Map(), running = new Map();
  let closed = false;

  const current = (chatId) => {
    const row = db.prepare('SELECT * FROM chat_minutes WHERE chat_id=? ORDER BY revision DESC LIMIT 1').get(chatId);
    return row ? { chatId, revision: row.revision, text: row.text, throughOrdinal: row.through_ordinal, author: row.author, updatedAt: row.updated_at } : null;
  };
  const insert = (chatId, text, throughOrdinal, author) => {
    const revision = (current(chatId)?.revision ?? 0) + 1;
    db.prepare('INSERT INTO chat_minutes VALUES(?,?,?,?,?,?)').run(chatId, revision, text, throughOrdinal, author, new Date().toISOString());
    return current(chatId);
  };

  // Messages as the team sees them: final texts with speakers; an unadopted
  // review is left out. `ordinal` here is the 1-based message number (#1 is
  // the first message; stored ordinals start at 0).
  const has = (table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  function messagesAfter(chatId, ordinal, { until = Infinity, limit = 5000 } = {}) {
    const experts = has('discussion_entries');
    const rows = db.prepare(`SELECT m.ordinal, m.id, m.role, m.text${experts ? ', e.label, e.role AS expert_role, e.review, e.adopted' : ''}
      FROM messages m${experts ? ' LEFT JOIN discussion_entries e ON e.chat_id=m.chat_id AND e.message_id=m.id' : ''}
      WHERE m.chat_id=? AND m.ordinal>=? AND m.ordinal<? AND m.role IN ('user','assistant') ORDER BY m.ordinal LIMIT ?`).all(chatId, ordinal, Number.isFinite(until) ? until : Number.MAX_SAFE_INTEGER, limit);
    const kept = rows.filter((row) => !(row.review === 1 && row.adopted !== 1) && String(row.text || '').trim());
    // Files each answer presented (DSH `present`), never its other tool calls.
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

  async function update(chatId) {
    const chat = chatStore.getChat(chatId);
    if (!chat) return null;
    const model = modelFor(chatId);
    if (!model) return null;
    let minutes = current(chatId);
    let pending = messagesAfter(chatId, minutes?.throughOrdinal ?? 0);
    if (!pending.some((message) => message.role === 'assistant')) return minutes;
    while (pending.length) {
      const batch = []; let size = 0;
      for (const message of pending) { const block = format(message, MAX_MESSAGE_CHARS); if (batch.length && size + block.length > BATCH_CHARS) break; batch.push(message); size += block.length; }
      const prompt = `${MINUTES_PROMPT}\n\n[Previous minutes${minutes ? ` (revision ${minutes.revision}, by the ${minutes.author}, covering messages up to #${minutes.throughOrdinal})` : ''}]\n${minutes?.text || '(none yet)'}\n[End of previous minutes]\n\n[New messages #${batch[0].ordinal}–#${batch.at(-1).ordinal}]\n${batch.map((message) => format(message, MAX_MESSAGE_CHARS)).join('\n')}\n[End of new messages]`;
      let sessionId;
      try {
        sessionId = await host.startSession({ model, workspace: chatStore.getRuntimeWorkspace?.(chatId) || undefined, runtimeConfig: await host.getRuntimeConfig?.(), noTools: true });
        const response = await host.send({ sessionId, text: prompt });
        const text = String(response?.finalResponse ?? response?.text ?? '').trim();
        if (!text) throw new Error('EMPTY_MINUTES');
        // A user edit made while this ran wins; stop and let the next update build on it.
        const latest = current(chatId);
        if (latest && minutes && latest.revision !== minutes.revision) return latest;
        minutes = insert(chatId, text, batch.at(-1).ordinal, 'secretary');
      } finally { if (sessionId) await host.releaseSession?.(sessionId).catch(() => {}); }
      pending = pending.slice(batch.length);
    }
    return minutes;
  }

  /** Update soon (debounced, one run per chat at a time). */
  function schedule(chatId) {
    if (closed || !host?.startSession || !chatId) return;
    clearTimeout(timers.get(chatId));
    timers.set(chatId, setTimeout(() => { timers.delete(chatId); void refresh(chatId).catch((error) => onError?.(error)); }, DEBOUNCE_MS));
  }
  function refresh(chatId) {
    if (running.has(chatId)) return running.get(chatId).then(() => refresh(chatId));
    const work = update(chatId).finally(() => running.delete(chatId));
    running.set(chatId, work);
    return work;
  }

  return {
    get: current,
    updating: (chatId) => running.has(chatId) || timers.has(chatId),
    history: (chatId) => db.prepare('SELECT revision, author, through_ordinal AS throughOrdinal, updated_at AS updatedAt FROM chat_minutes WHERE chat_id=? ORDER BY revision DESC').all(chatId),
    /** A user's edit becomes the next revision; it keeps the coverage it replaced. */
    edit(chatId, text, expectedRevision) {
      if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new MinutesError('INVALID_MINUTES', '纪要须为 1–100000 个字符。');
      const latest = current(chatId);
      if ((latest?.revision ?? 0) !== expectedRevision) throw new MinutesError('MINUTES_CHANGED', '纪要已被更新，请刷新后再编辑。', 409);
      return insert(chatId, text.trim(), latest?.throughOrdinal ?? 0, 'user');
    },
    schedule, refresh, messagesAfter, format,
    /** Stop pending updates and wait for running ones (application shutdown). */
    async close() { closed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear(); await Promise.allSettled(running.values()); },
  };
}
