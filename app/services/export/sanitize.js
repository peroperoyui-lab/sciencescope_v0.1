// Sanitize only the private export snapshot. Discover historical header values
// before rewriting any row, so copies in events and nested JSON are included.
import { hashText } from '../../core/workspace/files.js';

export const REMOVED_VALUE = '<已移除>';

function reference(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof value.keyRef === 'string'
  );
}

// Identity and display fields are not free text, even when their value happens
// to equal a header value. Preserve both relational and embedded references.
function identity(key) {
  return (
    /^(?:id|ids|ref|refs|keyRef|name|title|parent|scope|resource|resourceKey|resource_key|producedFrom|produced_from|attributedTo|attributed_to|createdBy|created_by)$/u.test(
      key,
    ) || /(?:_id|_ids|_ref|_refs|Id|Ids|Ref|Refs)$/u.test(key)
  );
}

function configurationKind(value, scope) {
  if (scope === 'provider') return 'provider';
  if (scope === 'server') return 'server';
  if (typeof value.baseUrl === 'string' && (value.api || Array.isArray(value.models)))
    return 'provider';
  if (
    ['http', 'stdio'].includes(value.transport) &&
    (typeof value.url === 'string' || typeof value.command === 'string')
  )
    return 'server';
  return '';
}

/**
 * @param {import('node:sqlite').DatabaseSync} db Writable private snapshot.
 * @param {any} configuration Current public settings, never credentials.
 * @param {()=>void} check Cancellation checkpoint.
 */
