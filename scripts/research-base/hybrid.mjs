// Shared, storage-agnostic primitives for hybrid retrieval.
export const HYBRID_RRF_K = 60;
export const HYBRID_VECTOR_LIMIT = 30;
export const HYBRID_VECTOR_TIMEOUT_MS = 300;
export const HYBRID_FALLBACK_REASONS = Object.freeze([
  'timeout', 'model-missing', 'index-incomplete', 'model-version-mismatch',
]);

export function hybridRefKey(ref) {
  return `${ref?.type ?? ''}:${ref?.id ?? ''}`;
}

function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function invalidQuery(message) {
  const error = new TypeError(message);
  error.code = 'INVALID_QUERY';
  return error;
}

/** Accept complete legacy/multi-query inputs, preserving first-seen order. */
export function normalizeHybridQueries({ query, queries } = {}) {
  if (queries !== undefined && (!Array.isArray(queries) || queries.length === 0)) {
    throw invalidQuery('检索问法须为非空数组。');
  }
  const supplied = [...(query === undefined ? [] : [query]), ...(queries ?? [])];
  if (!supplied.length) throw invalidQuery('请输入检索词。');
  const result = [];
  const seen = new Set();
  for (const value of supplied) {
    if (typeof value !== 'string') throw invalidQuery('检索问法必须是文本。');
    const text = value.trim();
    if (!text) throw invalidQuery('检索问法不能为空。');
    const key = text.normalize('NFKC').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  if (!result.length) throw invalidQuery('请输入检索词。');
  return result;
}

/** Run all query embeddings/rankings behind one shared deadline and abort signal. */
export async function runVectorPhase({ search, queries, candidates, limit = HYBRID_VECTOR_LIMIT, timeoutMs = HYBRID_VECTOR_TIMEOUT_MS, signal } = {}) {
  if (typeof search !== 'function') throw new TypeError('vector search callback is required');
  if (signal?.aborted) return { timedOut: true };
  const startedAt = performance.now();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  if (timeoutMs <= 0) {
    controller.abort();
    signal?.removeEventListener('abort', forwardAbort);
    return { timedOut: true };
  }
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, timeoutMs);
  });
  const work = Promise.resolve().then(() => search({ queries, candidates, limit, signal: controller.signal }));
  try {
    const result = await Promise.race([work, timeout]);
    if (result?.timedOut || performance.now() - startedAt >= timeoutMs) {
      controller.abort();
      return { timedOut: true };
    }
    return { result };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/** Weighted RRF over per-query rankings; candidate filtering precedes rank assignment. */
export function fuseHybridRankings({
  vectorRankings = [], keywordRankings = [], allowedRefs, limit = 8,
  k = HYBRID_RRF_K, vectorWeight = 1, keywordWeight = 0.5,
} = {}) {
  const allowed = allowedRefs instanceof Set || Array.isArray(allowedRefs)
    ? new Set([...allowedRefs].map((entry) => typeof entry === 'string' ? entry : hybridRefKey(entry?.ref ?? entry)))
    : null;
  const fused = new Map();
  const addRanked = (rows, weight, queryIndex, captureHit) => {
    const input = Array.isArray(rows[queryIndex]) ? rows[queryIndex] : [];
    const seen = new Set();
    const visible = [];
    for (const row of input) {
      const ref = row?.ref ?? row;
      if (!ref || typeof ref.type !== 'string' || typeof ref.id !== 'string') continue;
      const key = hybridRefKey(ref);
      if ((allowed && !allowed.has(key)) || seen.has(key)) continue;
      seen.add(key);
      visible.push({ ref, key, row });
    }
    visible.forEach(({ ref, key, row }, index) => {
      const score = weight / (k + index + 1);
      const current = fused.get(key);
      if (current) {
        current.score += score;
        if (!current.hit && captureHit) current.hit = row;
      } else fused.set(key, { ref, score, ...(captureHit ? { hit: row } : {}) });
    });
  };
  const queryCount = Math.max(vectorRankings.length, keywordRankings.length);
  for (let queryIndex = 0; queryIndex < queryCount; queryIndex += 1) {
    addRanked(vectorRankings, vectorWeight, queryIndex, false);
    addRanked(keywordRankings, keywordWeight, queryIndex, true);
  }
  return [...fused.values()].sort((a, b) => b.score - a.score || compareCodeUnits(hybridRefKey(a.ref), hybridRefKey(b.ref)))
    .slice(0, Math.max(0, Math.floor(Number(limit) || 0)));
}
