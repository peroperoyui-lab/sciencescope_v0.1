import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EVENT_TYPES } from './api.js';
import { applyEvent, initialState } from './state.js';

test('every event the interface reduces is subscribed on the event stream', async () => {
  const source = await readFile(new URL('./state.js', import.meta.url), 'utf8');
  const handled = [...source.matchAll(/case '([a-z]+\.[a-z.]+)'/gu)].map((match) => match[1]);
  assert.ok(handled.length > 20);
  assert.deepEqual(
    handled.filter((type) => !EVENT_TYPES.includes(type)),
    [],
  );
});

test('a finished graph layout refreshes positions; a failed one is reported', () => {
  const moved = applyEvent(initialState, {
    type: 'knowledge.layout.changed',
    payload: { all: true },
  });
  assert.equal(moved.layoutVersion, initialState.layoutVersion + 1);
  const failed = applyEvent(moved, {
    type: 'knowledge.layout.changed',
    payload: { error: '超时' },
  });
  assert.equal(failed.layoutVersion, moved.layoutVersion);
  assert.equal(failed.layoutError?.message, '超时');
  const derived = applyEvent(initialState, { type: 'knowledge.changed', payload: { refs: [] } });
  assert.equal(derived.researchVersion, initialState.researchVersion + 1);
});