export function sanitizeSnapshot(db, configuration, check) {
  const values = new Set();
  const locations = new Map();
  const discoveries = new Map();
  function count(map, table, column, amount = 1) {
    const key = `${table}\0${column}`;
    const entry = map.get(key) ?? { table, column, rows: 0 };
    entry.rows += amount;
    map.set(key, entry);
  }
  function remember(value) {
    if (typeof value !== 'string' || !value || value === REMOVED_VALUE) return;
    values.add(value);
    const token = /^(?:Bearer|Basic|Token)\s+(.+)$/iu.exec(value);
    if (token) values.add(token[1]);
  }
  function replaceText(value) {
    let result = value;
    for (const sensitive of values) result = result.replaceAll(sensitive, REMOVED_VALUE);
    return result;
  }
  function transform(value, discover, scope = '', protectedValue = false) {
    if (typeof value === 'string') {
      const trimmed = value.trimStart();
      if (['{', '[', '"'].includes(trimmed[0])) {
        try {
          const parsed = JSON.parse(value);
          if (parsed !== value) {
            const result = transform(parsed, discover, scope, protectedValue);
            if (result.changed)
              return { value: JSON.stringify(result.value), changed: true, found: result.found };
            return { value, changed: false, found: result.found };
          }
        } catch {
          /* Plain text remains readable even when it is not JSON. */
        }
      }
      const result = discover || protectedValue ? value : replaceText(value);
      return { value: result, changed: result !== value, found: false };
    }
    if (!value || typeof value !== 'object' || reference(value))
      return { value, changed: false, found: false };
    if (Array.isArray(value)) {
      let changed = false;
      let found = false;
      const result = value.map((entry) => {
        const childScope =
          scope === 'providers' ? 'provider' : scope === 'servers' ? 'server' : scope;
        const next = transform(entry, discover, childScope, protectedValue);
        changed ||= next.changed;
        found ||= next.found;
        return next.value;
      });
      return { value: changed ? result : value, changed, found };
    }
    const kind = configurationKind(value, scope);
    const result = {};
    let changed = false;
    let found = false;
    for (const [key, entry] of Object.entries(value)) {
      if (
        ((key === 'headers' && kind) || (key === 'env' && kind === 'server')) &&
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry)
      ) {
        const fields = {};
        for (const [name, field] of Object.entries(entry)) {
          if (reference(field)) fields[name] = field;
          else {
            if (discover) {
              remember(field);
              fields[name] = field;
            } else fields[name] = REMOVED_VALUE;
            found = true;
            changed ||= !discover && field !== REMOVED_VALUE;
          }
        }
        result[key] = fields;
      } else {
        let childScope = '';
        if (key === 'settings') childScope = 'settings';
        else if (scope === 'settings' && key === 'providers') childScope = 'providers';
        else if ((scope === 'settings' && key === 'mcp') || key === 'mcpServers')
          childScope = 'mcp';
        else if (scope === 'mcp' && key === 'servers') childScope = 'servers';
        const next = transform(entry, discover, childScope, protectedValue || identity(key));
        result[key] = next.value;
        changed ||= next.changed;
        found ||= next.found;
      }
    }
    return { value: changed ? result : value, changed, found };
  }
  const tables = db
    .prepare('PRAGMA table_list')
    .all()
    .filter(
      (table) =>
        table.schema === 'main' &&
        !String(table.name).startsWith('sqlite_') &&
        table.type !== 'shadow',
    )
    .map((table) => {
      const name = String(table.name);
      const quoted = `"${name.replaceAll('"', '""')}"`;
      const definitions = db.prepare(`PRAGMA table_info(${quoted})`).all();
      const foreign = new Set(
        db
          .prepare(`PRAGMA foreign_key_list(${quoted})`)
          .all()
          .map((entry) => entry.from),
      );
      const protectedColumns = new Set(
        definitions
          .filter(
            (column) => column.pk || foreign.has(column.name) || identity(String(column.name)),
          )
          .map((column) => String(column.name)),
      );
      const columns = definitions
        .filter((column) => /TEXT|CHAR|CLOB/iu.test(String(column.type)) || !column.type)
        .map((column) => String(column.name));
      return { name, quoted, columns, protectedColumns };
    })
    .filter((table) => table.columns.length);
  const configurationDiscovery = transform(configuration, true, 'settings');
  if (configurationDiscovery.found) count(discoveries, 'settings.json', 'providers/mcp');
  for (const table of tables) {
    check();
    for (const row of db.prepare(`SELECT * FROM ${table.quoted}`).iterate()) {
      check();
      for (const column of table.columns) {
        if (typeof row[column] !== 'string') continue;
        const scope =
          row.resource === 'settings' &&
          ['before_text', 'after_text', 'content_text'].includes(column)
            ? 'settings'
            : '';
        if (transform(row[column], true, scope, table.protectedColumns.has(column)).found)
          count(discoveries, table.name, column);
      }
    }
  }
  // Replace longer values first when one header value contains another.
  const sorted = [...values].sort((a, b) => b.length - a.length);
  values.clear();
  for (const value of sorted) values.add(value);
  db.exec('BEGIN');
  try {
    for (const table of tables) {
      check();
      const changes = [];
      for (const row of db
        .prepare(`SELECT rowid AS __export_rowid,* FROM ${table.quoted}`)
        .iterate()) {
        check();
        const patch = {};
        for (const column of table.columns) {
          if (typeof row[column] !== 'string') continue;
          const scope =
            row.resource === 'settings' &&
            ['before_text', 'after_text', 'content_text'].includes(column)
              ? 'settings'
              : '';
          const next = transform(row[column], false, scope, table.protectedColumns.has(column));
          if (next.changed) {
            patch[column] = next.value;
            count(locations, table.name, column);
          }
        }
        if (Object.keys(patch).length) changes.push({ id: row.__export_rowid, patch });
      }
      for (const { id, patch } of changes) {
        const entries = Object.entries(patch);
        db.prepare(
          `UPDATE ${table.quoted} SET ${entries.map(([column]) => `"${column.replaceAll('"', '""')}"=?`).join(',')} WHERE rowid=?`,
        ).run(...entries.map(([, value]) => value), id);
      }
    }
    // These hashes describe the exported text rather than the original secret-bearing text.
    for (const row of db.prepare('SELECT rowid,after_text,after_hash FROM revisions').all()) {
      const hash = hashText(row.after_text == null ? null : String(row.after_text));
      if (hash !== row.after_hash) {
        db.prepare('UPDATE revisions SET after_hash=? WHERE rowid=?').run(hash, row.rowid);
        count(locations, 'revisions', 'after_hash');
      }
    }
    for (const row of db
      .prepare('SELECT rowid,content_text,content_hash FROM resource_snapshots')
      .all()) {
      const hash = hashText(row.content_text == null ? null : String(row.content_text));
      if (hash !== row.content_hash) {
        db.prepare('UPDATE resource_snapshots SET content_hash=? WHERE rowid=?').run(
          hash,
          row.rowid,
        );
        count(locations, 'resource_snapshots', 'content_hash');
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const result = transform(configuration, false, 'settings');
  if (result.changed) count(locations, 'settings.json', 'providers/mcp');
  return {
    configuration: result.value,
    statistics: {
      replacement: REMOVED_VALUE,
      headerValues: values.size,
      discovered: [...discoveries.values()],
      modified: [...locations.values()],
      hashColumns: ['revisions.after_hash', 'resource_snapshots.content_hash'],
      originalDatabaseModified: false,
    },
  };
}
