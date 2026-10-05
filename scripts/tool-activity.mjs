// Presentation-only projection of DSH tool calls.  Runtime/session history is
// the source of truth; this cache contains only bounded, redacted previews.
const MAX_STRING = 1200;
const MAX_PREVIEW = 4000;
const MAX_OBJECT_KEYS = 24;
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 3;
const SENSITIVE = /pass(word)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|access[_-]?key|session[_-]?id/i;
const SECRET_VALUE = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|rk|pk)[_-][A-Za-z0-9_-]{8,}/gi;

export function sanitizePreview(value) {
  const seen = new WeakSet();
  const visit = (input, depth, key) => {
    if (key && SENSITIVE.test(key)) return '[redacted]';
    if (input === null || typeof input === 'number' || typeof input === 'boolean') return input;
    if (typeof input === 'string') return input.replace(SECRET_VALUE, '[redacted]').slice(0, MAX_STRING);
    if (typeof input !== 'object') return String(input).slice(0, MAX_STRING);
    if (seen.has(input)) return '[circular]';
    if (depth >= MAX_DEPTH) return '[truncated]';
    seen.add(input);
    if (Array.isArray(input)) return input.slice(0, MAX_ARRAY_ITEMS).map((item) => visit(item, depth + 1, '')).concat(input.length > MAX_ARRAY_ITEMS ? ['[truncated]'] : []);
    const out = {};
    for (const [name, item] of Object.entries(input).slice(0, MAX_OBJECT_KEYS)) out[name] = visit(item, depth + 1, name);
    if (Object.keys(input).length > MAX_OBJECT_KEYS) out._truncated = true;
    return out;
  };
  return visit(value, 0, '');
}

export function previewValue(value) {
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { /* retain text */ }
  }
  const safe = sanitizePreview(source);
  if (typeof safe === 'string') return safe;
  try { return JSON.stringify(safe).slice(0, MAX_PREVIEW); } catch { return '[unavailable]'; }
}

export function createToolActivityProjection({ chatStore } = {}) {
  if (!chatStore?.db?.db || typeof chatStore._mutate !== 'function') throw new TypeError('chatStore is required');
  const db = chatStore.db.db;
  db.exec(`CREATE TABLE IF NOT EXISTS tool_activity (
    chat_id TEXT NOT NULL, assistant_message_id TEXT NOT NULL, call_id TEXT NOT NULL,
    turn INTEGER, step INTEGER, name TEXT NOT NULL, status TEXT NOT NULL,
    is_error INTEGER NOT NULL DEFAULT 0, arguments_preview TEXT, result_preview TEXT,
    updated_at TEXT NOT NULL, PRIMARY KEY(chat_id, assistant_message_id, call_id)
  ); CREATE INDEX IF NOT EXISTS tool_activity_message ON tool_activity(chat_id, assistant_message_id);`);
  // Execution preamble: the model's own words right before this call.
  if (!db.prepare('PRAGMA table_info(tool_activity)').all().some((column) => column.name === 'preamble')) db.exec('ALTER TABLE tool_activity ADD COLUMN preamble TEXT');
  const validate = (v, name) => { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/u.test(v)) throw new TypeError(`Invalid ${name}`); return v; };
  const record = (input = {}) => chatStore._mutate(() => {
    const chatId = validate(input.chatId, 'chatId');
    const assistantMessageId = validate(input.assistantMessageId, 'assistantMessageId');
    if (typeof input.callId !== 'string' || !/^[\x21-\x7E]{1,240}$/u.test(input.callId)) throw new TypeError('Invalid callId');
    const callId = input.callId;
    const existing = db.prepare('SELECT * FROM tool_activity WHERE chat_id=? AND assistant_message_id=? AND call_id=?').get(chatId, assistantMessageId, callId);
    const status = (input.status === 'running' || input.type === 'tool-call') ? 'running' : 'completed';
    const name = String(input.name || existing?.name || 'tool').slice(0, 200);
    const args = input.argumentsPreview === undefined ? existing?.arguments_preview ?? null : previewValue(input.argumentsPreview);
    const result = input.resultPreview === undefined ? existing?.result_preview ?? null : previewValue(input.resultPreview);
    const turn = Number.isInteger(input.turn) ? input.turn : existing?.turn ?? null;
    const step = Number.isInteger(input.step) ? input.step : existing?.step ?? null;
    const preamble = typeof input.preamble === 'string' && input.preamble.trim() ? input.preamble.replace(/\r/g, '').slice(0, 4000) : existing?.preamble ?? null;
    const isError = input.isError === undefined ? Boolean(existing?.is_error) : Boolean(input.isError);
    const updated = new Date().toISOString();
    db.prepare(`INSERT INTO tool_activity(chat_id,assistant_message_id,call_id,turn,step,name,status,is_error,arguments_preview,result_preview,preamble,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,assistant_message_id,call_id) DO UPDATE SET turn=excluded.turn,step=excluded.step,name=excluded.name,status=excluded.status,is_error=excluded.is_error,arguments_preview=excluded.arguments_preview,result_preview=excluded.result_preview,preamble=excluded.preamble,updated_at=excluded.updated_at`)
      .run(chatId, assistantMessageId, callId, turn, step, name, status, isError ? 1 : 0, args, result, preamble, updated);
    return row(db.prepare('SELECT * FROM tool_activity WHERE chat_id=? AND assistant_message_id=? AND call_id=?').get(chatId, assistantMessageId, callId));
  });
  const settle = ({ chatId, assistantMessageId } = {}) => chatStore._mutate(() => {
    chatId = validate(chatId, 'chatId'); assistantMessageId = validate(assistantMessageId, 'assistantMessageId');
    db.prepare("UPDATE tool_activity SET status='interrupted',updated_at=? WHERE chat_id=? AND assistant_message_id=? AND status='running'").run(new Date().toISOString(), chatId, assistantMessageId);
    return list({ chatId, assistantMessageIds: [assistantMessageId] });
  });
  const list = ({ chatId, assistantMessageIds = [], limit = 100 } = {}) => {
    chatId = validate(chatId, 'chatId');
    if (!Array.isArray(assistantMessageIds) || assistantMessageIds.length > 1000) throw new TypeError('Invalid assistantMessageIds');
    const ids = assistantMessageIds.map((id) => validate(id, 'assistantMessageId'));
    limit = Math.max(1, Math.min(200, Number(limit) || 100));
    if (!ids.length) return [];
    const marks = ids.map(() => '?').join(',');
    return db.prepare(`SELECT * FROM tool_activity WHERE chat_id=? AND assistant_message_id IN (${marks}) ORDER BY rowid LIMIT ?`).all(chatId, ...ids, limit).map(row);
  };
  return { record, list, settle };
}

function row(value) {
  if (!value) return null;
  return { chatId: value.chat_id, assistantMessageId: value.assistant_message_id, callId: value.call_id, turn: value.turn, step: value.step, name: value.name, status: value.status, isError: Boolean(value.is_error), ...(value.arguments_preview === null ? {} : { argumentsPreview: value.arguments_preview }), ...(value.result_preview === null ? {} : { resultPreview: value.result_preview }), ...(value.preamble ? { preamble: value.preamble } : {}), updatedAt: value.updated_at };
}
