/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/versions/index.js').createVersions>} versions
 * @param {ReturnType<typeof import('../../services/versions/organizer.js').createVersionOrganizer>} [organizer]
 */
export function registerVersionRoutes(router, versions, organizer) {
  if (!versions) return;
  router.get('/api/versions', ({ query }) => versions.list(query.get('projectId') ?? ''));
  router.post('/api/versions/import', ({ body }) =>
    versions.importFiles(body, { actorId: 'person_user' }),
  );
  router.get('/api/version-groups/:id/graph', ({ params }) => versions.graph(params.id));
  router.patch('/api/versions/:id', ({ params, body }) => versions.updateMetadata(params.id, body));
  router.post('/api/version-tiers/rename', ({ body }) => versions.renameTier(body.from, body.to));
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
  router.post('/api/versions/:id/open-notes', ({ params }) => versions.openNotes(params.id));
  router.patch('/api/versions/:id/notes', ({ params, body }) =>
    versions.editNotes(params.id, body.text, body.revisionId),
  );
  router.get('/api/versions/:id/compare', ({ params, query }) =>
    versions.compare(
      params.id,
      query.has('baseline') ? query.get('baseline') || null : versions.get(params.id).baselineId,
    ),
  );
  router.get('/api/versions/:id/diff', ({ params, query }) =>
    versions.diff(params.id, query.has('baseline') ? query.get('baseline') : undefined),
  );
  router.post('/api/versions/:id/save-as-new', ({ params }) =>
    versions.saveAsNew(params.id, { actorId: 'person_user' }),
  );
  if (!organizer) return;
  router.get('/api/version-preferences/:projectId', ({ params }) => ({
    autoOrganize: organizer.autoOrganize(params.projectId),
  }));
  router.patch('/api/version-preferences/:projectId', ({ params, body }) =>
    organizer.configure(params.projectId, body.autoOrganize),
  );
  router.patch('/api/versions/:id/baseline', ({ params, body }) =>
    organizer.baseline(params.id, body.baselineId),
  );
  router.post('/api/versions/:id/organize', ({ params }) => organizer.refresh(params.id));
}
