import { randomUUID } from 'node:crypto';

const ROLES = new Set(['main', 'secretary', 'global']);
const MAIN_PROMPT = "You are ScienceScope's Main research coordinator. Coordinate rigorous scientific reasoning grounded in evidence, explicit methods, assumptions, and uncertainty, and make next steps clear. When the user asks, explain the method, formulas, statistical assumptions, and evidential basis so they can understand, judge, and correct the analysis. Explain basic concepts when the user requests them; do not infer scientific conclusions from a private user profile. Do not act as a general coding agent.";
const BUILTIN = Object.freeze({
  main: MAIN_PROMPT,
  global: "You are ScienceScope's private global assistant. Use the workspace overview and scoped context tools to understand public research progress across projects. Private assistant chats, temporary chats and private library items are excluded. Use only capabilities granted by the runtime and accurately report actions and results.",
  secretary: "You are ScienceScope's private task secretary. Follow the progress of your bound Main conversation using the follow-up packet, minutes and scoped context tools. User-edited minutes take precedence. Use only capabilities granted by the runtime and accurately report actions and results.",
});

export class RoleSettingsError extends Error {
  constructor(message) { super(message); this.name = 'RoleSettingsError'; this.code = 'INVALID_ROLE_SETTINGS'; this.status = 400; }
}

function invalid(message) { throw new RoleSettingsError(message); }
function roleValue(role) {
  if (typeof role !== 'string' || !ROLES.has(role)) invalid('Unknown role');
  return role;
}
function chatValue(chatId) {
  if (typeof chatId !== 'string' || !chatId.trim() || chatId.length > 160) invalid('Invalid chatId');
  return chatId;
}
function modelValue(model) {
  if (model === null) return null;
  if (!model || typeof model !== 'object' || typeof model.providerId !== 'string' || typeof model.modelId !== 'string' || !model.providerId.trim() || !model.modelId.trim() || model.providerId.length > 200 || model.modelId.length > 200) invalid('Invalid model');
  return { providerId: model.providerId, modelId: model.modelId };
}
function effortValue(effort) {
  if (effort === null) return null;
  if (typeof effort !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/u.test(effort)) invalid('Invalid reasoning effort');
  return effort;
}
function promptValue(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) invalid('Invalid prompt');
  if (Buffer.byteLength(prompt,'utf8') > 64 * 1024 * 1024) {
    const error = new RoleSettingsError('提示词超过 64 MiB 资源上限；本次未保存，已有提示词和会话绑定保持完整。');
    error.code = 'ROLE_PROMPT_RESOURCE_LIMIT'; error.status = 413; throw error;
  }
  return prompt.trim();
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function validateSnapshot(snapshot, role) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.role !== role) invalid('Invalid snapshot');
  const prompt = promptValue(snapshot.prompt);
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) invalid('Invalid snapshot revision');
  return { role, prompt, revision: snapshot.revision };
}

