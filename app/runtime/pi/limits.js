// Resource timeouts, not output limits. Tests inject short values here.
export const REQUEST_LIMITS = {
  firstEventMs: 90_000,
  idleEventMs: 120_000,
  timeoutMs: 60 * 60 * 1000,
  maxAttempts: 3,
  retryDelaysMs: [2000, 6000],
  maxRetryAfterMs: 60_000,
};
