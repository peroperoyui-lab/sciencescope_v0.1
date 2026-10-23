import { LITERATURE_KINDS } from '../research/records.js';
import { indexText } from '../research/text-index.js';

/**
 * Canonical visibility is checked for both endpoints, before traversal. Batch
 * reads use JSON sets to stay independent of SQLite's bind-variable limit.
 * @param {import('../../core/db/database.js').Db} db
 * @param {any} options
 * @returns {any}
 */
export function expansionView(db, options = {}, index = null) {
  const cache = new Map();
  const members = index
    ? index.members(options.projectId)
    : new Set(
        options.projectId
          ? db
              .prepare('SELECT ref FROM kb_memberships WHERE project_id=?')
              .all(options.projectId)
              .map((row) => row.ref)
          : [],
      );
  const get = (table, ids) =>
    db
      .prepare(`SELECT * FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(ids));
  function allowed(row, type, ref) {
    if (row.visibility === 'private' || (row.status && row.status !== 'active')) return false;
    if (type === 'item' && row.type === 'memory') return false;
    if (options.knowledge && !options.projectId)
      return type !== 'source' || !row.project_id || LITERATURE_KINDS.includes(row.kind);
    if (options.projectId && members.has(ref)) return true;
    return (
      (row.project_id ?? null) === (options.projectId ?? null) ||
      (options.projectId && options.includePersonal !== false && !row.project_id)
    );
  }
  function load(refs) {
    const missing = [...new Set(refs)].filter((ref) => !cache.has(ref));
    for (const type of ['source', 'item', 'entity', 'chunk']) {
      const ids = missing
        .filter((ref) => ref.startsWith(type + ':'))
        .map((ref) => ref.slice(type.length + 1));
      if (!ids.length) continue;
      const rows = index
        ? index.rows(type, ids)
        : get(
            { source: 'rb_sources', item: 'rb_items', entity: 'kb_entities', chunk: 'rb_chunks' }[
              type
            ],
            ids,
          );
      if (type === 'chunk') load(rows.map((row) => 'source:' + row.source_id));
      for (const row of rows) {
        const ref = type + ':' + row.id;
        if (type === 'chunk') {
          const source = cache.get('source:' + row.source_id);
          cache.set(ref, source ? { ...source, ref, type, row } : null);
        } else
          cache.set(
            ref,
            allowed(row, type, ref) ? { ref, type, name: row.title ?? row.name, row } : null,
          );
      }
    }
    for (const ref of missing) if (!cache.has(ref)) cache.set(ref, null);
  }
  return { load, node: (ref) => cache.get(ref) };
}

/**
 * @param {any} edge
 * @returns {number}
 */
export function expansionEdgeWeight(edge) {
  return (
    ({ curated: 1, extracted: 0.7, derived: 0.3 }[edge.layer] ?? 0) *
    (edge.relation === 'similar-to' ? Math.max(0, Number(edge.weight ?? 0)) : 1)
  );
}

/**
 * @param {string} query
 * @param {string} text
 * @returns {number}
 */
export function termRelevance(query, text) {
  const queryTerms = new Set(indexText(query).split(' ').filter(Boolean));
  const words = new Set(indexText(text).split(' ').filter(Boolean));
  return (
    [...queryTerms].reduce((score, word) => score + Number(words.has(word)), 0) /
    Math.max(1, queryTerms.size)
  );
}

/**
 * Each node enters the frontier once. Nodes beyond the resource bound are
 * selected by edge weight; the caller discloses truncation in the result.
 * @param {any} db
 * @param {{seeds:any[],query:string,depth?:number,options?:any,deadline?:number,now?:()=>number,maxNodes?:number,index?:any}} input
 * @returns {any}
 */
export function collectExpansionGraph(
  db,
  {
    seeds,
    query,
    depth = 1,
    options = {},
    deadline = Infinity,
    now = performance.now.bind(performance),
    maxNodes = 2000,
    index = null,
  },
) {
  const check = () => {
    if (now() >= deadline)
      throw Object.assign(new Error('Graph expansion timed out'), { code: 'GRAPH_TIMEOUT' });
  };
  const view = expansionView(db, options, index);
  view.load(seeds.map((seed) => seed.ref));
  const nodes = new Map(
    seeds.filter((seed) => view.node(seed.ref)).map((seed) => [seed.ref, view.node(seed.ref)]),
  );
  const edges = new Map();
  const visited = new Set();
  const degrees = new Map();
  let frontier = [...nodes.keys()];
  let truncated = false;
  const time = new Date().toISOString();
  for (let level = 0; level < depth && frontier.length; level++) {
    check();
    const active = frontier.filter((ref) => !visited.has(ref));
    const activeSet = new Set(active);
    active.forEach((ref) => visited.add(ref));
    const selected = JSON.stringify(active);
    let rows = index
      ? index.edges(active, time)
      : db
          .prepare(
            `SELECT id,from_ref AS "from",to_ref AS "to",relation,layer,weight FROM kb_edges
      WHERE status='active' AND (valid_from IS NULL OR valid_from<=?) AND (valid_to IS NULL OR valid_to>?)
      AND (from_ref IN (SELECT value FROM json_each(?)) OR to_ref IN (SELECT value FROM json_each(?)))`,
          )
          .all(time, time, selected, selected);
    check();
    // Once an earlier hop filled and truncated the node budget, only edges
    // between already selected nodes can enter the subgraph. Avoid materializing
    // thousands of out-of-budget node records just to discard them again.
    if (truncated && nodes.size === maxNodes)
      rows = rows.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
    view.load(rows.flatMap((edge) => [edge.from, edge.to]));
    const valid = rows.filter((edge) => view.node(edge.from) && view.node(edge.to));
    for (const ref of active) degrees.set(ref, 0);
    for (const edge of valid)
      for (const ref of [edge.from, edge.to])
        if (activeSet.has(ref)) degrees.set(ref, degrees.get(ref) + 1);
    valid.sort(
      (a, b) =>
        expansionEdgeWeight(b) - expansionEdgeWeight(a) || String(a.id).localeCompare(String(b.id)),
    );
    const next = new Set();
    for (const edge of valid) {
      check();
      const missing = [...new Set([edge.from, edge.to])].filter((ref) => !nodes.has(ref));
      if (nodes.size + missing.length > maxNodes) {
        truncated = true;
        continue;
      }
      for (const ref of missing) {
        nodes.set(ref, view.node(ref));
        next.add(ref);
      }
      edges.set(edge.id, { ...edge, strength: expansionEdgeWeight(edge) });
    }
    frontier = [...next];
  }
  check();
  for (const node of nodes.values())
    node.relevance = termRelevance(
      query,
      [node.name, node.row.name_en, node.row.aliases_json, node.row.description, node.row.body]
        .filter(Boolean)
        .join(' '),
    );
  return {
    nodes,
    edges: [...edges.values()],
    seeds: seeds.filter((seed) => nodes.has(seed.ref)),
    degrees,
    depth,
    truncated,
    visited: [...visited],
    visible: (ref) => {
      view.load([ref]);
      return Boolean(view.node(ref));
    },
  };
}
