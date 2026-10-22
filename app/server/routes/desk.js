/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/desk/index.js').createDesk>} desk
 */
export function registerDeskRoutes(router, desk) {
  if (!desk) return;
  const actor = { actorId: 'person_user' };
  router.get('/api/desk/documents', ({ query }) => desk.listDocuments(query.get('projectId')));
  router.post('/api/desk/documents', ({ body }) => desk.registerDocument(body));
  router.post('/api/desk/sessions', ({ body }) => desk.openSession(body));
  router.get('/api/desk/sessions/:id', ({ params }) => desk.getSession(params.id));
  router.patch('/api/desk/sessions/:id/blocks', ({ params, body }) =>
    desk.updateBlocks(params.id, body, actor),
  );
  router.put('/api/desk/sessions/:id/text', ({ params, body }) =>
    desk.updateText(params.id, body, actor),
  );
  router.get('/api/desk/sessions/:id/media/:ref', async ({ params, response }) => {
    const media = await desk.media(params.id, params.ref);
    response.writeHead(200, {
      'content-type': media.mimeType,
      'content-length': media.bytes.length,
    });
    response.end(media.bytes);
  });
  router.post('/api/desk/changes/:id/undo', ({ params }) => desk.undoChange(params.id, actor));
  router.post('/api/desk/sessions/:id/settle', ({ params, body }) =>
    desk.settleChanges(params.id, body.ids),
  );
  router.post('/api/desk/sessions/:id/save', ({ params, body }) =>
    desk.save(params.id, body, actor),
  );
  router.post('/api/desk/sessions/:id/close', ({ params }) => desk.closeSession(params.id, actor));
}
