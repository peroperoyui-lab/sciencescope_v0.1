import { applyEvent } from './state.js';

/**
 * @param {import('./api.js').Api} api
 * @param {import('./state.js').Store} store
 */
export function createGoalActions(api, store) {
  const apply = (goal) => {
    if (goal) store.update((state) => applyEvent(state, { type: 'goal.changed', payload: goal }));
    return goal;
  };
  /**
   * @param {string|null} meetingId
   */
  function viewMeeting(meetingId) {
    store.update((state) => {
      const goal = state.goals[meetingId];
      const latest = Object.values(state.turns)
        .filter((turn) => turn.meetingId === meetingId && turn.participantId !== 'agent_secretary')
        .sort((left, right) => (right.endedAt ?? '').localeCompare(left.endedAt ?? ''))[0];
      const terminalTime =
        goal && ['completed', 'failed'].includes(goal.status)
          ? goal.updatedAt
          : latest?.status === 'failed'
            ? latest.endedAt
            : null;
      return {
        ...state,
        activeMeetingId: meetingId,
        acknowledgedActivity: terminalTime
          ? { ...state.acknowledgedActivity, [meetingId]: terminalTime }
          : state.acknowledgedActivity,
      };
    });
  }
  return {
    viewMeeting,
    async loadActivity() {
      const snapshot = await api.get('/api/activity');
      for (const goal of snapshot.goals) apply(goal);
      for (const outbox of snapshot.outboxes)
        store.update((state) =>
          applyEvent(state, { type: 'meeting.outbox.changed', payload: outbox }),
        );
      for (const turn of snapshot.running)
        store.update((state) => applyEvent(state, { type: 'turn.started', payload: turn }));
    },
    /**
     * @param {string} meetingId
     */
    async loadGoal(meetingId) {
      return apply(await api.get(`/api/meetings/${meetingId}/goal`));
    },
    /**
     * @param {string} meetingId
     * @param {string} text
     * @param {number} maxRounds
     * @param {any} [researchInput]
     */
    async startGoal(meetingId, text, maxRounds, researchInput) {
      return apply(
        await api.post(`/api/meetings/${meetingId}/goal`, { text, maxRounds, researchInput }),
      );
    },
    /**
     * @param {string} meetingId
     * @param {{action?:string,maxRounds?:number}} options
     */
    async controlGoal(meetingId, options) {
      return apply(await api.patch(`/api/meetings/${meetingId}/goal`, options));
    },
  };
}
