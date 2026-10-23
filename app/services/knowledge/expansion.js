import { readFileSync } from 'node:fs';
import { settings } from '../../core/workspace/resources/settings.js';
import { collectExpansionGraph } from './expansion-graph.js';
import { rankExpansion } from './expansion-rank.js';
import { createExpansionIndex } from './expansion-index.js';
import {
  expansionSeeds,
  graphPassages,
  fuseExpanded,
  explainExpanded,
} from './expansion-results.js';

/**
 * Add discovery to the existing retrieval result. Keyword-only callers keep
 * their synchronous contract; an enabled vector service remains asynchronous.
 * @param {import('../../core/index.js').Core} core
 * @param {(query:string,input:any)=>any} search
 * @param {{collect?:typeof collectExpansionGraph,rank?:typeof rankExpansion,fuse?:typeof fuseExpanded,
 * hubPenalty?:boolean,fanout?:boolean,timeoutMs?:number,now?:()=>number,observe?:(value:any)=>void}} [options]
 * @returns {(query:string,input?:any)=>any}
 */
export function createExpansionSearch(
  core,
  search,
  {
    collect = collectExpansionGraph,
    rank = rankExpansion,
    fuse = fuseExpanded,
    hubPenalty = true,
    fanout = true,
    timeoutMs = 300,
    now = performance.now.bind(performance),
    observe,
  } = {},
) {
  const index = createExpansionIndex(core);
  function configured() {
    try {
      return settings.parse(readFileSync(core.paths.settings, 'utf8')).knowledge.retrievalExpansion;
    } catch (error) {
      if (error.code === 'ENOENT') return settings.parse(null).knowledge.retrievalExpansion;
      throw error;
    }
  }
  const plain = (result, reason) => ({
    ...result,
    hits: result.hits.map((hit) => ({ ...hit, origin: 'search' })),
    graph: { used: false, reason },
  });
  function expand(query, input, original, context) {
    const started = now();
    const deadline = started + timeoutMs;
    const check = () => {
      if (now() >= deadline)
        throw Object.assign(new Error('Graph timeout'), { code: 'GRAPH_TIMEOUT' });
    };
    try {
      check();
      if (!context) return plain(original, 'no-seeds');
      const seeds = expansionSeeds(context);
      if (!seeds.length) return plain(original, 'no-seeds');
      const graph = collect(core.db, {
        seeds,
        query,
        options: input,
        depth: input.graphDepth === 2 || input.graph?.depth === 2 ? 2 : 1,
        deadline,
        now,
        index,
      });
      if (!graph.edges.length) return plain(original, 'empty-graph');
      context.ranked.forEach((row, position) => {
        const node = graph.nodes.get(`${row.ref.type}:${row.ref.id}`);
        if (node) node.relevance += 1 / (1 + position);
      });
      const ranked = rank(graph, { hubPenalty, fanout, deadline, now });
      const candidates = graphPassages(core.db, graph, ranked, context, original.hits, check);
      const hits = explainExpanded(fuse(original.hits, candidates, context, original.limit), graph);
      check();
      observe?.({ graph, ranked, candidates, context, original, durationMs: now() - started });
      if (!hits.some((hit) => hit.origin === 'graph'))
        return plain(original, 'no-additional-evidence');
      const originalKeys = new Set(context.ranked.map((row) => `${row.ref.type}:${row.ref.id}`));
      const total =
        original.total +
        hits.filter((hit) => hit.origin === 'graph' && !originalKeys.has(`${hit.type}:${hit.id}`))
          .length;
      return {
        ...original,
        hits,
        total,
        remaining: Math.max(0, total - original.offset - hits.length),
        graph: {
          used: true,
          seeds: graph.seeds.length,
          nodes: graph.nodes.size,
          truncated: graph.truncated,
        },
      };
    } catch (error) {
      observe?.({ error, durationMs: now() - started });
      return plain(original, error.code === 'GRAPH_TIMEOUT' ? 'timeout' : 'error');
    }
  }
  return (query, input = {}) => {
    let enabled;
    let reason = 'disabled';
    try {
      enabled =
        input.graph !== false && ((input.graph && typeof input.graph === 'object') || configured());
    } catch {
      reason = 'settings-error';
    }
    let context;
    const result = search(query, {
      ...input,
      ...(enabled
        ? {
            onRankings: (value) => {
              context = value;
            },
          }
        : {}),
    });
    const finish = (value) =>
      enabled ? expand(query, input, value, context) : plain(value, reason);
    return result?.then ? result.then(finish) : finish(result);
  };
}
