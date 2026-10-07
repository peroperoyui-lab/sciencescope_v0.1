import { LOCAL_USER_ID } from '../../core/defaults.js';

/** @param {import('../router.js').Router} router @param {import('../../core/index.js').Core} core */
export function registerOutboxRoutes(router, core) {
  router.get('/api/meetings/:id/outbox', ({ params }) => core.outbox.list(params.id));
  router.post('/api/meetings/:id/outbox', ({ params, body }) =>
    core.outbox.enqueue({
      meetingId: params.id,
      authorId: body.authorId ?? LOCAL_USER_ID,
      text: body.text,
      refs: body.refs,
      replyTo: body.replyTo,
    }),
  );
  router.patch('/api/meetings/:id/outbox/:itemId', ({ params, body }) =>
    core.outbox.edit(params.id, params.itemId, body),
  );
  router.delete('/api/meetings/:id/outbox/:itemId', ({ params }) =>
    core.outbox.cancel(params.id, params.itemId),
  );
  router.delete('/api/meetings/:id/outbox', ({ params }) => core.outbox.cancel(params.id));
  router.post('/api/meetings/:id/outbox/pause', ({ params }) =>
    core.outbox.setPaused(params.id, true),
  );
  router.post('/api/meetings/:id/outbox/resume', ({ params }) =>
    core.outbox.setPaused(params.id, false),
  );
}
