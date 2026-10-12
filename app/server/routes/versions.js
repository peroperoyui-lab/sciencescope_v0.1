/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/versions/index.js').createVersions>} versions
 */
export function registerVersionRoutes(router, versions) {
  if (!versions) return;
  router.get('/api/versions', ({ query }) => versions.list(query.get('projectId') ?? ''));
  router.post('/api/versions/import', ({ body }) =>
    versions.importFiles(body, { actorId: 'person_user' }),
  );
  router.patch('/api/version-groups/:id', ({ params, body }) =>
    versions.renameGroup(params.id, body.name),
  );
  router.get('/api/versions/:id', ({ params, query }) =>
    versions.read(params.id, {
      offset: Number(query.get('offset') ?? 0),
      limit: Number(query.get('limit') ?? 20),
    }),
  );
  router.delete('/api/versions/:id', ({ params }) => versions.remove(params.id));
  router.post('/api/versions/:id/open', ({ params, body }) =>
    versions.openOriginal(params.id, body.reveal === true),
  );
}
