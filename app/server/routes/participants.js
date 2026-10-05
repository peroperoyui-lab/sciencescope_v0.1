import { LOCAL_USER_ID } from '../../core/defaults.js';

const user = { actorId: LOCAL_USER_ID };

/** @param {import('../router.js').Router} router @param {import('../../core/index.js').Core} core */
export function registerParticipantRoutes(router, core) {
  router.get('/api/participants', () => core.participants.list());
  router.post('/api/participants', ({ body }) => core.participants.create(body, user));
  router.get('/api/participants/:id', ({ params }) => core.participants.get(params.id));
  router.patch('/api/participants/:id', async ({ params, body }) => {
    const participant = await core.participants.get(params.id);
    if (participant.kind === 'ai') {
      return core.participants.updateDefinition(params.id, body.definition ?? body, user);
    }
    core.participants.rename(params.id, body.name);
    return core.participants.get(params.id);
  });
}
