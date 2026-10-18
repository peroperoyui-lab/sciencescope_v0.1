import { applyEvent } from './state.js';

/**
 * Activity badges: what is running or queued in each meeting, and which
 * failures the person has already seen.
 * @param {import('./api.js').Api} api
 * @param {import('./state.js').Store} store
 */
export function createActivityActions(api, store) {
  /**
   * @param {string|null} meetingId
   */
  function viewMeeting(meetingId) {
    store.update((state) => {
      const latest = Object.values(state.turns)
        .filter((turn) => turn.meetingId === meetingId && turn.participantId !== 'agent_secretary')
        .sort((left, right) => (right.endedAt ?? '').localeCompare(left.endedAt ?? ''))[0];
      return {
        ...state,
        activeMeetingId: meetingId,
        acknowledgedActivity:
          latest?.status === 'failed'
            ? { ...state.acknowledgedActivity, [meetingId]: latest.endedAt }
            : state.acknowledgedActivity,
      };
    });
  }
  return {
    viewMeeting,
    async loadActivity() {
      const snapshot = await api.get('/api/activity');
      for (const outbox of snapshot.outboxes)
        store.update((state) =>
          applyEvent(state, { type: 'meeting.outbox.changed', payload: outbox }),
        );
      for (const turn of snapshot.running)
        store.update((state) => applyEvent(state, { type: 'turn.started', payload: turn }));
    },
  };
}
