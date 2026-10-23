import { createDeskRewrite } from '../../services/desk/rewrite.js';

/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/desk/index.js').createDesk>} desk
 * @param {import('../../core/index.js').Core} [core]
 * @param {ReturnType<typeof import('../../services/conductor.js').createConductor>} [conductor]
 */
export function registerDeskRoutes(router, desk, core, conductor) {
  if (!desk) return;
  const actor = { actorId: 'person_user' };
  const rewrite = core && createDeskRewrite(core, desk, conductor);
  router.get('/api/desk/tex/engines', ({ query }) => desk.texEngines(query.get('refresh') === '1'));
  router.post('/api/desk/sessions/:id/compile', ({ params, body }) =>
    desk.compile(params.id, body),
  );
  router.get('/api/desk/sessions/:id/pdf', async ({ params, response }) => {
    const bytes = await desk.compiledPdf(params.id);
    response.writeHead(200, {
      'content-type': 'application/pdf',
      'cache-control': 'no-store',
      'content-length': bytes.length,
    });
    response.end(bytes);
  });
  router.post('/api/desk/enter', ({ body }) => desk.enter(body));
  router.post('/api/desk/focus', ({ body }) => desk.focus(body));
  router.get('/api/desk/sessions/:id/annotations', ({ params }) => desk.listAnnotations(params.id));
  router.post('/api/desk/sessions/:id/annotations', ({ params, body }) =>
    desk.createAnnotation(params.id, body, actor),
  );
  router.patch('/api/desk/annotations/:id', ({ params, body }) =>
    desk.updateAnnotation(params.id, body, actor),
  );
  router.delete('/api/desk/annotations/:id', ({ params }) =>
    desk.updateAnnotation(params.id, {}, actor, { remove: true }),
  );
  router.post('/api/desk/sessions/:id/rewrite', async ({ params, body, response }) => {
    const controller = new AbortController();
    const close = () => controller.abort();
    response.once('close', close);
    try {
      return await rewrite(params.id, body, controller.signal);
    } finally {
      response.removeListener('close', close);
    }
  });
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
      // Pictures come from third-party documents; an SVG must never run as a page.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
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
