import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyEvent, createStore } from './state.js';
import { meetingActivity } from './activity.js';
import { createGoalActions } from './goal-actions.js';

test('background ordinary replies and queued messages show activity without loading their transcript', () => {
  let state = applyEvent(initialState, {
    type: 'turn.started',
    payload: { id: 'turn', meetingId: 'meeting', participantId: 'agent_main', startedAt: '1' },
  });
  assert.equal(meetingActivity(state, 'meeting').status, 'running');
  state = applyEvent(state, {
    type: 'turn.ended',
    payload: {
      id: 'turn',
      meetingId: 'meeting',
      participantId: 'agent_main',
      status: 'done',
      endedAt: '2',
    },
  });
  assert.equal(meetingActivity(state, 'meeting'), null);
  state = applyEvent(state, {
    type: 'meeting.outbox.changed',
    payload: { meetingId: 'meeting', items: [{ updatedAt: '3' }], paused: false },
  });
  assert.equal(meetingActivity(state, 'meeting').status, 'queued');
});

test('opening a completed goal acknowledges its badge and stale goal snapshots cannot revive it', async () => {
  const done = { meetingId: 'meeting', status: 'completed', updatedAt: '3' };
  const store = createStore(applyEvent(initialState, { type: 'goal.changed', payload: done }));
  assert.equal(meetingActivity(store.get(), 'meeting').status, 'completed');
  const api = /** @type {any} */ ({
    get: async () => ({ ...done, status: 'running', updatedAt: '2' }),
  });
  const actions = createGoalActions(api, store);
  actions.viewMeeting('meeting');
  assert.equal(meetingActivity(store.get(), 'meeting'), null);
  await actions.loadGoal('meeting');
  assert.equal(store.get().goals.meeting.status, 'completed');
});
