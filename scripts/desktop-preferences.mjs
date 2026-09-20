const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'light',
  density: 'standard',
  codeFontSize: 14,
  chatFontSize: 16,
  sendKey: 'enter',
  reduceMotion: false,
  showScrollbars: false,
});

const THEMES = new Set(['light', 'dark', 'system']);
const DENSITIES = new Set(['standard', 'compact']);
const CODE_FONT_SIZES = new Set([12, 13, 14, 15, 16, 18]);
const CHAT_FONT_SIZES = new Set([14, 15, 16, 18, 20]);
const SEND_KEYS = new Set(['enter', 'ctrl-enter']);

function invalidPreferences(message) {
  const error = new Error(message);
  error.code = 'INVALID_PREFERENCES';
  error.status = 400;
  return error;
}

function assertDatabase(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw invalidPreferences('A node:sqlite DatabaseSync handle is required');
  }
}

function validatePatch(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw invalidPreferences('Preferences patch must be an object');
  }

  const allowed = new Set(Object.keys(DEFAULT_PREFERENCES));
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw invalidPreferences(`Unknown preference: ${key}`);
  }
  if ('theme' in patch && !THEMES.has(patch.theme)) {
    throw invalidPreferences("theme must be one of 'light', 'dark', or 'system'");
  }
  if ('density' in patch && !DENSITIES.has(patch.density)) {
    throw invalidPreferences("density must be 'standard' or 'compact'");
  }
  if ('codeFontSize' in patch && !CODE_FONT_SIZES.has(patch.codeFontSize)) {
    throw invalidPreferences('codeFontSize must be one of 12, 13, 14, 15, 16, or 18');
  }
  if ('chatFontSize' in patch && !CHAT_FONT_SIZES.has(patch.chatFontSize)) {
    throw invalidPreferences('chatFontSize must be one of 14, 15, 16, 18, or 20');
  }
  if ('sendKey' in patch && !SEND_KEYS.has(patch.sendKey)) {
    throw invalidPreferences("sendKey must be 'enter' or 'ctrl-enter'");
  }
  if ('reduceMotion' in patch && typeof patch.reduceMotion !== 'boolean') {
    throw invalidPreferences('reduceMotion must be a boolean');
  }
  if ('showScrollbars' in patch && typeof patch.showScrollbars !== 'boolean') {
    throw invalidPreferences('showScrollbars must be a boolean');
  }
}

function readRow(statement) {
  const row = statement.get();
  if (!row) return { ...DEFAULT_PREFERENCES };
  return {
    theme: row.theme,
    density: row.density,
    codeFontSize: Number(row.code_font_size),
    chatFontSize: Number(row.chat_font_size),
    sendKey: row.send_key,
    reduceMotion: row.reduce_motion === 1,
    showScrollbars: row.show_scrollbars === 1,
  };
}

export function createDesktopPreferences({ db, dataRoot } = {}) {
  assertDatabase(db);
  void dataRoot;
  db.exec(`
    CREATE TABLE IF NOT EXISTS desktop_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      theme TEXT NOT NULL DEFAULT 'light',
      density TEXT NOT NULL DEFAULT 'standard',
      code_font_size INTEGER NOT NULL DEFAULT 14,
      chat_font_size INTEGER NOT NULL,
      send_key TEXT NOT NULL,
      reduce_motion INTEGER NOT NULL,
      show_scrollbars INTEGER NOT NULL
    )
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(desktop_preferences)').all().map((column) => column.name));
  if (!columns.has('theme')) db.exec("ALTER TABLE desktop_preferences ADD COLUMN theme TEXT NOT NULL DEFAULT 'light'");
  if (!columns.has('density')) db.exec("ALTER TABLE desktop_preferences ADD COLUMN density TEXT NOT NULL DEFAULT 'standard'");
  if (!columns.has('code_font_size')) db.exec('ALTER TABLE desktop_preferences ADD COLUMN code_font_size INTEGER NOT NULL DEFAULT 14');
  const select = db.prepare(`
    SELECT theme, density, code_font_size, chat_font_size, send_key, reduce_motion, show_scrollbars
    FROM desktop_preferences WHERE id = 1
  `);
  const upsert = db.prepare(`
    INSERT INTO desktop_preferences
      (id, theme, density, code_font_size, chat_font_size, send_key, reduce_motion, show_scrollbars)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      theme = excluded.theme,
      density = excluded.density,
      code_font_size = excluded.code_font_size,
      chat_font_size = excluded.chat_font_size,
      send_key = excluded.send_key,
      reduce_motion = excluded.reduce_motion,
      show_scrollbars = excluded.show_scrollbars
  `);

  return Object.freeze({
    get() { return readRow(select); },
    save(patch) {
      validatePatch(patch);
      db.exec('BEGIN IMMEDIATE');
      try {
        const next = { ...readRow(select), ...patch };
        upsert.run(next.theme, next.density, next.codeFontSize, next.chatFontSize, next.sendKey, next.reduceMotion ? 1 : 0, next.showScrollbars ? 1 : 0);
        db.exec('COMMIT');
        return { ...next };
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
        throw error;
      }
    },
    reset() {
      db.exec('BEGIN IMMEDIATE');
      try {
        upsert.run(DEFAULT_PREFERENCES.theme, DEFAULT_PREFERENCES.density, DEFAULT_PREFERENCES.codeFontSize, DEFAULT_PREFERENCES.chatFontSize, DEFAULT_PREFERENCES.sendKey, DEFAULT_PREFERENCES.reduceMotion ? 1 : 0, DEFAULT_PREFERENCES.showScrollbars ? 1 : 0);
        db.exec('COMMIT');
        return { ...DEFAULT_PREFERENCES };
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* preserve original error */ }
        throw error;
      }
    },
  });
}

export { DEFAULT_PREFERENCES };
