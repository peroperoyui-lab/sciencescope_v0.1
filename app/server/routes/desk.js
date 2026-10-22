/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/desk/index.js').createDesk>} desk
 */
export function registerDeskRoutes(router, desk) {
  if (!desk) return;
  const actor = { actorId: 'person_user' };
  router.post('/api/desk/documents', ({ body }) => desk.registerDocument(body));
  router.post('/api/desk/sessions', ({ body }) => desk.openSession(body));
  router.get('/api/desk/sessions/:id', ({ params }) => desk.getSession(params.id));
  router.patch('/api/desk/sessions/:id/blocks', ({ params, body }) =>
    desk.updateBlocks(params.id, body, actor),
  );
  router.post('/api/desk/changes/:id/undo', ({ params }) => desk.undoChange(params.id, actor));
  router.post('/api/desk/sessions/:id/settle', ({ params, body }) =>
    desk.settleChanges(params.id, body.ids),
  );
  router.post('/api/desk/sessions/:id/save', ({ params, body }) =>
    desk.save(params.id, body, actor),
  );
  router.post('/api/desk/sessions/:id/close', ({ params }) => desk.closeSession(params.id, actor));
}
