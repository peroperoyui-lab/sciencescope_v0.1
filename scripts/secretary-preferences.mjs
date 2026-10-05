export const DEFAULT_NOTES_TEMPLATE = '# 版本说明\n比较对象\n本次变化\n与当前研究的关系\n待用户决定\n相关导图节点与文件';

// The built-in template follows the interface language until the user saves
// an explicit template. Summary preferences are language-independent.
export const DEFAULT_NOTES_TEMPLATES = Object.freeze({
  'zh-CN': DEFAULT_NOTES_TEMPLATE,
  en: '# Version notes\nCompared with\nWhat changed\nRelation to the current research\nFor the user to decide\nRelated map nodes and files',
});

export const DEFAULT_SUMMARY = Object.freeze({
  afterDiscussion: true,
  everyMessages: Object.freeze({ enabled: true, n: 20 }),
  everyTokens: Object.freeze({ enabled: true, n: 30000 }),
  onEnterProject: true,
  onLeaveProject: true,
  saveMarkdown: true,
  workbench: Object.freeze({ map: 'off', versions: 'off', plans: 'off', log: 'off' }),
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function invalidPreferences(message) {
  const error = new Error(message);
  error.code = 'INVALID_SECRETARY_PREFERENCES';
  error.status = 400;
  return error;
}

function assertDatabase(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw invalidPreferences('A node:sqlite DatabaseSync handle is required');
  }
}

function booleanValue(value, label) {
  if (typeof value !== 'boolean') throw invalidPreferences(`${label} must be true or false`);
  return value;
}

function threshold(value, label, min, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidPreferences(`${label} must be an object`);
  const keys = Object.keys(value);
  if (keys.some((key) => !['enabled', 'n'].includes(key))) throw invalidPreferences(`${label} has an unknown field`);
  if (value.enabled !== undefined) booleanValue(value.enabled, `${label}.enabled`);
  if (value.n !== undefined && (!Number.isInteger(value.n) || value.n < min || value.n > max)) throw invalidPreferences(`${label}.n must be an integer from ${min} to ${max}`);
}

function validateSummaryPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidPreferences('summary must be an object');
  const allowed = new Set(['afterDiscussion', 'everyMessages', 'everyTokens', 'onEnterProject', 'onLeaveProject', 'saveMarkdown', 'workbench']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw invalidPreferences('summary has an unknown field');
  for (const key of ['afterDiscussion', 'onEnterProject', 'onLeaveProject', 'saveMarkdown']) if (value[key] !== undefined) booleanValue(value[key], `summary.${key}`);
  if (value.everyMessages !== undefined) threshold(value.everyMessages, 'summary.everyMessages', 4, 500);
  if (value.everyTokens !== undefined) threshold(value.everyTokens, 'summary.everyTokens', 2000, 500000);
  if (value.workbench !== undefined) {
    if (!value.workbench || typeof value.workbench !== 'object' || Array.isArray(value.workbench)) throw invalidPreferences('summary.workbench must be an object');
    const keys = Object.keys(value.workbench);
    if (keys.some((key) => !['map', 'versions', 'plans', 'log'].includes(key))) throw invalidPreferences('summary.workbench has an unknown field');
    for (const key of keys) if (!['off', 'propose', 'apply'].includes(value.workbench[key])) throw invalidPreferences(`summary.workbench.${key} must be off, propose, or apply`);
  }
}

function mergeSummary(base, patch) {
  validateSummaryPatch(patch);
  return {
    ...base,
    ...patch,
    everyMessages: { ...base.everyMessages, ...(patch.everyMessages || {}) },
    everyTokens: { ...base.everyTokens, ...(patch.everyTokens || {}) },
    workbench: { ...base.workbench, ...(patch.workbench || {}) },
  };
}

function parseSummary(raw) {
  if (!raw) return clone(DEFAULT_SUMMARY);
  try {
    const value = JSON.parse(raw);
    return mergeSummary(clone(DEFAULT_SUMMARY), value);
  } catch {
    return clone(DEFAULT_SUMMARY);
  }
}

export function getDefaultSummary() { return clone(DEFAULT_SUMMARY); }

export function createSecretaryPreferences({ db } = {}) {
  assertDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS secretary_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      notes_template TEXT NOT NULL
    )
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(secretary_preferences)').all().map((column) => column.name));
  if (!columns.has('summary_json')) db.exec('ALTER TABLE secretary_preferences ADD COLUMN summary_json TEXT');
  const select = db.prepare('SELECT notes_template,summary_json FROM secretary_preferences WHERE id = 1');
  const upsert = db.prepare(`
    INSERT INTO secretary_preferences (id, notes_template, summary_json) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET notes_template = excluded.notes_template, summary_json = excluded.summary_json
  `);

  function get({ language = 'zh-CN' } = {}) {
    const row = select.get();
    const notesTemplate = row?.notes_template?.trim() ? row.notes_template : DEFAULT_NOTES_TEMPLATES[language] ?? DEFAULT_NOTES_TEMPLATE;
    return { notesTemplate, summary: parseSummary(row?.summary_json) };
  }

  function save(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some((key) => !['notesTemplate', 'summary'].includes(key)) || (!Object.hasOwn(patch, 'notesTemplate') && !Object.hasOwn(patch, 'summary'))) {
      throw invalidPreferences('Only notesTemplate and summary may be changed');
    }
    if (Object.hasOwn(patch, 'notesTemplate') && (typeof patch.notesTemplate !== 'string' || !patch.notesTemplate.trim() || patch.notesTemplate.length > 16000)) throw invalidPreferences('notesTemplate must be a non-empty string of at most 16000 characters');
    const current = get();
    // Keep an empty legacy value as the language-following sentinel. Do not
    // materialize the current UI language when only summary settings change.
    const stored = select.get();
    const summary = patch.summary === undefined ? current.summary : mergeSummary(current.summary, patch.summary);
    const notesTemplate = patch.notesTemplate === undefined ? (stored?.notes_template ?? '') : patch.notesTemplate;
    db.exec('BEGIN IMMEDIATE');
    try {
      upsert.run(notesTemplate, JSON.stringify(summary));
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
    return { ...(Object.hasOwn(patch, 'notesTemplate') ? { notesTemplate } : {}), ...(Object.hasOwn(patch, 'summary') ? { summary } : {}) };
  }

  return Object.freeze({ get, save, getDefaultSummary });
}

export default { createSecretaryPreferences, DEFAULT_NOTES_TEMPLATE, DEFAULT_NOTES_TEMPLATES, DEFAULT_SUMMARY, getDefaultSummary };
