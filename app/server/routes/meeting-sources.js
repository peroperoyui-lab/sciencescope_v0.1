import { createMeetingSources } from '../../services/meeting-sources.js';

/**
 * @param {import('../router.js').Router} router
 * @param {import('../../core/index.js').Core} core
 * @returns {void}
 */
export function registerMeetingSourcesRoutes(router, core) {
  const sources = createMeetingSources(core);
  router.get('/api/meetings/:id/sources', ({ params }) => sources.get(params.id));
}
