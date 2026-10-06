// Deadline and weighted reciprocal-rank fusion shared by local hybrid retrieval.
export const HYBRID_VECTOR_TIMEOUT_MS = 300;

/** @param {{type:string,id:string}} ref @returns {string} */
export function hybridRefKey(ref) {
  return `${ref.type}:${ref.id}`;
}

/** The whole vector phase has one deadline; timed-out work cannot publish a partial ranking.
 * @param {{search:(input:any)=>Promise<any>,queries:string[],candidates:any[],limit:number,timeoutMs?:number,signal?:AbortSignal}} input
 * @returns {Promise<any>}
 */
export async function runVectorPhase({
  search,
  queries,
  candidates,
  limit,
  timeoutMs = HYBRID_VECTOR_TIMEOUT_MS,
  signal,
}) {
  if (signal?.aborted || timeoutMs <= 0) return { timedOut: true };
  const startedAt = performance.now();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, timeoutMs);
  });
  try {
    const work = Promise.resolve().then(() =>
      search({ queries, candidates, limit, signal: controller.signal }),
    );
    const result = await Promise.race([work, timeout]);
    if (result?.timedOut || performance.now() - startedAt >= timeoutMs) {
      controller.abort();
      return { timedOut: true };
    }
    return { result };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/** Allowed candidates are filtered before assigning ranks; ties use reference order.
 * @param {{vectorRankings:any[][],keywordRankings:any[][],allowedRefs:Array<{type:string,id:string}>,limit:number}} input
 * @returns {Array<{ref:{type:string,id:string},score:number}>}
 */
export function fuseHybridRankings({ vectorRankings, keywordRankings, allowedRefs, limit }) {
  const allowed = new Set(allowedRefs.map(hybridRefKey));
  const fused = new Map();
  function add(rows, weight) {
    const seen = new Set();
    let rank = 0;
    for (const row of rows) {
      const key = hybridRefKey(row.ref);
      if (!allowed.has(key) || seen.has(key)) continue;
      seen.add(key);
      rank++;
      const score = weight / (60 + rank);
      const previous = fused.get(key);
      if (previous) previous.score += score;
      else fused.set(key, { ref: row.ref, score });
    }
  }
  for (const rows of vectorRankings) add(rows, 1);
  for (const rows of keywordRankings) add(rows, 0.5);
  return [...fused.values()]
    .sort(
      (left, right) =>
        right.score - left.score || (hybridRefKey(left.ref) < hybridRefKey(right.ref) ? -1 : 1),
    )
    .slice(0, limit);
}
