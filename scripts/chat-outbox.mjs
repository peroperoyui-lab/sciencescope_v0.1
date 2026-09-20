import { randomUUID } from 'node:crypto';

const ID = /^[A-Za-z0-9_-]{1,160}$/u;
const inputId = (value, name) => {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`Invalid ${name}`);
  return value;
};

function snapshot(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('input is required');
  if (input.temporary || !['ask','full'].includes(input.executionMode || 'ask') || ['attachments','annotations','contextRefs'].some(key=>input[key]?.length)) throw new TypeError('Outbox only accepts non-temporary text turns');
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20000) throw new TypeError('text is required');
  const model = input.model;
  if (!model || typeof model !== 'object' || Array.isArray(model) || typeof model.providerId !== 'string' || !model.providerId.trim() || typeof model.modelId !== 'string' || !model.modelId.trim()) throw new TypeError('model route is required');
  const result = {
    text: input.text,
    model: { providerId: model.providerId, modelId: model.modelId },
    executionMode: input.executionMode === 'full' ? 'full' : 'ask',
    projectId:null,
    userMessageId:inputId(input.userMessageId || `msg-${randomUUID()}`,'userMessageId'),
    assistantMessageId:inputId(input.assistantMessageId || `msg-${randomUUID()}`,'assistantMessageId'),
  };
  if (typeof input.reasoningEffort === 'string' && input.reasoningEffort) result.reasoningEffort = input.reasoningEffort;
  if (input.projectId !== undefined && input.projectId !== null) result.projectId = inputId(input.projectId, 'projectId');
  if (input.userMessageId !== undefined) result.userMessageId = inputId(input.userMessageId, 'userMessageId');
  if (input.assistantMessageId !== undefined) result.assistantMessageId = inputId(input.assistantMessageId, 'assistantMessageId');
  return result;
}

export function createChatOutbox({ chatStore } = {}) {
  if (!chatStore?.db?.db || typeof chatStore._mutate !== 'function') throw new TypeError('chatStore is required');
  const db = chatStore.db.db;
  db.exec(`CREATE TABLE IF NOT EXISTS chat_outbox_state (chat_id TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS chat_outbox (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, input_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS chat_outbox_chat_order ON chat_outbox(chat_id, created_at, id);`);
  // A process restart must never leave an item looking in-flight.
  db.exec("UPDATE chat_outbox SET status='interrupted' WHERE status='sending'");
  db.exec('UPDATE chat_outbox_state SET paused=1');
  const chatId = (value) => inputId(value, 'chatId');
  const state = (id) => db.prepare('SELECT paused FROM chat_outbox_state WHERE chat_id=?').get(id)?.paused === 1;
  const ensureState = (id) => db.prepare('INSERT OR IGNORE INTO chat_outbox_state(chat_id,paused) VALUES(?,0)').run(id);
  const item = (row) => row && ({ id: row.id, input: JSON.parse(row.input_json), status: row.status });
  const enqueue = ({ chatId: id, input } = {}) => chatStore._mutate(() => {
    id = chatId(id); const value = snapshot(input);
    ensureState(id);
    const count = db.prepare("SELECT COUNT(*) AS count FROM chat_outbox WHERE chat_id=? AND status IN ('queued','sending','interrupted')").get(id).count;
    if (count >= 20) throw new Error('CHAT_OUTBOX_FULL');
    const outboxId = `outbox-${randomUUID().replaceAll('-', '')}`;
    db.prepare('INSERT INTO chat_outbox(id,chat_id,input_json,status,created_at) VALUES(?,?,?,?,?)').run(outboxId, id, JSON.stringify(value), 'queued', new Date().toISOString());
    return item(db.prepare('SELECT * FROM chat_outbox WHERE id=?').get(outboxId));
  });
  const list = (id) => {
    id = chatId(id); ensureState(id);
    return { paused: state(id), items: db.prepare('SELECT * FROM chat_outbox WHERE chat_id=? ORDER BY rowid').all(id).map(item) };
  };
  const claim = ({ chatId: id, id: outboxId } = {}) => chatStore._mutate(() => {
    id = chatId(id); inputId(outboxId, 'outboxId'); ensureState(id);
    if (state(id)) return null;
    const first = db.prepare("SELECT * FROM chat_outbox WHERE chat_id=? ORDER BY rowid LIMIT 1").get(id);
    if (!first || first.id !== outboxId || first.status!=='queued') return null;
    db.prepare("UPDATE chat_outbox SET status='sending' WHERE id=? AND status='queued'").run(outboxId);
    return item(db.prepare('SELECT * FROM chat_outbox WHERE id=?').get(outboxId));
  });
  const finish = ({ chatId: id, id: outboxId } = {}) => chatStore._mutate(() => {
    id = chatId(id); inputId(outboxId, 'outboxId');
    return Boolean(db.prepare("DELETE FROM chat_outbox WHERE id=? AND chat_id=? AND status='sending'").run(outboxId, id).changes);
  });
  const fail = ({ chatId: id, id: outboxId } = {}) => chatStore._mutate(() => {
    id = chatId(id); inputId(outboxId, 'outboxId'); ensureState(id);
    const changed = db.prepare("UPDATE chat_outbox SET status='interrupted' WHERE id=? AND chat_id=? AND status='sending'").run(outboxId, id).changes;
    if (changed) db.prepare('UPDATE chat_outbox_state SET paused=1 WHERE chat_id=?').run(id);
    return Boolean(changed);
  });
  const pause = (id) => chatStore._mutate(() => { id = chatId(id); ensureState(id); db.prepare('UPDATE chat_outbox_state SET paused=1 WHERE chat_id=?').run(id); return true; });
  const resume = (id) => chatStore._mutate(() => { id = chatId(id); ensureState(id); db.prepare('UPDATE chat_outbox_state SET paused=0 WHERE chat_id=?').run(id); return true; });
  const cancel = ({ chatId: id, id: outboxId } = {}) => chatStore._mutate(() => {
    id = chatId(id); inputId(outboxId, 'outboxId');
    return Boolean(db.prepare("DELETE FROM chat_outbox WHERE id=? AND chat_id=? AND status IN ('queued','interrupted')").run(outboxId, id).changes);
  });
  // One grouped query is used by the activity poll; do not read each chat's
  // queue independently (the endpoint is intentionally polled frequently).
  const activityCounts = (chatIds = []) => {
    if (!Array.isArray(chatIds) || !chatIds.length) return new Map();
    const marks = chatIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT o.chat_id, s.paused,
      SUM(CASE WHEN o.status IN ('queued','interrupted') THEN 1 ELSE 0 END) AS queued_count,
      SUM(CASE WHEN o.status='sending' THEN 1 ELSE 0 END) AS sending_count
      FROM chat_outbox o LEFT JOIN chat_outbox_state s ON s.chat_id=o.chat_id
      WHERE o.chat_id IN (${marks}) GROUP BY o.chat_id, s.paused`).all(...chatIds);
    return new Map(rows.map(row => [row.chat_id, { paused:Number(row.paused||0)===1, queuedCount: Number(row.queued_count || 0), sendingCount: Number(row.sending_count || 0) }]));
  };
  return { enqueue, list, claim, finish, fail, pause, resume, cancel, activityCounts };
}

export default { createChatOutbox };
