import { LOCAL_USER_ID } from '../../core/defaults.js';

const user = { actorId: LOCAL_USER_ID };

/** @param {import('../router.js').Router} router @param {import('../../core/index.js').Core} core */
export function registerWorkspaceRoutes(router, core) {
  router.get('/api/resources', () => core.workspace.resources());
  router.get('/api/resources/:resource', ({ params, query }) =>
    core.workspace.read({ resource: params.resource, key: query.get('key') ?? '' }),
  );
  router.get('/api/resources/:resource/keys', ({ params, query }) =>
    core.workspace.list({ resource: params.resource, scope: query.get('scope') ?? '' }),
  );
  router.post('/api/resources/:resource', ({ params, body }) =>
    core.workspace.edit(
      {
        resource: params.resource,
        key: body.key,
        op: body.op,
        args: body.args,
        ...(Object.hasOwn(body, 'expectedRevisionId')
          ? { expectedRevisionId: body.expectedRevisionId }
          : {}),
      },
      user,
    ),
  );

  router.get('/api/snapshots', ({ query }) =>
    core.workspace.snapshots({
      projectId: query.get('projectId') ?? undefined,
      resource: query.get('resource') ?? undefined,
      key: query.get('key') ?? undefined,
      meetingId: query.get('meetingId') ?? undefined,
      limit: query.get('limit') ? Number(query.get('limit')) : undefined,
    }),
  );
  router.post('/api/snapshots', ({ body }) => core.workspace.captureSnapshot(body, user));
  router.get('/api/snapshots/:id', ({ params }) => core.workspace.getSnapshot(params.id));
  router.post('/api/snapshots/:id/restore', ({ params }) =>
    core.workspace.restoreSnapshot(params.id, user),
  );
  router.delete('/api/snapshots/:id', ({ params }) =>
    core.workspace.deleteSnapshot(params.id, user),
  );

  router.get('/api/revisions', ({ query }) =>
    core.workspace.history({
      resource: query.get('resource') ?? undefined,
      key: query.get('key') ?? undefined,
      meetingId: query.get('meetingId') ?? undefined,
      limit: query.get('limit') ? Number(query.get('limit')) : undefined,
    }),
  );
  router.get('/api/revisions/:id', ({ params }) => core.workspace.getRevision(params.id));
  router.post('/api/revisions/:id/undo', ({ params }) => core.workspace.undo(params.id, user));

  router.get(
    '/api/settings',
    async () => (await core.workspace.read({ resource: 'settings', key: 'app' })).value,
  );
  router.patch('/api/settings', async ({ body }) => {
    const result = await core.workspace.edit(
      { resource: 'settings', key: 'app', op: 'patch', args: { changes: body } },
      user,
    );
    return result.value;
  });
}
