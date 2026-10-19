import { AppError } from '../../core/errors.js';
import { publicRow } from './records.js';

/**
 * Queries page one hop; graph expansion and ranking belong to later services.
 * @param {import('../../core/index.js').Core} core
 * @param {ReturnType<typeof import('./records.js').createRecords>} records
 * @returns {any}
 */
export function createKnowledgeQueries(core, records) {
  const { db } = core;
  function page(table, clauses, values, options) {
    const offset = Math.max(0, Math.floor(options.offset ?? 0)),
      limit = Math.max(1, Math.floor(options.limit ?? 50));
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const total = Number(
      db.prepare(`SELECT count(*) AS n FROM ${table} ${where}`).get(...values).n,
    );
    const rows = db
      .prepare(`SELECT * FROM ${table} ${where} ORDER BY id LIMIT ? OFFSET ?`)
      .all(...values, limit, offset)
      .map(publicRow);
    return { rows, total, remaining: Math.max(0, total - offset - rows.length), offset, limit };
  }
  function listEntities(options = {}) {
    const clauses = ["status='active'"],
      values = [];
    if (options.projectId) {
      clauses.push(
        "EXISTS (SELECT 1 FROM kb_memberships m WHERE m.project_id=? AND m.ref='entity:'||kb_entities.id)",
      );
      values.push(options.projectId);
    }
    if (options.kind) {
      clauses.push('kind=?');
      values.push(options.kind);
    }
    if (options.audience === 'agent') clauses.push("visibility<>'private'");
    if (options.query) {
      clauses.push('(name LIKE ? OR name_en LIKE ? OR aliases_json LIKE ?)');
      values.push(...Array(3).fill('%' + options.query + '%'));
    }
    return page('kb_entities', clauses, values, options);
  }
  function neighbors(ref, options = {}) {
    records.requireNode(ref);
    const clauses = ["status='active'", '(from_ref=? OR to_ref=?)'],
      values = [ref, ref];
    for (const [key, column] of [
      ['relations', 'relation'],
      ['layers', 'layer'],
    ])
      if (options[key]?.length) {
        clauses.push(`${column} IN (${options[key].map(() => '?').join(',')})`);
        values.push(...options[key]);
      }
    if (options.audience === 'agent')
      for (const column of ['from_ref', 'to_ref']) {
        clauses.push(
          `NOT EXISTS (SELECT 1 FROM kb_entities e WHERE 'entity:'||e.id=${column} AND e.visibility='private')`,
        );
        clauses.push(
          `NOT EXISTS (SELECT 1 FROM rb_items i WHERE 'item:'||i.id=${column} AND i.visibility='private')`,
        );
      }
    return page('kb_edges', clauses, values, options);
  }
  function getEntity(ref, options = {}) {
    if (!ref.startsWith('entity:'))
      throw new AppError('KNOWLEDGE_REF_INVALID', 'Expected an entity reference.');
    const entity = publicRow(records.requireNode(ref));
    if (options.audience === 'agent' && entity.visibility === 'private')
      throw new AppError('KNOWLEDGE_NODE_NOT_FOUND', 'Knowledge node does not exist.', 404);
    return { entity, edges: neighbors(ref, options) };
  }
  const labels = (ref) =>
    db.prepare('SELECT * FROM kb_labels WHERE ref=? ORDER BY label').all(ref).map(publicRow);
  const memberships = (ref) =>
    db
      .prepare('SELECT * FROM kb_memberships WHERE ref=? ORDER BY project_id')
      .all(ref)
      .map(publicRow);
  return {
    getEntity,
    listEntities,
    neighbors,
    labels,
    memberships,
    getEdge: (id) => publicRow(records.requireNode('edge:' + id)),
  };
}
