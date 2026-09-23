const DEFAULT_ASSISTANT_WINDOW_PREFERENCES = Object.freeze({ startup: 'closed' });
const STARTUP_MODES = new Set(['closed', 'orb', 'expanded']);

function invalidPreferences(message) {
  const error = new Error(message);
  error.code = 'INVALID_ASSISTANT_WINDOW_PREFERENCES';
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
      Object.keys(patch).length !== 1 || !Object.hasOwn(patch, 'startup') ||
      !STARTUP_MODES.has(patch.startup)) {
    throw invalidPreferences("startup must be one of 'closed', 'orb', or 'expanded'");
  }
}

export function createAssistantWindowPreferences({ db } = {}) {
  assertDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_window_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      startup TEXT NOT NULL CHECK (startup IN ('closed', 'orb', 'expanded'))
    )
  `);
  const select = db.prepare('SELECT startup FROM assistant_window_preferences WHERE id = 1');
  const upsert = db.prepare(`
    INSERT INTO assistant_window_preferences (id, startup) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET startup = excluded.startup
  `);

  function get() {
    const row = select.get();
    return { startup: row?.startup ?? DEFAULT_ASSISTANT_WINDOW_PREFERENCES.startup };
  }

  function save(patch) {
    validatePatch(patch);
    db.exec('BEGIN IMMEDIATE');
    try {
      upsert.run(patch.startup);
      db.exec('COMMIT');
      return { startup: patch.startup };
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  return Object.freeze({ get, save });
}

export { DEFAULT_ASSISTANT_WINDOW_PREFERENCES };
export default { createAssistantWindowPreferences, DEFAULT_ASSISTANT_WINDOW_PREFERENCES };
