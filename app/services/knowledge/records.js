import { projectEntity } from './projection.js';
import { AppError } from '../../core/errors.js';
import { indexText } from '../research/text-index.js';
import { payloadText } from '../research/records.js';

const tables = {
  entity: { table: 'kb_entities', keys: ['id'] },
  edge: { table: 'kb_edges', keys: ['id'] },
  label: { table: 'kb_labels', keys: ['ref', 'label'] },
  membership: { table: 'kb_memberships', keys: ['project_id', 'ref'] },
  item: { table: 'rb_items', keys: ['id'] },
};

/**
 * Composite labels encode only their label component, so '#' in user text is reversible.
 * @param {string} kind
 * @param {string[]} values
 * @returns {string}
 */
export function recordRef(kind, ...values) {
  return (
    kind +
    ':' +
    (kind === 'label' ? values[0] + '#' + encodeURIComponent(values[1]) : values.join('#'))
  );
}

function location(ref) {
  const colon = ref.indexOf(':');
  const kind = ref.slice(0, colon);
  const spec = tables[kind];
  if (!spec) throw new AppError('KNOWLEDGE_REF_INVALID', 'Unknown knowledge record reference.');
  const values = ref
    .slice(colon + 1)
    .split('#')
    .map(decodeURIComponent);
  return { ...spec, values, where: spec.keys.map((key) => `${key} = ?`).join(' AND ') };
}

/**
 * A small persistence boundary for snapshots; history stores complete database rows.
 * @param {import('../../core/db/database.js').Db} db
 * @returns {{read:(ref:string)=>any, write:(ref:string,row:any)=>void, requireNode:(ref:string)=>any}}
 */
export function createRecords(db) {
  function read(ref) {
    const target = location(ref);
    return (
      db.prepare(`SELECT * FROM ${target.table} WHERE ${target.where}`).get(...target.values) ??
      null
    );
  }

  function write(ref, row) {
    const target = location(ref);
    if (!row) {
      db.prepare(`DELETE FROM ${target.table} WHERE ${target.where}`).run(...target.values);
      if (target.table === 'kb_entities') projectEntity(db, target.values[0], null);
      return;
    }
    const columns = Object.keys(row);
    const updates = columns.filter((column) => !target.keys.includes(column));
    db.prepare(
      `INSERT INTO ${target.table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})
      ON CONFLICT(${target.keys.join(',')}) DO UPDATE SET ${updates.map((column) => `${column}=excluded.${column}`).join(',')}`,
    ).run(...columns.map((column) => row[column]));
    if (target.table === 'kb_entities') projectEntity(db, row.id, row);
    if (target.table === 'rb_items') {
      db.prepare("DELETE FROM rb_fts WHERE doc_type='item' AND doc_id=?").run(row.id);
      if (row.status === 'active')
        db.prepare(
          "INSERT INTO rb_fts(doc_type,doc_id,project_id,title,body) VALUES('item',?,?,?,?)",
        ).run(
          row.id,
          row.project_id,
          indexText(row.title),
          indexText(row.body + '\n' + payloadText(JSON.parse(row.payload_json))),
        );
    }
  }

  function requireNode(ref) {
    const colon = ref.indexOf(':');
    const kind = ref.slice(0, colon),
      id = ref.slice(colon + 1);
    const table = {
      entity: 'kb_entities',
      source: 'rb_sources',
      item: 'rb_items',
      chunk: 'rb_chunks',
      edge: 'kb_edges',
    }[kind];
    const row = table ? db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) : null;
    if (!row || (kind === 'item' && row.type === 'memory'))
      throw new AppError('KNOWLEDGE_NODE_NOT_FOUND', 'Knowledge node does not exist.', 404);
    return row;
  }
  return { read, write, requireNode };
}

/**
 * Public records use camelCase and decoded JSON; stored snapshots retain the exact schema.
 * @param {any} row
 * @returns {any}
 */
export function publicRow(row) {
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      const json = key.endsWith('_json');
      const name = (json ? key.slice(0, -5) : key).replace(/_([a-z])/g, (_match, letter) =>
        letter.toUpperCase(),
      );
      return [name, json ? JSON.parse(String(value)) : value];
    }),
  );
}
