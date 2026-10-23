// Disposable adjacency projection. Canonical rows stay in SQLite; scope and
// validity dates are checked at query time, not captured by the cache.
const indexes = new WeakMap();
const tables = {
  source: 'rb_sources',
  chunk: 'rb_chunks',
  item: 'rb_items',
  entity: 'kb_entities',
};
const columns = {
  source: 'id,title,kind,project_id',
  chunk: 'id,source_id,ordinal',
  item: 'id,title,type,project_id,status,visibility',
  entity: 'id,name,name_en,aliases_json,kind,status,visibility',
};
const edgeColumns =
  'id,from_ref AS "from",to_ref AS "to",relation,layer,weight,status,valid_from,valid_to';

/**
 * One index per core, built at service construction and updated after committed
 * knowledge/research events. No background timer or additional database exists.
 * @param {import('../../core/index.js').Core} core
 * @returns {any}
 */
export function createExpansionIndex(core) {
  if (indexes.has(core)) return indexes.get(core);
  const { db } = core;
  const nodes = new Map(),
    edges = new Map(),
    adjacent = new Map(),
    chunks = new Map();
  let memberships = new Map();
  function saveNode(type, row) {
    const ref = `${type}:${row.id}`;
    nodes.set(ref, row);
    if (type === 'chunk') {
      if (!chunks.has(row.source_id)) chunks.set(row.source_id, new Set());
      chunks.get(row.source_id).add(ref);
    }
  }
  function saveEdge(id, row) {
    const before = edges.get(id);
    if (before) for (const ref of [before.from, before.to]) adjacent.get(ref)?.delete(id);
    edges.delete(id);
    if (!row || row.status !== 'active') return;
    edges.set(id, row);
    for (const ref of [row.from, row.to]) {
      if (!adjacent.has(ref)) adjacent.set(ref, new Set());
      adjacent.get(ref).add(id);
    }
  }
  function loadMemberships() {
    memberships = new Map();
    for (const row of db.prepare('SELECT project_id,ref FROM kb_memberships').all()) {
      if (!memberships.has(row.project_id)) memberships.set(row.project_id, new Set());
      memberships.get(row.project_id).add(row.ref);
    }
  }
  function refreshNode(type, id) {
    const row = db.prepare(`SELECT ${columns[type]} FROM ${tables[type]} WHERE id=?`).get(id);
    nodes.delete(`${type}:${id}`);
    if (row) saveNode(type, row);
    if (type === 'source') {
      for (const ref of chunks.get(id) ?? []) nodes.delete(ref);
      chunks.delete(id);
    }
  }
  function rebuildNodes() {
    nodes.clear();
    chunks.clear();
    for (const [type, table] of Object.entries(tables))
      if (type !== 'chunk')
        for (const row of db.prepare(`SELECT ${columns[type]} FROM ${table}`).all())
          saveNode(type, row);
    loadMemberships();
  }
  rebuildNodes();
  for (const row of db.prepare(`SELECT ${edgeColumns} FROM kb_edges WHERE status='active'`).all())
    saveEdge(row.id, row);
  core.events.subscribe((event) => {
    if (event.type === 'project.deleted') {
      rebuildNodes();
      return;
    }
    if (event.type === 'research.changed' && event.payload.action !== 'knowledge.changed') {
      if (event.payload.sourceId) refreshNode('source', event.payload.sourceId);
      if (event.payload.itemId) refreshNode('item', event.payload.itemId);
    }
    if (event.type !== 'knowledge.changed') return;
    for (const ref of event.payload.refs ?? []) {
      const split = ref.indexOf(':');
      const type = ref.slice(0, split),
        id = ref.slice(split + 1);
      if (type === 'edge')
        saveEdge(id, db.prepare(`SELECT ${edgeColumns} FROM kb_edges WHERE id=?`).get(id));
      else if (tables[type]) refreshNode(type, id);
      else if (type === 'membership') loadMemberships();
    }
  });
  const index = {
    rows(type, ids) {
      if (type === 'chunk') {
        const missing = ids.filter((id) => !nodes.has('chunk:' + id));
        if (missing.length)
          for (const row of db
            .prepare(
              `SELECT ${columns.chunk} FROM rb_chunks WHERE id IN (SELECT value FROM json_each(?))`,
            )
            .all(JSON.stringify(missing)))
            saveNode('chunk', row);
      }
      return ids.map((id) => nodes.get(`${type}:${id}`)).filter(Boolean);
    },
    members: (projectId) => memberships.get(projectId) ?? new Set(),
    edges(refs, time) {
      const ids = new Set(refs.flatMap((ref) => [...(adjacent.get(ref) ?? [])]));
      return [...ids]
        .map((id) => edges.get(id))
        .filter(
          (edge) =>
            edge &&
            (!edge.valid_from || edge.valid_from <= time) &&
            (!edge.valid_to || edge.valid_to > time),
        );
    },
  };
  indexes.set(core, index);
  return index;
}
