import { LOCAL_USER_ID } from '../../core/defaults.js';
import { createResearch } from '../../services/research/index.js';

/** @param {import('../router.js').Router} router @param {import('../../core/index.js').Core} core */
export function registerResearchRoutes(router, core) {
  const research = createResearch(core);
  const actor = { actorId: LOCAL_USER_ID };
  const options = (query) => ({
    ...(query.has('projectId') ? { projectId: query.get('projectId') || null } : {}),
    includePersonal: query.get('includePersonal') !== '0',
    includeSuperseded: query.get('includeSuperseded') === '1',
    ...(query.has('limit') ? { limit: Number(query.get('limit')) } : {}),
    ...(query.has('offset') ? { offset: Number(query.get('offset')) } : {}),
    audience: /** @type {'user'} */ ('user'),
  });
  router.get('/api/research/sources', ({ query }) => research.store.listSources(options(query)));
  router.post('/api/research/sources', ({ body }) =>
    research.importSource(
      { ...body, bytes: Buffer.from(String(body.base64 ?? ''), 'base64') },
      actor,
    ),
  );
  router.get('/api/research/sources/:id', ({ params, query }) =>
    research.read({ ...options(query), type: 'source', id: params.id }),
  );
  router.get('/api/research/search', ({ query }) =>
    research.search(query.get('q') ?? '', options(query)),
  );
  router.get('/api/research/items', ({ query }) => research.store.listItems(options(query)));
  router.post('/api/research/items', ({ body }) =>
    body.supersedes
      ? research.store.supersedeItem(body.supersedes, body, actor)
      : research.store.createItem(body, actor),
  );
  router.patch('/api/research/items', ({ body }) =>
    research.store.updateItem(body.id, body, actor),
  );
  router.get('/api/research/items/:id', ({ params }) => ({
    item: research.store.getItem(params.id),
    revisions: research.store.revisions(params.id),
  }));
  router.patch('/api/research/items/:id', ({ params, body }) =>
    research.store.updateItem(params.id, body, actor),
  );
}
