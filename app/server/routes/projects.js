import { LOCAL_USER_ID } from '../../core/defaults.js';

const user = { actorId: LOCAL_USER_ID };

/** @param {import('../router.js').Router} router @param {import('../../core/index.js').Core} core */
export function registerProjectRoutes(router, core) {
  router.get('/api/projects', ({ query }) =>
    core.projects.list({ includeArchived: query.get('archived') === '1' }),
  );
  router.post('/api/projects', ({ body }) => core.projects.create(body, user));
  router.get('/api/projects/:id', ({ params }) => core.projects.get(params.id));
  router.patch('/api/projects/:id', ({ params, body }) =>
    core.projects.update(params.id, body, user),
  );
}
