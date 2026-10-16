/**
 * SDK cache usage is separate from input; context includes cached input too.
 * A failed request with no reported usage is unknown, never a free request.
 * @param {any[]} requests
 * @param {number} contextWindow
 */
export function aggregateUsage(requests, contextWindow) {
  const reported = requests.filter((request) => request.known);
  const sum = (field) =>
    reported.length
      ? reported.reduce((total, request) => total + (request.usage?.[field] ?? 0), 0)
      : null;
  const last = requests.at(-1);
  const usage = last?.known ? last.usage : null;
  return {
    inputTokens: sum('input'),
    outputTokens: sum('output'),
    cacheReadTokens: sum('cacheRead'),
    cacheWriteTokens: sum('cacheWrite'),
    reasoningTokens: reported.some((request) => request.usage?.reasoning !== undefined)
      ? sum('reasoning')
      : null,
    totalTokens: sum('totalTokens'),
    requests: requests.length,
    unknownRequests: requests.length - reported.length,
    context: {
      usedTokens: usage ? usage.input + usage.output + usage.cacheRead + usage.cacheWrite : null,
      contextWindow,
      estimated: !usage,
    },
  };
}
