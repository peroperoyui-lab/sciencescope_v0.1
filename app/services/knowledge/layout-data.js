import { LITERATURE_KINDS } from '../research/records.js';

// Keep the map projection independent of tool traversal: no passages, memory,
// source bodies or evidence cross this boundary. JSON sets avoid SQL bind limits.
export const NODES_SQL = `SELECT 'source:'||id AS ref, title AS name, 'source' AS kind, project_id, kind AS source_kind FROM rb_sources
  UNION ALL SELECT 'item:'||id,title,type,project_id,NULL FROM rb_items WHERE status='active' AND type<>'memory'
  UNION ALL SELECT 'entity:'||id,name,kind,NULL,NULL FROM kb_entities WHERE status='active'`;

// Share literature from projects with the global graph, using exactly the same
// source kinds as paper cards. Other project files stay in their project view;
// all graph items and entities remain available globally.
const scope = `(? IS NULL AND (n.source_kind IS NULL OR n.project_id IS NULL
  OR n.source_kind IN (SELECT value FROM json_each(?)))) OR (? IS NOT NULL AND
  (n.project_id=? OR EXISTS(SELECT 1 FROM kb_memberships m WHERE m.ref=n.ref AND m.project_id=?)))`;
const scopeValues = (projectId) => [
  projectId,
  JSON.stringify(LITERATURE_KINDS),
  projectId,
  projectId,
  projectId,
];

/**
 * @param {any} db
 * @param {string|null} projectId
 * @returns {any[]}
 */
export function scopedNodes(db, projectId) {
  return db
    .prepare(`WITH nodes AS (${NODES_SQL}) SELECT n.* FROM nodes n WHERE ${scope}`)
    .all(...scopeValues(projectId));
}

/**
 * @param {any} db
 * @param {string|null} projectId
 * @returns {{nodes:any[],pending:number}}
 */
export function layoutIndex(db, projectId = null) {
  // Degrees are two grouped scans of the edge endpoint indexes (no table
  // lookups); per-node subqueries took about 3 seconds for 50 000 nodes and
  // 500 000 edges on Windows. A self-loop counts twice, as in graph theory.
  const degree = new Map();
  for (const column of ['from_ref', 'to_ref'])
    for (const row of db
      .prepare(
        `SELECT ${column} AS ref, count(*) AS n FROM kb_edges WHERE status='active' GROUP BY ${column}`,
      )
      .all())
      degree.set(row.ref, (degree.get(row.ref) ?? 0) + Number(row.n));
  const rows = db
    .prepare(
      `WITH nodes AS (${NODES_SQL})
    SELECT n.ref,n.kind,p.x,p.y FROM nodes n LEFT JOIN kb_positions p ON p.ref=n.ref WHERE ${scope}`,
    )
    .all(...scopeValues(projectId));
  const nodes = [],
    missing = rows.filter((row) => row.x == null);
  for (const row of rows)
    if (row.x != null) nodes.push([row.ref, row.x, row.y, row.kind, degree.get(row.ref) ?? 0]);
  return { nodes, pending: missing.length };
}

/**
 * Only selected, in-scope nodes and edges with both endpoints selected.
 * @param {any} db
 * @param {{refs:string[],projectId?:string}} input
 * @returns {any}
 */
export function viewport(db, { refs, projectId = null }) {
  const nodes = db
    .prepare(
      `WITH nodes AS (${NODES_SQL}) SELECT n.ref,n.name,n.kind FROM nodes n
    WHERE n.ref IN (SELECT value FROM json_each(?)) AND (${scope})`,
    )
    .all(JSON.stringify(refs), ...scopeValues(projectId));
  const selected = JSON.stringify(nodes.map((node) => node.ref));
  const edges = db
    .prepare(
      `SELECT e.id,e.from_ref AS "from",e.to_ref AS "to",e.relation,e.layer,e.origin,
    (e.origin='ai' AND NOT EXISTS(SELECT 1 FROM kb_revisions r WHERE r.ref='edge:'||e.id AND r.origin='user' AND r.op<>'create')) AS aiUntouched
    FROM kb_edges e WHERE e.status='active' AND e.from_ref IN (SELECT value FROM json_each(?))
    AND e.to_ref IN (SELECT value FROM json_each(?))`,
    )
    .all(selected, selected)
    .map((edge) => ({ ...edge, aiUntouched: Boolean(edge.aiUntouched) }));
  return { nodes, edges };
}

/**
 * Remove only obsolete coordinates, never fill the resulting holes.
 * @param {any} db
 * @returns {string[]}
 */
export function prunePositions(db) {
  return db
    .prepare(
      `WITH nodes AS (${NODES_SQL})
    DELETE FROM kb_positions WHERE ref NOT IN (SELECT ref FROM nodes) RETURNING ref`,
    )
    .all()
    .map((row) => row.ref);
}
