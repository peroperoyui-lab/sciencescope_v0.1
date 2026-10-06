import { runVectorPhase, fuseHybridRankings, hybridRefKey } from './hybrid.js';

/** @param {{projection:any,isEnabled:()=>boolean,state:()=>string,getVector:()=>any,rebuild:()=>any,timeoutMs?:number}} dependencies */
export function createHybridSearch({
  projection,
  isEnabled,
  state,
  getVector,
  rebuild,
  timeoutMs = 300,
}) {
  /** @param {string} query @param {any} options @param {(query:string,options:any)=>any} keyword */
  return async function search(query, options = {}, keyword) {
    const fallback = async (fallbackReason) => ({
      ...(await keyword(query, options)),
      mode: 'keyword',
      fallbackReason,
    });
    if (!query.trim()) return fallback('empty-query');
    if (!isEnabled() || ['model-missing', 'unsupported', 'error', 'downloading'].includes(state()))
      return fallback('model-missing');
    const vector = getVector();
    if (!vector) return fallback('index-incomplete');
    const candidates = projection.candidates(options);
    const limit = Math.max(1, Math.floor(options.limit ?? 10));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    let phase;
    try {
      phase = await runVectorPhase({
        search: vector.search,
        queries: [query],
        candidates,
        limit: Math.max(1, candidates.length),
        timeoutMs,
      });
    } catch {
      return fallback('vector-error');
    }
    if (phase.timedOut) return fallback('timeout');
    if (phase.result.fallbackReason) {
      rebuild();
      return fallback(phase.result.fallbackReason);
    }
    const keywordResult = await keyword(query, {
      ...options,
      offset: 0,
      limit: Math.max(1, candidates.length),
    });
    const ranked = fuseHybridRankings({
      vectorRankings: phase.result.rankings,
      keywordRankings: [keywordResult.hits.map((hit) => ({ ref: { type: hit.type, id: hit.id } }))],
      allowedRefs: candidates.map((document) => document.ref),
      limit: candidates.length,
    });
    // A request may overlap a parser or item update. Obsolete vectors must not
    // be blended into the current keyword ranking.
    const current = projection.candidates(options);
    if (
      !isEnabled() ||
      current.length !== candidates.length ||
      current.some(
        (document, index) =>
          document.version !== candidates[index].version ||
          hybridRefKey(document.ref) !== hybridRefKey(candidates[index].ref),
      )
    ) {
      rebuild();
      return fallback('index-incomplete');
    }
    const hits = ranked
      .slice(offset, offset + limit)
      .map((row) => projection.hit(row.ref, row.score));
    return {
      query,
      hits,
      total: ranked.length,
      remaining: Math.max(0, ranked.length - offset - hits.length),
      offset,
      limit,
      mode: 'hybrid',
    };
  };
}
