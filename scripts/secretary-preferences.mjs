export const DEFAULT_NOTES_TEMPLATE = '# 版本说明\n比较对象\n本次变化\n与当前研究的关系\n待用户决定\n相关导图节点与文件';
// The built-in template follows the interface language until the user saves their own.
export const DEFAULT_NOTES_TEMPLATES = Object.freeze({
  'zh-CN': DEFAULT_NOTES_TEMPLATE,
  en: '# Version notes\nCompared with\nWhat changed\nRelation to the current research\nFor the user to decide\nRelated map nodes and files',
});

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

function validatePatch(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.keys(patch).some((key) => key !== 'notesTemplate') ||
      typeof patch.notesTemplate !== 'string' || patch.notesTemplate.trim().length === 0 ||
      patch.notesTemplate.length > 16000) {
    throw invalidPreferences('notesTemplate must be a non-empty string of at most 16000 characters');
  }
}

export function createSecretaryPreferences({ db } = {}) {
  assertDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS secretary_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      notes_template TEXT NOT NULL
    )
  `);
  const select = db.prepare('SELECT notes_template FROM secretary_preferences WHERE id = 1');
  const upsert = db.prepare(`
    INSERT INTO secretary_preferences (id, notes_template) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET notes_template = excluded.notes_template
  `);

  function get({ language = 'zh-CN' } = {}) {
    const row = select.get();
    return { notesTemplate: row?.notes_template ?? DEFAULT_NOTES_TEMPLATES[language] ?? DEFAULT_NOTES_TEMPLATE };
  }

  function save(patch) {
    validatePatch(patch);
    db.exec('BEGIN IMMEDIATE');
    try {
      upsert.run(patch.notesTemplate);
      db.exec('COMMIT');
      return { notesTemplate: patch.notesTemplate };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  return Object.freeze({ get, save });
}

export default { createSecretaryPreferences, DEFAULT_NOTES_TEMPLATE };
