import { applyEvent } from './state.js';
// The queued input belongs to the meeting and survives closing its window.
/**
 * @param {import('./api.js').Api} api
 * @param {import('./state.js').Store} store
 */
export function createOutboxActions(api, store) {
  const apply = (state) => {
    store.update((current) =>
      applyEvent(current, { type: 'meeting.outbox.changed', payload: state }),
    );
    return state;
  };
  return {
    /** @param {string} meetingId */
    async loadOutbox(meetingId) {
      return apply(await api.get('/api/meetings/' + meetingId + '/outbox'));
    },
    /** @param {string} meetingId @param {string} itemId @param {string} text */
    async editOutbox(meetingId, itemId, text) {
      return apply(await api.patch('/api/meetings/' + meetingId + '/outbox/' + itemId, { text }));
    },
    /** @param {string} meetingId @param {string} [itemId] */
    async cancelOutbox(meetingId, itemId) {
      return apply(
        await api.request(
          'DELETE',
          '/api/meetings/' + meetingId + '/outbox' + (itemId ? '/' + itemId : ''),
        ),
      );
    },
    /** @param {string} meetingId */
    async resumeOutbox(meetingId) {
      return apply(await api.post('/api/meetings/' + meetingId + '/outbox/resume'));
    },
    /** @param {string} meetingId */
    async pauseOutbox(meetingId) {
      return apply(await api.post('/api/meetings/' + meetingId + '/outbox/pause'));
    },
  };
}
