// Attached secretary meetings and durable editable main-draft proposals.
/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/secretary/chat.js').createSecretaryChat>} [secretary]
 */
export function registerSecretaryRoutes(router, secretary) {
  if (!secretary) return;
  router.post('/api/meetings/:id/secretary', ({ params }) => {
    secretary.ensure(params.id);
    return secretary.snapshot(params.id);
  });
  router.get('/api/meetings/:id/secretary', ({ params }) => secretary.snapshot(params.id));
  router.get('/api/meetings/:id/secretary/proposals', ({ params }) => secretary.list(params.id));
  router.patch('/api/secretary/proposals/:id', ({ params, body }) =>
    secretary.decide(params.id, body),
  );
  router.get('/api/secretary/proposals/:id/history', ({ params }) => secretary.history(params.id));
  router.post('/api/secretary/proposal-revisions/:id/undo', ({ params }) =>
    secretary.undo(params.id),
  );
}
