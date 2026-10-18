import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyEvent, createStore } from './state.js';
import { meetingActivity } from './activity.js';
import { createActivityActions } from './activity-actions.js';

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

test('opening a meeting acknowledges a failed answer badge', () => {
  const failed = {
    id: 'turn',
    meetingId: 'meeting',
    participantId: 'agent_main',
    status: 'failed',
    endedAt: '3',
  };
  const store = createStore(applyEvent(initialState, { type: 'turn.ended', payload: failed }));
  assert.equal(meetingActivity(store.get(), 'meeting').status, 'failed');
  createActivityActions(/** @type {any} */ ({}), store).viewMeeting('meeting');
  assert.equal(meetingActivity(store.get(), 'meeting'), null);
});
