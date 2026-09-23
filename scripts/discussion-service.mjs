import { randomUUID } from 'node:crypto';

// One expert discussion round over the chat's DSH session. The host owns the
// agent loop (in-process subagents); this module owns prompts and records.
// Records: user turn + one assistant message per expert, plus metadata rows
// that let the transcript show the real author and model of each answer.
const MAX_ANSWER_IN_CRITIQUE = 12000;
const INDEPENDENT = 'Panel round: independent assessment. Other experts answer in parallel and you cannot see them. Give your own view of the request above.';
const CRITIQUE = 'Panel round: cross-critique. Name the most important point another expert raised that you missed or got wrong, state where you disagree with another expert and why, then give your revised position. Refer to experts by name.';

export class DiscussionError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function createDiscussionService({ host, chatStore, db }) {
  db.exec(`CREATE TABLE IF NOT EXISTS discussion_rounds(run_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, kind TEXT NOT NULL, question TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS discussion_rounds_chat ON discussion_rounds(chat_id, created_at);
    CREATE TABLE IF NOT EXISTS discussion_entries(chat_id TEXT NOT NULL, message_id TEXT NOT NULL, run_id TEXT NOT NULL, expert_id TEXT NOT NULL, label TEXT NOT NULL, role TEXT NOT NULL, model_json TEXT, stop_reason TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(chat_id, message_id));`);
  const active = new Map();

  function lastRound(chatId) {
    const round = db.prepare('SELECT * FROM discussion_rounds WHERE chat_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(chatId);
    if (!round) return null;
    const entries = db.prepare('SELECT e.*, m.text FROM discussion_entries e JOIN messages m ON m.chat_id=e.chat_id AND m.id=e.message_id WHERE e.run_id=? ORDER BY e.position').all(round.run_id);
    return { ...round, entries };
  }

  function entriesFor(chatId, messageIds) {
    if (!messageIds.length) return new Map();
    const marks = messageIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM discussion_entries WHERE chat_id=? AND message_id IN (${marks})`).all(chatId, ...messageIds);
    return new Map(rows.map((row) => [row.message_id, { runId: row.run_id, expertId: row.expert_id, label: row.label, role: row.role, model: row.model_json ? JSON.parse(row.model_json) : null, stopReason: row.stop_reason }]));
  }

  /**
   * @param {{chatId:string, sessionId:string, experts:object[], kind:'independent'|'critique',
   *   context:string, requestText:string, userMessage:{id:string,text:string}, chatModel:object,
   *   onEvent:(event:object)=>void}} input
   */
  async function run({ chatId, sessionId, experts, kind, context, requestText, userMessage, chatModel, onEvent }) {
    if (active.has(chatId)) throw new DiscussionError('DISCUSSION_BUSY', '这个对话的专家讨论仍在进行。', 409);
    let shared; let perExpert = () => undefined; let question = requestText;
    if (kind === 'critique') {
      const previous = lastRound(chatId);
      if (!previous?.entries.length) throw new DiscussionError('NO_PREVIOUS_ROUND', '请先进行一轮独立讨论，再让专家互相质询。', 409);
      question = previous.question;
      const answers = previous.entries.map((entry) => `<expert name="${entry.label.replaceAll('"', "'")}">\n${entry.text.slice(0, MAX_ANSWER_IN_CRITIQUE)}\n</expert>`).join('\n');
      shared = `${context}${question}\n\nThe panel's previous answers:\n${answers}\n\n${requestText ? `The user adds: ${requestText}\n\n` : ''}${CRITIQUE}`;
      perExpert = (expert) => previous.entries.some((entry) => entry.expert_id === expert.id)
        ? `You are "${expert.label}" on this panel; the block <expert name="${expert.label.replaceAll('"', "'")}"> is your own previous answer.`
        : `You are "${expert.label}" on this panel and did not answer the previous round.`;
    } else shared = `${context}${requestText}\n\n${INDEPENDENT}`;

    const runId = `discussion-${randomUUID().replaceAll('-', '')}`;
    active.set(chatId, { runId, sessionId });
    try {
      await chatStore.appendMessage({ chatId, id: userMessage.id, role: 'user', text: userMessage.text });
      db.prepare('INSERT INTO discussion_rounds VALUES(?,?,?,?,?)').run(runId, chatId, kind, question, new Date().toISOString());
      const ids = new Map(experts.map((expert) => [expert.id, `msg-${randomUUID()}`]));
      const modelOf = (expert) => expert.model || chatModel;
      onEvent({ type: 'accepted', runId, kind, userMessageId: userMessage.id, experts: experts.map((expert) => ({ id: expert.id, label: expert.label, role: expert.role, model: modelOf(expert), messageId: ids.get(expert.id) })) });
      const writes = [];
      const record = (entry) => {
        const expert = experts.find((item) => item.id === entry.expertId);
        if (!expert) return;
        const text = entry.text || (entry.stopReason === 'aborted' ? '已停止，未生成回答。' : '本轮未生成回答。');
        const messageId = ids.get(expert.id);
        writes.push(chatStore.appendMessage({ chatId, id: messageId, role: 'assistant', text }).then(() => {
          db.prepare('INSERT OR REPLACE INTO discussion_entries VALUES(?,?,?,?,?,?,?,?,?)').run(chatId, messageId, runId, expert.id, expert.label, expert.role, JSON.stringify(modelOf(expert)), entry.stopReason, experts.indexOf(expert));
        }));
        onEvent({ type: 'expert-end', runId, expertId: expert.id, messageId, text, stopReason: entry.stopReason, ms: entry.ms });
      };
      const seen = new Set();
      const result = await host.runExperts({
        sessionId, runId, prompt: shared,
        experts: experts.map((expert) => ({
          id: expert.id, label: expert.label, persona: expert.persona,
          ...(expert.model ? { model: expert.model } : {}),
          ...(expert.reasoningEffort ? { reasoningEffort: expert.reasoningEffort } : {}),
          ...(perExpert(expert) ? { prompt: perExpert(expert) } : {}),
        })),
        onEvent: (event) => {
          if (event.type === 'expert-start') onEvent({ type: 'expert-start', runId, expertId: event.expertId });
          if (!seen.has(event.expertId) && event.type === 'expert-delta' && typeof event.delta === 'string') onEvent({ type: 'expert-delta', runId, expertId: event.expertId, messageId: ids.get(event.expertId), delta: event.delta });
          if (!seen.has(event.expertId) && event.type === 'expert-reset') onEvent({ type: 'expert-reset', runId, expertId: event.expertId, messageId: ids.get(event.expertId) });
          if (!seen.has(event.expertId) && event.type === 'expert-tool') onEvent({ type: 'expert-tool', runId, expertId: event.expertId, messageId: ids.get(event.expertId), name: event.name });
          if (event.type === 'expert-end' && !seen.has(event.expertId)) { seen.add(event.expertId); record(event); }
        },
      });
      // Events are best-effort; the returned result is authoritative.
      for (const entry of result ?? []) if (!seen.has(entry.expertId)) { seen.add(entry.expertId); record(entry); }
      await Promise.all(writes);
      const failed = (result ?? []).filter((entry) => entry.stopReason !== 'completed').length;
      onEvent({ type: 'completed', runId, failed });
      return { runId, failed };
    } finally { active.delete(chatId); }
  }

  async function cancel(chatId) {
    const current = active.get(chatId);
    if (!current) return { stopped: false };
    await host.cancelExperts({ sessionId: current.sessionId, runId: current.runId });
    return { stopped: true };
  }

  return { run, cancel, entriesFor, lastRound, busy: (chatId) => active.has(chatId) };
}
