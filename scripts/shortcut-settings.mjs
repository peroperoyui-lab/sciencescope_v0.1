const BINDING_NAMES = ["search", "browse", "newChat", "independentChat"];

export const DEFAULT_BINDINGS = Object.freeze({
  search: "Ctrl+K",
  browse: "Ctrl+Shift+K",
  newChat: "Ctrl+N",
  independentChat: "Ctrl+Alt+N",
});

const FORBIDDEN = new Set([
  "Ctrl+A", "Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+Z", "Ctrl+Y",
  "Ctrl+F", "Ctrl+H", "Ctrl+S", "Ctrl+O", "Ctrl+P", "Ctrl+R",
  "Ctrl+L", "Ctrl+J", "Ctrl+U", "Ctrl+W", "Ctrl+Q", "Ctrl+T",
  "Ctrl+Shift+I", "Ctrl+Shift+J", "Ctrl+Shift+C", "Ctrl+Alt+Delete",
]);

export class ShortcutSettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = "ShortcutSettingsError";
    this.code = "INVALID_SHORTCUTS";
    this.status = 400;
  }
}

function invalid(message) {
  throw new ShortcutSettingsError(message);
}

function validateBindings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid("bindings must be an object");
  }
  const keys = Object.keys(input);
  if (keys.length !== BINDING_NAMES.length || BINDING_NAMES.some((name) => !keys.includes(name))) {
    invalid("bindings must contain exactly search, browse, newChat, and independentChat");
  }
  const values = BINDING_NAMES.map((name) => input[name]);
  for (const value of values) {
    if (typeof value !== "string" || !/^Ctrl(?:\+Alt)?(?:\+Shift)?\+[A-Z]$/.test(value) || FORBIDDEN.has(value)) {
      invalid(`invalid shortcut: ${String(value)}`);
    }
  }
  if (new Set(values).size !== values.length) {
    invalid("shortcut bindings must be unique");
  }
  return Object.fromEntries(BINDING_NAMES.map((name) => [name, input[name]]));
}

function readRow(db) {
  const row = db.prepare("SELECT settings_json FROM shortcut_settings WHERE id = 1").get();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.settings_json);
    return validateBindings(parsed.bindings);
  } catch (error) {
    if (error instanceof ShortcutSettingsError) throw error;
    return null;
  }
}

export function createShortcutSettings({ db }) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("db must be a synchronous SQLite database");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS shortcut_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    settings_json TEXT NOT NULL
  )`);

  function get() {
    const bindings = readRow(db) ?? DEFAULT_BINDINGS;
    return { bindings: { ...bindings } };
  }

  function save(settings) {
    const bindings = validateBindings(settings?.bindings);
    const json = JSON.stringify({ bindings });
    db.prepare(`INSERT INTO shortcut_settings (id, settings_json) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json`).run(json);
    return { bindings: { ...bindings } };
  }

  function reset() {
    const json = JSON.stringify({ bindings: DEFAULT_BINDINGS });
    db.prepare(`INSERT INTO shortcut_settings (id, settings_json) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json`).run(json);
    return { bindings: { ...DEFAULT_BINDINGS } };
  }

  return { get, save, reset };
}
