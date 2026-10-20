import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { publicRow } from './records.js';

/**
 * A graph page carries identities and relationships, never source bodies or evidence.
 * Expansion visits each node once; paths reuse that traversal instead of enumerating cycles.
 * @param {import('../../core/db/database.js').Db} db
 * @param {any} options
 * @returns {any}
 */
export function createGraphView(db, options = {}) {
  const cache = new Map();
  const edgeCache = new Map();
  const folderPrefix = `folder:${options.projectId}/`;
  function node(ref) {
    if (cache.has(ref)) return cache.get(ref);
    const separator = ref.indexOf(':');
    const type = ref.slice(0, separator);
    const id = ref.slice(separator + 1);
    let value;
    if (type === 'folder' && options.projectId && ref.startsWith(folderPrefix)) {
      value = { ref, name: ref.slice(folderPrefix.length) || '/', kind: 'folder' };
    } else {
      const table = {
        source: 'rb_sources',
        chunk: 'rb_chunks',
        item: 'rb_items',
        entity: 'kb_entities',
      }[type];
      const row = table && db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
      if (
        row &&
        row.visibility !== 'private' &&
        (!row.status || row.status === 'active') &&
        !(type === 'item' && row.type === 'memory')
      ) {
        value = {
          ref,
          name: row.name ?? row.title ?? `Passage ${row.ordinal}`,
          kind: row.kind ?? row.type,
        };
        if (type === 'source') value.name = row.title;
      }
    }
    cache.set(ref, value);
    return value;
  }
  function inProject(ref) {
    if (!options.projectId) return true;
    if (ref.startsWith(folderPrefix)) return true;
    if (
      db
        .prepare('SELECT 1 FROM kb_memberships WHERE project_id=? AND ref=?')
        .get(options.projectId, ref)
    )
      return true;
    const [type, id] = ref.split(':');
    const table = { source: 'rb_sources', item: 'rb_items' }[type];
    if (table)
      return Boolean(
        db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND project_id=?`).get(id, options.projectId),
      );
    return (
      type === 'chunk' &&
      Boolean(
        db
          .prepare(
            'SELECT 1 FROM rb_chunks c JOIN rb_sources s ON s.id=c.source_id WHERE c.id=? AND s.project_id=?',
          )
          .get(id, options.projectId),
      )
    );
  }
  function folderEdges(ref) {
    if (
      !options.projectId ||
      (ref && !ref.startsWith('source:') && !ref.startsWith(folderPrefix)) ||
      (options.relations?.length && !options.relations.includes('in-folder')) ||
      (options.layers?.length && !options.layers.includes('derived'))
    )
      return [];
    const sources = ref?.startsWith('source:')
      ? db
          .prepare('SELECT id,folder_path FROM rb_sources WHERE project_id=? AND id=?')
          .all(options.projectId, ref.slice(7))
      : db
          .prepare(
            'SELECT id,folder_path FROM rb_sources WHERE project_id=? AND folder_path IS NOT NULL',
          )
          .all(options.projectId);
    return sources
      .filter((source) => source.folder_path)
      .map((source) => {
        const directory = path.posix.dirname(String(source.folder_path).replaceAll('\\', '/'));
        return {
          id: `folder:${source.id}`,
          from: 'source:' + source.id,
          to: folderPrefix + (directory === '.' ? '' : directory),
          relation: 'in-folder',
          layer: 'derived',
        };
      })
      .filter((edge) => !ref || edge.from === ref || edge.to === ref);
  }
  function edges(ref) {
    if (edgeCache.has(ref)) return edgeCache.get(ref);
    const clauses = ["status='active'"];
    const values = [];
    if (ref) {
      clauses.push('(from_ref=? OR to_ref=?)');
      values.push(ref, ref);
    }
    for (const [key, column] of [
      ['relations', 'relation'],
      ['layers', 'layer'],
    ])
      if (options[key]?.length) {
        clauses.push(`${column} IN (${options[key].map(() => '?').join(',')})`);
        values.push(...options[key]);
      }
    const result = [
      ...db
        .prepare(
          `SELECT id,from_ref,to_ref,relation,layer FROM kb_edges WHERE ${clauses.join(' AND ')} ORDER BY id`,
        )
        .all(...values)
        .map((edge) => ({
          id: edge.id,
          from: String(edge.from_ref),
          to: String(edge.to_ref),
          relation: edge.relation,
          layer: edge.layer,
        })),
      ...folderEdges(ref),
    ].filter(
      (edge) => node(edge.from) && node(edge.to) && (inProject(edge.from) || inProject(edge.to)),
    );
    edgeCache.set(ref, result);
    return result;
  }
  function describe(ref) {
    const value = node(ref);
    return value ? { ...value, degree: edges(ref).length } : null;
  }
  return { node, edges, describe };
}

/**
 * Keep entity detail separate from graph traversal and page its connected edges.
 * @param {import('../../core/db/database.js').Db} db
 * @param {any} input
 * @returns {any}
 */
export function readKnowledgeEntity(db, input) {
  const id = String(input.id ?? '').replace(/^entity:/u, '');
  const entity = publicRow(db.prepare('SELECT * FROM kb_entities WHERE id=?').get(id));
  if (!entity || (input.audience === 'agent' && entity.visibility === 'private'))
    throw new AppError('KNOWLEDGE_NODE_NOT_FOUND', 'Knowledge entity does not exist.', 404);
  const description = entity.description;
  let descriptionRemaining = 0;
  if (!input.full) {
    entity.description = description.split(/\r?\n/u)[0];
    descriptionRemaining = Array.from(description.slice(entity.description.length)).length;
  }
  const ref = 'entity:' + id;
  const view = createGraphView(db, input);
  const connected = view.edges(ref);
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const limit = Math.max(1, Math.floor(input.limit ?? 20));
  return {
    entity,
    labels: db
      .prepare('SELECT label FROM kb_labels WHERE ref=? ORDER BY label')
      .all(ref)
      .map((row) => row.label),
    edges: connected.slice(offset, offset + limit).map(lightEdge),
    total: connected.length,
    offset,
    limit,
    remaining: Math.max(0, connected.length - offset - limit),
    descriptionRemaining,
    ...(descriptionRemaining
      ? {
          descriptionNotice: `${descriptionRemaining} more characters; use research_read with full: true.`,
        }
      : {}),
  };
}

function lightEdge({ from, relation, to, layer }) {
  return { from, relation, to, layer };
}

/**
 * Resolve an entity name/alias first, then a research hit, and page a bounded-depth neighborhood.
 * @param {import('../../core/index.js').Core} core
 * @param {any} research
 * @returns {(input:any)=>Promise<any>}
 */
export function createKnowledgeGraph(core, research) {
  return async (input) => {
    let center = input.ref;
    if (!center && input.query) {
      const query = input.query.trim().toLowerCase();
      const entities = core.db
        .prepare(
          "SELECT id,name,name_en,aliases_json FROM kb_entities WHERE status='active' AND visibility<>'private'",
        )
        .all();
      const names = (row) =>
        [row.name, row.name_en, ...JSON.parse(String(row.aliases_json))]
          .filter(Boolean)
          .map((name) => name.toLowerCase());
      const match =
        entities.find((row) => names(row).includes(query)) ??
        entities.find((row) => names(row).some((name) => name.includes(query)));
      if (match) center = 'entity:' + match.id;
      else {
        const result = await research.search(input.query, {
          ...input,
          audience: 'agent',
          limit: 1,
          offset: 0,
        });
        const hit = result.hits[0];
        if (hit) center = hit.sourceId ? 'source:' + hit.sourceId : `${hit.type}:${hit.id}`;
      }
      if (!center) return { nodes: [], edges: [], remaining: 0 };
    }
    const view = createGraphView(core.db, input);
    if (center && !view.node(center))
      throw new AppError('KNOWLEDGE_NODE_NOT_FOUND', 'Knowledge node does not exist.', 404);
    const depth = Math.max(0, Math.floor(input.depth ?? 1));
    const found = new Map();
    const paths = new Map(center ? [[center, [center]]] : []);
    let frontier = center ? [center] : [];
    if (!center) for (const edge of view.edges()) found.set(edge.id, edge);
    for (let level = 0; level < depth && frontier.length; level++) {
      const next = [];
      for (const ref of frontier)
        for (const edge of view.edges(ref)) {
          found.set(edge.id, edge);
          const other = edge.from === ref ? edge.to : edge.from;
          if (!paths.has(other)) {
            paths.set(other, [...paths.get(ref), other]);
            next.push(other);
          }
        }
      frontier = next;
    }
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const limit = Math.max(1, Math.floor(input.limit ?? 50));
    const selected = [...found.values()].slice(offset, offset + limit);
    const refs = new Set(center ? [center] : []);
    for (const edge of selected)
      for (const ref of [edge.from, edge.to])
        for (const step of paths.get(ref) ?? [ref]) refs.add(step);
    return {
      nodes: [...refs].map(view.describe).filter(Boolean),
      edges: selected.map(lightEdge),
      ...(depth >= 2
        ? { paths: [...refs].filter((ref) => paths.has(ref)).map((ref) => paths.get(ref)) }
        : {}),
      total: found.size,
      offset,
      limit,
      remaining: Math.max(0, found.size - offset - selected.length),
    };
  };
}
