import { LOCAL_USER_ID } from '../../core/defaults.js';

const user = { actorId: LOCAL_USER_ID };

/** @param {string | null} value */
function optionalNumber(value) {
  return value == null || value === '' ? undefined : Number(value);
}

/**
 * Posting a message stores it; the conductor reacts to the stored event and
 * starts the answers, so this route does not wait for them.
 * @param {import('../router.js').Router} router
 * @param {import('../../core/index.js').Core} core
 * @param {{ interrupt: (meetingId: string) => Promise<void> }} [conductor]
 */
export function registerMeetingRoutes(router, core, conductor) {
  router.get('/api/meetings', ({ query }) => {
    const projectId = query.get('projectId');
    return core.meetings.list({
      projectId: query.get('global') === '1' ? null : (projectId ?? undefined),
      attachedTo: query.get('attachedTo') ?? undefined,
      includeArchived: query.get('archived') === '1',
    });
  });
  router.post('/api/meetings', ({ body }) => core.meetings.create(body, user));
  router.get('/api/meetings/:id', ({ params }) => core.meetings.get(params.id));
  router.patch('/api/meetings/:id', ({ params, body }) =>
    core.meetings.update(params.id, body, user),
  );
  router.post('/api/meetings/:id/fork', ({ params, body }) =>
    core.meetings.fork(params.id, body, user),
  );

  router.get('/api/meetings/:id/messages', ({ params, query }) =>
    core.messages.list(params.id, {
      before: optionalNumber(query.get('before')),
      after: optionalNumber(query.get('after')),
      limit: optionalNumber(query.get('limit')),
    }),
  );
  router.post('/api/meetings/:id/messages', ({ params, body }) =>
    core.messages.post({
      meetingId: params.id,
      authorId: body.authorId ?? LOCAL_USER_ID,
      text: body.text,
      refs: body.refs,
      replyTo: body.replyTo,
    }),
  );
  router.post('/api/meetings/:id/interrupt', async ({ params }) => {
    await conductor?.interrupt(params.id);
    return { interrupted: true };
  });
  router.get('/api/turns/:id', ({ params }) => ({
    turn: core.turns.get(params.id),
    toolCalls: core.turns.toolCalls(params.id),
  }));
  router.patch('/api/messages/:id', ({ params, body }) =>
    core.messages.update(params.id, { adopted: body.adopted }),
  );
}
