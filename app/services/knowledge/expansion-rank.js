/**
 * Personalized PageRank on the bounded, undirected discovery graph. Direction
 * remains on the evidence path, even when traversal follows an incoming edge.
 * Power-iteration/personalized dangling-mass semantics checked against NetworkX
 * pagerank_alg (BSD-3-Clause); independently implemented, no copied source.
 * https://networkx.org/documentation/stable/_modules/networkx/algorithms/link_analysis/pagerank_alg.html
 * @param {any} graph
 * @param {{hubPenalty?:boolean,fanout?:boolean,deadline?:number,now?:()=>number}} [options]
 * @returns {any}
 */
export function rankExpansion(
  graph,
  {
    hubPenalty = true,
    fanout = true,
    deadline = Infinity,
    now = performance.now.bind(performance),
  } = {},
) {
  const refs = [...graph.nodes.keys()];
  const positions = new Map(refs.map((ref, index) => [ref, index]));
  const neighbors = refs.map(() => []);
  const outgoing = new Float64Array(refs.length);
  for (const edge of graph.edges) {
    const a = positions.get(edge.from),
      b = positions.get(edge.to);
    if (a === b) continue;
    neighbors[a].push({ index: b, edge, weight: edge.strength });
    neighbors[b].push({ index: a, edge, weight: edge.strength });
  }
  let clipped = 0;
  for (const [index, rows] of neighbors.entries()) {
    if (fanout && rows.length > 15) {
      rows.sort(
        (a, b) =>
          graph.nodes.get(refs[b.index]).relevance - graph.nodes.get(refs[a.index]).relevance ||
          b.weight - a.weight ||
          refs[a.index].localeCompare(refs[b.index]),
      );
      const preferred = new Set();
      for (const row of rows) if (preferred.size < 15) preferred.add(row.index);
      for (const row of rows)
        if (!preferred.has(row.index)) {
          row.weight *= 0.01;
          clipped++;
        }
    }
    const total = rows.reduce((sum, row) => sum + row.weight, 0);
    outgoing[index] = total;
    for (const row of rows) row.probability = total ? row.weight / total : 0;
    if (!graph.degrees.has(refs[index])) graph.degrees.set(refs[index], rows.length);
  }
  const restart = new Float64Array(refs.length);
  for (const seed of graph.seeds) {
    const degree = Math.max(1, graph.degrees.get(seed.ref) ?? 0);
    restart[positions.get(seed.ref)] += 1 / (seed.rank + 1) / (hubPenalty ? degree : 1);
  }
  const total = restart.reduce((sum, score) => sum + score, 0);
  if (!total)
    return { scores: new Map(), paths: new Map(), restart: new Map(), clipped, iterations: 0 };
  for (let i = 0; i < restart.length; i++) restart[i] /= total;
  let scores = restart.slice();
  let iterations = 0;
  for (; iterations < 30; iterations++) {
    if (now() >= deadline)
      throw Object.assign(new Error('Graph expansion timed out'), { code: 'GRAPH_TIMEOUT' });
    const next = Float64Array.from(restart, (score) => score * 0.5);
    let dangling = 0;
    for (let index = 0; index < refs.length; index++) {
      if (!outgoing[index]) dangling += scores[index] * 0.5;
      for (const row of neighbors[index]) next[row.index] += scores[index] * 0.5 * row.probability;
    }
    let delta = 0;
    for (let index = 0; index < refs.length; index++) {
      next[index] += dangling * restart[index];
      delta += Math.abs(next[index] - scores[index]);
    }
    scores = next;
    if (delta < 1e-8) {
      iterations++;
      break;
    }
  }
  // Strongest simple path within the requested hop depth; do not emit cyclic
  // walks as explanations. PPR still accounts for converging and cyclic edges.
  const paths = new Map();
  let frontier = graph.seeds.map((seed) => ({
    ref: seed.ref,
    strength: restart[positions.get(seed.ref)],
    nodes: [seed.ref],
    edges: [],
  }));
  for (let hop = 0; hop < (graph.depth ?? 1); hop++) {
    const next = new Map();
    for (const candidate of frontier) {
      if (now() >= deadline)
        throw Object.assign(new Error('Graph expansion timed out'), { code: 'GRAPH_TIMEOUT' });
      for (const row of neighbors[positions.get(candidate.ref)]) {
        const ref = refs[row.index];
        if (!row.probability || candidate.nodes.includes(ref)) continue;
        const value = {
          ref,
          strength: candidate.strength * row.probability,
          nodes: [...candidate.nodes, ref],
          edges: [...candidate.edges, row.edge],
        };
        if (value.strength > (paths.get(ref)?.strength ?? -1)) paths.set(ref, value);
        if (value.strength > (next.get(ref)?.strength ?? -1)) next.set(ref, value);
      }
    }
    frontier = [...next.values()];
  }
  return {
    scores: new Map(refs.map((ref, index) => [ref, scores[index]])),
    paths,
    restart: new Map(refs.map((ref, index) => [ref, restart[index]])),
    clipped,
    iterations,
  };
}
