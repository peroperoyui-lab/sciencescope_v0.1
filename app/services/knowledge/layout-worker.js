import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { NODES_SQL, scopedNodes, layoutIndex, viewport, prunePositions } from './layout-data.js';
import { computeLayout } from './layout-compute.js';

const db = new DatabaseSync(workerData.file);
db.exec('PRAGMA busy_timeout=5000');
let paused = false;
const resume = new Set();
async function yieldWork() {
  await new Promise((resolve) => setImmediate(resolve));
  if (paused) await new Promise((resolve) => resume.add(resolve));
}

async function arrange({ projectId = null, rerun = false } = {}) {
  const started = performance.now();
  const removed = prunePositions(db);
  const full = rerun || !db.prepare('SELECT 1 FROM kb_positions LIMIT 1').get();
  let nodes;
  let edges;
  if (full) {
    nodes = rerun ? scopedNodes(db, projectId) : db.prepare(NODES_SQL).all();
    edges = db.prepare("SELECT id,from_ref,to_ref FROM kb_edges WHERE status='active'").all();
  } else {
    nodes = db
      .prepare(
        `WITH nodes AS (${NODES_SQL}) SELECT n.* FROM nodes n
      LEFT JOIN kb_positions p ON p.ref=n.ref WHERE p.ref IS NULL`,
      )
      .all();
    if (!nodes.length)
      return { refs: removed, full: false, elapsedMs: performance.now() - started };
    const refs = JSON.stringify(nodes.map((node) => node.ref));
    edges = db
      .prepare(
        `SELECT id,from_ref,to_ref FROM kb_edges WHERE status='active'
      AND (from_ref IN (SELECT value FROM json_each(?)) OR to_ref IN (SELECT value FROM json_each(?)))`,
      )
      .all(refs, refs);
    const peers = JSON.stringify([
      ...new Set(edges.flatMap((edge) => [edge.from_ref, edge.to_ref])),
    ]);
    nodes.push(
      ...db
        .prepare(
          `WITH nodes AS (${NODES_SQL}) SELECT n.* FROM nodes n JOIN kb_positions p ON p.ref=n.ref
      WHERE n.ref IN (SELECT value FROM json_each(?))`,
        )
        .all(peers),
    );
  }
  const positions = new Map(
    db
      .prepare('SELECT * FROM kb_positions')
      .all()
      .map((row) => [row.ref, row]),
  );
  nodes = nodes.map((node) => ({ ...node, ...positions.get(node.ref) }));
  let outerRadius = 100;
  for (const position of positions.values())
    outerRadius = Math.max(outerRadius, Math.hypot(Number(position.x), Number(position.y)) + 50);
  const changes = await computeLayout(nodes, edges, full, yieldWork, outerRadius);
  await yieldWork();
  const insert = db.prepare(
    'INSERT INTO kb_positions(ref,x,y,updated_at) VALUES(?,?,?,?) ON CONFLICT(ref) DO NOTHING',
  );
  const update = db.prepare(
    'UPDATE kb_positions SET x=?,y=?,updated_at=? WHERE ref=? AND pinned=0 AND updated_at=?',
  );
  const stamp = new Date().toISOString(),
    refs = [...removed];
  db.exec('BEGIN IMMEDIATE');
  try {
    const active = new Set(
      db
        .prepare(NODES_SQL)
        .all()
        .map((node) => node.ref),
    );
    for (const node of changes) {
      if (!active.has(node.ref)) continue;
      const result =
        node.previous == null
          ? insert.run(node.ref, node.x, node.y, stamp)
          : update.run(node.x, node.y, stamp, node.ref, node.previous);
      if (result.changes) refs.push(node.ref);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { refs, full, elapsedMs: performance.now() - started };
}

parentPort.on('message', async ({ id, action, input }) => {
  if (action === 'pause') {
    paused = input;
    if (!paused) {
      for (const done of resume) done();
      resume.clear();
    }
    return;
  }
  try {
    const value =
      action === 'arrange'
        ? await arrange(input)
        : action === 'index'
          ? layoutIndex(db, input)
          : viewport(db, input);
    parentPort.postMessage({ id, value });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error.message) });
  }
});
