// DSH reports usage on settled assistant attempts, not on turn/end. Cache
// counters are disjoint from uncached input; interrupted/retried attempts count
// too. Unknown samples stay explicit so callers can add their own estimate.
/**
 * @returns {{add:(sample:any)=>void,value:()=>any}}
 */
export function createTurnUsage() {
  const total = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    requests: 0,
    unknownRequests: 0,
  };
  return {
    add(sample) {
      total.requests += 1;
      if (
        !sample ||
        !Number.isFinite(sample.inputTokens) ||
        !Number.isFinite(sample.outputTokens)
      ) {
        total.unknownRequests += 1;
        return;
      }
      for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'])
        total[key] += sample[key] ?? 0;
      total.totalTokens += Number.isFinite(sample.totalTokens)
        ? sample.totalTokens
        : sample.inputTokens +
          sample.outputTokens +
          (sample.cacheReadTokens ?? 0) +
          (sample.cacheWriteTokens ?? 0);
    },
    value: () => ({ ...total }),
  };
}
