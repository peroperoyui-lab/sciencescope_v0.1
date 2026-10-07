import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnUsage } from './usage.js';

test('settled retries preserve reported tokens and expose attempts without provider usage', () => {
  const usage = createTurnUsage();
  usage.add({ inputTokens: 100, cacheReadTokens: 20, outputTokens: 10 });
  usage.add(undefined);
  usage.add({ inputTokens: 50, outputTokens: 5, totalTokens: 55 });
  assert.deepEqual(usage.value(), {
    inputTokens: 150,
    outputTokens: 15,
    cacheReadTokens: 20,
    cacheWriteTokens: 0,
    totalTokens: 185,
    requests: 3,
    unknownRequests: 1,
  });
});
