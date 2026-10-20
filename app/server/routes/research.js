import { LOCAL_USER_ID } from '../../core/defaults.js';
import { createResearch } from '../../services/research/index.js';

/** @param {import('../router.js').Router} router @param {import('../../core/index.js').Core} core @param {ReturnType<typeof createResearch>} [service] @param {any} [semantic] */
export function registerResearchRoutes(router, core, service, semantic) {
  const research = service ?? createResearch(core);
  const actor = { actorId: LOCAL_USER_ID };
  const options = (query) => ({
    ...(query.has('projectId') ? { projectId: query.get('projectId') || null } : {}),
    includePersonal: query.get('includePersonal') !== '0',
    includeSuperseded: query.get('includeSuperseded') === '1',
    ...(query.has('limit') ? { limit: Number(query.get('limit')) } : {}),
    ...(query.has('offset') ? { offset: Number(query.get('offset')) } : {}),
    ...Object.fromEntries(
      ['kind', 'readStatus', 'tag', 'sort', 'direction', 'type', 'subtype', 'status', 'visibility']
        .filter((key) => query.has(key))
        .map((key) => [key, query.get(key)]),
    ),
    ...(query.has('pinned') ? { pinned: query.get('pinned') === '1' } : {}),
    audience: /** @type {'user'} */ ('user'),
  });
  router.get('/api/research/sources', ({ query }) => {
    const selected = options(query);
    if (!query.has('page')) return research.store.listSources(selected);
    const page = Math.max(1, Number(query.get('page')) || 1);
    const pageSize = Math.max(1, Number(query.get('pageSize')) || 50);
    const total = research.store.countSources(selected);
    const sources = research.store.listSources({
      ...selected,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { sources, total, page, pageSize, remaining: Math.max(0, total - page * pageSize) };
  });
  router.patch('/api/research/sources/:id', ({ params, body }) =>
    research.store.updateSource(params.id, body, actor),
  );
  router.delete('/api/research/sources/:id', ({ params }) =>
    research.deleteSource(params.id, actor),
  );
  router.post('/api/research/sources/:id/reparse', ({ params }) =>
    research.reparseSource(params.id, actor),
  );
  router.post('/api/research/sources/:id/open', ({ params }) => research.openSource(params.id));
  router.get('/api/research/chunks/:id', ({ params }) =>
    research.read({ type: 'chunk', id: params.id }),
  );
  if (semantic) {
    router.get('/api/research/semantic/status', () => semantic.status());
    router.post('/api/research/semantic/download', () => semantic.download());
    router.post('/api/research/semantic/rebuild', () => semantic.rebuild());
  }
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