export function createRoleSettings({ db } = {}) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new TypeError('A node:sqlite DatabaseSync handle is required');
  db.exec(`
    CREATE TABLE IF NOT EXISTS role_settings (
      role TEXT PRIMARY KEY, prompt TEXT NOT NULL, model_json TEXT, reasoning_effort TEXT, revision INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS role_bindings (
      chat_id TEXT PRIMARY KEY, role TEXT NOT NULL, prompt TEXT NOT NULL, revision INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS role_prompt_receipts (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL, revision INTEGER NOT NULL, at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS role_prompt_receipts_chat_at ON role_prompt_receipts(chat_id, at DESC, id DESC);
  `);
  for (const role of ROLES) db.prepare('INSERT OR IGNORE INTO role_settings(role,prompt,model_json,reasoning_effort,revision) VALUES(?,?,?,?,0)').run(role, BUILTIN[role], null, null);
  // Upgrade only untouched defaults. Never rewrite user settings or per-session
  // persona bindings/receipts; versioned lookup rules use configureBrief instead.
  const oldDefaults = {
    global: "You are ScienceScope's private global assistant. Use only explicitly supplied context; do not claim to inspect unrelated projects. You may use capabilities granted by the runtime and must accurately report actions and results.",
    secretary: "You are ScienceScope's private task secretary. Use only explicitly supplied context, may use capabilities granted by the runtime, and must accurately report actions and results.",
  };
  for (const [role, oldPrompt] of Object.entries(oldDefaults)) db.prepare('UPDATE role_settings SET prompt=? WHERE role=? AND revision=0 AND prompt=?').run(BUILTIN[role],role,oldPrompt);

  function get(role) {
    roleValue(role);
    const row = db.prepare('SELECT role,prompt,model_json,reasoning_effort,revision FROM role_settings WHERE role=?').get(role);
    return { role, prompt: row?.prompt ?? BUILTIN[role], model: row?.model_json ? JSON.parse(row.model_json) : null, reasoningEffort: row?.reasoning_effort ?? null, revision: row?.revision ?? 0 };
  }
  function save(role, values = {}) {
    roleValue(role);
    if (!values || typeof values !== 'object'||Array.isArray(values)||Object.keys(values).some(key=>!['prompt','model','reasoningEffort'].includes(key))) invalid('Invalid settings');
    const prompt = promptValue(values.prompt);
    const model = modelValue(values.model ?? null);
    const reasoningEffort = effortValue(values.reasoningEffort ?? null);
    const revision = get(role).revision + 1;
    db.prepare('UPDATE role_settings SET prompt=?,model_json=?,reasoning_effort=?,revision=? WHERE role=?').run(prompt, model ? JSON.stringify(model) : null, reasoningEffort, revision, role);
    return get(role);
  }
  function bindingRow(row) { return row ? { chatId: row.chat_id, role: row.role, prompt: row.prompt, revision: row.revision } : null; }
  function bind(chatId, role, { existing = false } = {}) {
    chatValue(chatId); roleValue(role);
    const found = db.prepare('SELECT chat_id,role,prompt,revision FROM role_bindings WHERE chat_id=?').get(chatId);
    if (found) return bindingRow(found);
    const source = existing ? { role, prompt: BUILTIN[role], revision: 0 } : get(role);
    const snapshot = validateSnapshot(source, role);
    db.prepare('INSERT INTO role_bindings(chat_id,role,prompt,revision) VALUES(?,?,?,?)').run(chatId, role, snapshot.prompt, snapshot.revision);
    return { chatId, role, prompt: snapshot.prompt, revision: snapshot.revision };
  }
  function getBinding(chatId) {
    chatValue(chatId);
    return bindingRow(db.prepare('SELECT chat_id,role,prompt,revision FROM role_bindings WHERE chat_id=?').get(chatId));
  }
  function applyPrompt(chatId, role, snapshot = get(role)) {
    chatValue(chatId); roleValue(role);
    const checked = validateSnapshot(snapshot, role);
    const binding = bind(chatId, role, { existing: true });
    // Explicit application replaces an absent/stale binding with the caller's atomic snapshot.
    if (binding.prompt !== checked.prompt || binding.revision !== checked.revision) {
      db.prepare('INSERT OR REPLACE INTO role_bindings(chat_id,role,prompt,revision) VALUES(?,?,?,?)').run(chatId, role, checked.prompt, checked.revision);
    }
    const at = new Date().toISOString();
    const id = randomUUID();
    db.prepare('INSERT INTO role_prompt_receipts(id,chat_id,role,revision,at) VALUES(?,?,?,?,?)').run(id, chatId, role, checked.revision, at);
    return { chatId, role, prompt: checked.prompt, revision: checked.revision };
  }
  function listReceipts(chatId) {
    chatValue(chatId);
    return db.prepare('SELECT id,chat_id AS chatId,role,revision,at FROM role_prompt_receipts WHERE chat_id=? ORDER BY at DESC,id DESC LIMIT 20').all(chatId);
  }
  return { get, save, bind, getBinding, applyPrompt, listReceipts, builtins: clone(BUILTIN) };
}

export const builtinRolePrompts = BUILTIN;
export default { createRoleSettings, RoleSettingsError, builtinRolePrompts };
