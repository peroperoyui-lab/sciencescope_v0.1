import { createMessageExtras } from '../../services/message-extras.js';

/**
 * @param {import('../router.js').Router} router
 * @param {import('../../core/index.js').Core} core
 * @returns {void}
 */
export function registerMessageExtrasRoutes(router, core) {
  const extras = createMessageExtras(core);
  router.get('/api/meetings/:id/message-extras', ({ params, query }) =>
    extras.get(params.id, query.has('ids') ? query.get('ids').split(',') : []),
  );
}
