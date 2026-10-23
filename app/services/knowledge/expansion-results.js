import { fuseHybridRankings, hybridRefKey } from '../research/semantic/hybrid.js';

const nodeRef = (hit) => (hit.sourceId ? 'source:' + hit.sourceId : `${hit.type}:${hit.id}`);

/**
 * Reuse the original query's complete keyword/vector rankings. Graph discovery
 * never asks a model to rewrite or rerank the query, or embeds it a second time.
 * @param {any} context
 * @returns {any[]}
 */
export function expansionSeeds(context) {
  const seeds = new Map();
  const passages = context.ranked
    .filter((row) => ['chunk', 'item'].includes(row.ref.type))
    .slice(0, 20);
  const entities = context.ranked.filter((row) => row.ref.type === 'entity').slice(0, 5);
  for (const rows of [passages, entities])
    rows.forEach((row, rank) => {
      const hit = context.hit(row.ref, row.score);
      const ref = nodeRef(hit);
      if (!seeds.has(ref) || rank < seeds.get(ref).rank) seeds.set(ref, { ref, rank });
    });
  return [...seeds.values()];
}

/**
 * Resolve each graph candidate back to a current original passage or item.
 * Entity descriptions are never returned as evidence.
 * @param {any} db
 * @param {any} graph
 * @param {any} ranked
 * @param {any} context
 * @param {any[]} original
 * @param {()=>void} check
 * @returns {any[]}
 */
export function graphPassages(db, graph, ranked, context, original, check) {
  const existing = new Set(original.map(nodeRef));
  const relevance = new Map(context.ranked.map((row, index) => [hybridRefKey(row.ref), index]));
  const candidates = new Map();
  const chunks = db.prepare('SELECT id FROM rb_chunks WHERE source_id=? ORDER BY ordinal');
  for (const [ref, score] of [...ranked.scores].sort((a, b) => b[1] - a[1])) {
    check();
    const path = ranked.paths.get(ref);
    if (existing.has(ref) || !path) continue;
    const node = graph.nodes.get(ref);
    let refs = [];
    if (node.type === 'source')
      refs = chunks.all(node.row.id).map((row) => ({ type: 'chunk', id: String(row.id) }));
    else if (node.type === 'item' || node.type === 'chunk')
      refs = [{ type: node.type, id: node.row.id }];
    else if (node.type === 'entity')
      refs = []
        .concat(
          JSON.parse(
            db.prepare('SELECT evidence_json FROM kb_entities WHERE id=?').get(node.row.id)
              ?.evidence_json ?? '[]',
          ),
        )
        .flatMap((entry) => {
          const match = String(entry.ref ?? '').match(/^chunk:(.+)$/);
          // Paper cards store chunkId; manually edited evidence also accepts ref.
          const id = entry.chunkId ?? match?.[1];
          return id ? [{ type: 'chunk', id }] : [];
        });
    refs.sort(
      (a, b) =>
        (relevance.get(hybridRefKey(a)) ?? Infinity) - (relevance.get(hybridRefKey(b)) ?? Infinity),
    );
    for (const selected of refs) {
      // The initial rankings were scoped; a graph entity cannot lend access to
      // an evidence passage outside that same scope or from an obsolete record.
      if (!relevance.has(hybridRefKey(selected)) && context.vectorRankings.length) continue;
      let hit;
      try {
        hit = context.hit(selected, score);
      } catch {
        continue;
      }
      if (!hit.citation || existing.has(nodeRef(hit))) continue;
      if (!graph.visible(nodeRef(hit))) continue;
      const key = hybridRefKey(hit);
      const previous = candidates.get(key);
      if (!previous || path.strength > previous.path.strength)
        candidates.set(key, { hit, path, score });
      break;
    }
  }
  return [...candidates.values()].sort(
    (a, b) => b.score - a.score || hybridRefKey(a.hit).localeCompare(hybridRefKey(b.hit)),
  );
}

/**
 * Enforce the quota on the final result, not on a fixed position. The extra
 * original.length/3 bound also keeps sparse searches at or below one quarter.
 * @param {any[]} ranked
 * @param {any[]} original
 * @param {number} limit
 * @returns {any[]}
 */
export function selectExpanded(ranked, original, limit) {
  const maxGraph = Math.min(Math.floor(limit / 4), Math.floor(original.length / 3));
  let graphs = 0;
  const selected = [];
  for (const hit of ranked) {
    if (hit.origin === 'graph' && ++graphs > maxGraph) continue;
    selected.push(hit);
    if (selected.length === limit) break;
  }
  return selected;
}

/**
 * B: the same weighted keyword/vector RRF for both origins, with a PPR bonus
 * bounded by ten percent of that candidate's relevance score.
 * @param {any[]} original
 * @param {any[]} candidates
 * @param {any} context
 * @param {number} limit
 * @returns {any[]}
 */
export function fuseExpanded(original, candidates, context, limit) {
  const hits = new Map(
    [
      ...original.map((hit) => ({ ...hit, origin: 'search' })),
      ...candidates.map((candidate) => ({ ...candidate.hit, origin: 'graph', candidate })),
    ].map((hit) => [hybridRefKey(hit), hit]),
  );
  const fused = fuseHybridRankings({
    vectorRankings: context.vectorRankings,
    keywordRankings: context.keywordRankings,
    allowedRefs: [...hits.values()].map((hit) => ({ type: hit.type, id: hit.id })),
    limit: hits.size,
  });
  const maxScore = Math.max(0, ...candidates.map((candidate) => candidate.score));
  const values = fused.map((row) => {
    const hit = hits.get(hybridRefKey(row.ref));
    hits.delete(hybridRefKey(row.ref));
    return {
      ...hit,
      score:
        row.score * (1 + (hit.candidate && maxScore ? (0.1 * hit.candidate.score) / maxScore : 0)),
    };
  });
  // Keyword-only candidates with no shared term still remain discoverable, after
  // positively matched evidence. PPR does not manufacture lexical relevance.
  values.push(...[...hits.values()].map((hit) => ({ ...hit, score: 0 })));
  values.sort((a, b) => b.score - a.score || hybridRefKey(a).localeCompare(hybridRefKey(b)));
  return selectExpanded(values, original, limit);
}

/**
 * @param {any[]} hits
 * @param {any} graph
 * @returns {any[]}
 */
export function explainExpanded(hits, graph) {
  let count = 0;
  return hits.map(({ candidate, ...hit }) => {
    if (!candidate || count++ >= 5) return hit;
    const via = [];
    let explanation = '经由：';
    for (const [index, ref] of candidate.path.nodes.entries()) {
      const node = graph.nodes.get(ref);
      if (index) {
        const edge = candidate.path.edges[index - 1];
        via.push({ relation: edge.relation });
        explanation +=
          edge.from === candidate.path.nodes[index - 1]
            ? ` —${edge.relation}→ `
            : ` ←${edge.relation}— `;
      }
      via.push({ ref, name: node.name });
      explanation += node.name;
    }
    return { ...hit, via, text: hit.text + '\n' + explanation };
  });
}
