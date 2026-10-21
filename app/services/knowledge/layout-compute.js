import { MultiUndirectedGraph } from 'graphology';
import forceAtlas2Module from 'graphology-layout-forceatlas2';

// Node loads this CommonJS callable as the default; its declarations describe an ESM default.
const forceAtlas2 = /** @type {typeof import('graphology-layout-forceatlas2').default} */ (
  /** @type {unknown} */ (forceAtlas2Module)
);

// Both libraries are MIT. ForceAtlas2 0.10.1 reads attr.fixed in helpers.js
// and skips movement in iterate.js. Do not write fixed coordinates back:
// its Float32 matrices would otherwise round user-supplied double precision.
// https://graphology.github.io/standard-library/layout-forceatlas2.html
export const LAYOUT_ITERATIONS = { small: 100, medium: 60, large: 30, local: 10, slice: 5 };

/**
 * @param {any[]} nodes
 * @param {any[]} edges
 * @param {boolean} full
 * @param {()=>Promise<void>} yieldWork
 * @param {number} [outerRadius] Whole persisted graph extent, including nodes outside the local neighborhood.
 * @returns {Promise<any[]>}
 */
export async function computeLayout(nodes, edges, full, yieldWork, outerRadius = 100) {
  const graph = new MultiUndirectedGraph();
  const existing = new Map(nodes.filter((node) => node.x != null).map((node) => [node.ref, node]));
  const neighbors = new Map();
  for (const edge of edges) {
    for (const [ref, peer] of [
      [edge.from_ref, edge.to_ref],
      [edge.to_ref, edge.from_ref],
    ]) {
      if (!existing.has(peer)) continue;
      if (!neighbors.has(ref)) neighbors.set(ref, []);
      neighbors.get(ref).push(existing.get(peer));
    }
  }
  let radius = Math.max(100, outerRadius);
  for (const node of existing.values()) radius = Math.max(radius, Math.hypot(node.x, node.y) + 50);
  for (const [index, node] of nodes.entries()) {
    const peers = neighbors.get(node.ref) ?? [];
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const spread = full && !existing.size ? 10 * Math.sqrt(index + 1) : radius;
    const jitter = () => (Math.random() - 0.5) * 10;
    const x =
      node.x ??
      (peers.length
        ? peers.reduce((sum, p) => sum + p.x, 0) / peers.length + jitter()
        : Math.cos(angle) * spread);
    const y =
      node.y ??
      (peers.length
        ? peers.reduce((sum, p) => sum + p.y, 0) / peers.length + jitter()
        : Math.sin(angle) * spread);
    graph.addNode(node.ref, { x, y, fixed: Boolean(node.pinned || (!full && node.x != null)) });
  }
  for (const edge of edges)
    if (graph.hasNode(edge.from_ref) && graph.hasNode(edge.to_ref))
      graph.addEdgeWithKey(edge.id, edge.from_ref, edge.to_ref);
  const iterations = !full
    ? LAYOUT_ITERATIONS.local
    : graph.order <= 1000
      ? LAYOUT_ITERATIONS.small
      : graph.order <= 10000
        ? LAYOUT_ITERATIONS.medium
        : LAYOUT_ITERATIONS.large;
  if (graph.order > 1)
    for (let step = 0; step < iterations; step += LAYOUT_ITERATIONS.slice) {
      await yieldWork();
      forceAtlas2.assign(graph, {
        iterations: LAYOUT_ITERATIONS.slice,
        settings: {
          ...forceAtlas2.inferSettings(graph),
          barnesHutOptimize: true,
          slowDown: full ? 5 : 20,
          gravity: full ? 1 : 0,
        },
      });
    }
  return nodes
    .filter((node) => !graph.getNodeAttribute(node.ref, 'fixed'))
    .map((node) => ({
      ...node,
      ...graph.getNodeAttributes(node.ref),
      previous: node.updated_at ?? null,
    }));
}
