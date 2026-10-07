import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, initialState } from './state.js';
import { createOutboxActions } from './outbox-actions.js';

test('late queue reads cannot revive a dispatched draft after its newer event', async () => {
  const latest = { meetingId: 'meeting', version: 3, paused: false, items: [] };
  const old = { ...latest, version: 2, items: [{ id: 'draft', text: 'already sent' }] };
  let state = applyEvent(initialState, { type: 'meeting.outbox.changed', payload: latest });
  const store = /** @type {any} */ ({
    update: (change) => {
      state = change(state);
    },
  });
  const api = /** @type {any} */ ({ get: async () => old });
  const actions = createOutboxActions(api, store);
  await actions.loadOutbox('meeting');
  assert.deepEqual(state.outboxes.meeting, latest);
  assert.equal(applyEvent(state, { type: 'meeting.outbox.changed', payload: old }), state);
});
