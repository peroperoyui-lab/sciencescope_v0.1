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
    if (options.label) {
      clauses.push(
        "EXISTS (SELECT 1 FROM kb_labels l WHERE l.ref='entity:'||kb_entities.id AND l.label=?)",
      );
      values.push(options.label);
    }
    if (options.origin) {
      clauses.push('origin=?');
      values.push(options.origin);
    }
    if (options.query ?? options.q) {
      clauses.push('(name LIKE ? OR name_en LIKE ? OR aliases_json LIKE ?)');
      values.push(...Array(3).fill('%' + (options.query ?? options.q) + '%'));
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
  function degree(ref) {
    return Number(
      db
        .prepare(
          "SELECT count(*) AS n FROM kb_edges WHERE status='active' AND (from_ref=? OR to_ref=?)",
        )
        .get(ref, ref).n,
    );
  }
  function describe(ref, snapshot) {
    const [type, id] = ref.split(':');
    const table = {
      entity: 'kb_entities',
      source: 'rb_sources',
      item: 'rb_items',
      chunk: 'rb_chunks',
      edge: 'kb_edges',
    }[type];
    const row = snapshot ?? (table && db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id));
    return {
      ref,
      name: row?.name ?? row?.title ?? row?.relation ?? row?.label ?? ref,
      kind: row?.kind ?? row?.type ?? type,
    };
  }
  function createdBy(row) {
    if (row.origin !== 'ai') return undefined;
    const participant = db.prepare('SELECT name FROM participants WHERE id=?').get(row.createdBy);
    const meeting = db.prepare('SELECT title FROM meetings WHERE id=?').get(row.meetingId);
    const message = db
      .prepare('SELECT id FROM messages WHERE turn_id=? ORDER BY seq LIMIT 1')
      .get(row.turnId);
    return {
      participantId: row.createdBy,
      ...(participant ? { name: participant.name } : {}),
      meetingId: row.meetingId,
      ...(meeting ? { meetingTitle: meeting.title } : {}),
      turnId: row.turnId,
      ...(message ? { messageId: message.id } : {}),
    };
  }
  function evidence(input) {
    const value = typeof input === 'string' ? { ref: input } : (input ?? {});
    const [type, id] = String(value.ref).split(':');
    if (type === 'chunk') {
      const row = db
        .prepare(
          'SELECT c.*,s.title FROM rb_chunks c JOIN rb_sources s ON s.id=c.source_id WHERE c.id=?',
        )
        .get(id);
      if (row)
        return {
          ...value,
          sourceId: row.source_id,
          title: row.title,
          ...(row.page == null ? {} : { page: row.page }),
          quote: value.quote ?? row.text,
        };
    }
    if (type === 'message') {
      const row = db
        .prepare(
          'SELECT m.*,t.title FROM messages m LEFT JOIN meetings t ON t.id=m.meeting_id WHERE m.id=?',
        )
        .get(id);
      if (row)
        return {
          ...value,
          meetingId: row.meeting_id,
          meetingTitle: row.title,
          messageId: row.id,
          excerpt: value.quote ?? row.text,
        };
    }
    return { ...value, missing: true };
  }
  function edgeDetails(row, ref) {
    return {
      ...row,
      createdBy: createdBy(row),
      // HTTP edits and preserved revisions may contain a single evidence object.
      evidence: [].concat(row.evidence ?? []).map(evidence),
      ...(ref ? { peer: describe(row.fromRef === ref ? row.toRef : row.fromRef) } : {}),
    };
  }
  function entityDetails(id, options = {}) {
    const ref = 'entity:' + id;
    const { entity, edges } = getEntity(ref, {
      offset: options.edgesOffset,
      limit: options.edgesLimit,
    });
    const rows = edges.rows.map((row) => edgeDetails(row, ref));
    const groups = [];
    for (const relation of new Set(rows.map((row) => row.relation)))
      groups.push({ relation, rows: rows.filter((row) => row.relation === relation) });
    return {
      entity: { ...entity, degree: degree(ref), createdBy: createdBy(entity) },
      labels: labels(ref),
      memberships: memberships(ref),
      edges: { ...edges, rows, groups },
    };
  }
  function listEntityDetails(options = {}) {
    const result = listEntities(options);
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        degree: degree('entity:' + row.id),
        createdBy: createdBy(row),
      })),
    };
  }
  function revisionDetails(row) {
    return { ...row, ...describe(row.ref, row.after ?? row.before) };
  }
  return {
    getEntity,
    listEntities,
    neighbors,
    labels,
    memberships,
    degree,
    entityDetails,
    listEntityDetails,
    revisionDetails,
    getEdge: (id) => publicRow(records.requireNode('edge:' + id)),
  };
}
