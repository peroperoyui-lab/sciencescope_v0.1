import { AppError } from '../../core/errors.js';
import { createKnowledgeStore } from '../../services/knowledge/store.js';
import { createKnowledgeSessions } from '../../services/knowledge/sessions.js';
import { createKnowledgeGraph } from '../../services/knowledge/graph.js';
import { createResearch } from '../../services/research/index.js';

const user = { actorId: 'person_user', origin: 'user' };
function options(query) {
  /** @type {any} */
  const result = Object.fromEntries(query);
  for (const key of ['offset', 'limit', 'depth', 'edgesOffset', 'edgesLimit'])
    if (query.has(key)) result[key] = Number(query.get(key));
  for (const key of ['relations', 'layers'])
    if (query.has(key)) result[key] = query.getAll(key).flatMap((value) => value.split(','));
  return result;
}

/**
 * The server's existing launch token protects these routes. All data access and
 * editing boundaries stay in the knowledge services shared with the tools.
 * @param {import('../router.js').Router} router
 * @param {import('../../core/index.js').Core} core
 * @param {{knowledge?:any,sessions?:any,jobs?:any,research?:any}} [services]
 */
export function registerKnowledgeRoutes(router, core, services = {}) {
  const knowledge = services.knowledge ?? createKnowledgeStore(core);
  const sessions = services.sessions ?? createKnowledgeSessions(core, knowledge);
  const graph = createKnowledgeGraph(core, services.research ?? createResearch(core));
  const { versions } = knowledge;
  const edit = (body, work) => sessions.edit(body.sessionId, work);
  if (knowledge.layout) {
    router.get('/api/knowledge/layout', ({ query }) =>
      knowledge.layout.index(query.get('projectId')),
    );
    router.post('/api/knowledge/viewport', ({ body }) => {
      if (!Array.isArray(body.refs) || body.refs.some((ref) => typeof ref !== 'string'))
        throw new AppError('KNOWLEDGE_LAYOUT_REFS', 'Choose node references to load.');
      return knowledge.layout.viewport(body);
    });
    router.patch('/api/knowledge/positions', ({ body }) => {
      if (
        !Array.isArray(body.positions) ||
        body.positions.some(
          (position) =>
            !position ||
            typeof position.ref !== 'string' ||
            !Number.isFinite(position.x) ||
            !Number.isFinite(position.y) ||
            (position.pinned != null && typeof position.pinned !== 'boolean'),
        )
      )
        throw new AppError(
          'KNOWLEDGE_LAYOUT_POSITION',
          'Provide finite node coordinates and a pin state.',
        );
      return knowledge.layout.save(body.positions);
    });
    router.post('/api/knowledge/layout/rerun', ({ body }) =>
      knowledge.layout.rerun(body.projectId),
    );
  }
  router.get('/api/knowledge/entities', ({ query }) => knowledge.listEntityDetails(options(query)));
  router.get('/api/knowledge/entities/merge-preview', ({ query }) =>
    knowledge.mergePreview({
      into: query.get('into'),
      from: query.getAll('from').flatMap((value) => value.split(',')),
    }),
  );
  router.post('/api/knowledge/entities/merge', ({ body }) =>
    edit(body, (actor) => knowledge.mergeEntities(body, actor)),
  );
  router.post('/api/knowledge/entities', ({ body }) =>
    edit(body, (actor) => knowledge.createEntity(body, actor)),
  );
  router.get('/api/knowledge/entities/:id', ({ params, query }) =>
    knowledge.entityDetails(params.id, options(query)),
  );
  router.patch('/api/knowledge/entities/:id', ({ params, body }) =>
    edit(body, (actor) => knowledge.updateEntity(params.id, body, actor)),
  );
  router.delete('/api/knowledge/entities/:id', ({ params, body }) =>
    edit(body, (actor) => knowledge.removeEntity(params.id, actor)),
  );
  router.get('/api/knowledge/edges', ({ query }) =>
    knowledge.nodeEdges(query.get('ref'), options(query)),
  );
  router.get('/api/knowledge/edges/:id', ({ params }) => knowledge.edgeDetail(params.id));
  router.post('/api/knowledge/edges', ({ body }) =>
    edit(body, (actor) => knowledge.createEdge(body, actor)),
  );
  router.patch('/api/knowledge/edges/:id', ({ params, body }) =>
    edit(body, (actor) => knowledge.updateEdge(params.id, body, actor)),
  );
  router.delete('/api/knowledge/edges/:id', ({ params, body }) =>
    edit(body, (actor) => knowledge.removeEdge(params.id, actor)),
  );
  router.post('/api/knowledge/labels', ({ body }) =>
    edit(body, (actor) => {
      for (const label of [].concat(body.add ?? [])) knowledge.label(body.ref, label, true, actor);
      for (const label of [].concat(body.remove ?? []))
        knowledge.label(body.ref, label, false, actor);
      return knowledge.labels(body.ref);
    }),
  );
  router.post('/api/knowledge/memberships', ({ body }) =>
    edit(body, (actor) => knowledge.membership(body.projectId, body.ref, !body.remove, actor)),
  );
  router.get('/api/knowledge/graph', ({ query }) => graph(options(query)));
  router.post('/api/knowledge/session', ({ body }) => sessions.open(body));
  for (const action of ['close', 'undo', 'redo'])
    router.post(`/api/knowledge/session/:id/${action}`, ({ params }) =>
      sessions[action](params.id),
    );
  router.get('/api/knowledge/versions', ({ query }) => versions.list(options(query)));
  router.get('/api/knowledge/versions/:id', ({ params }) => ({
    version: versions.get(params.id),
    changes: versions.changes(params.id).map(knowledge.revisionDetails),
  }));
  router.post('/api/knowledge/versions/:id/restore', ({ params }) =>
    versions.restore(params.id, user),
  );
  router.get('/api/knowledge/history', ({ query }) => {
    const page = versions.history(query.get('ref'), options(query));
    return { ...page, rows: page.rows.map(knowledge.revisionDetails) };
  });
  router.post('/api/knowledge/revisions/:id/restore', ({ params }) =>
    versions.restoreRevision(params.id, user),
  );
  if (services.jobs) {
    router.get('/api/knowledge/cards/estimate', ({ query }) =>
      services.jobs.estimateCards(query.get('projectId')),
    );
    router.post('/api/knowledge/cards', ({ body }) => {
      if (!Array.isArray(body.sourceIds) || body.sourceIds.some((id) => typeof id !== 'string'))
        throw new AppError('KNOWLEDGE_CARD_SOURCES', 'Choose source IDs to build paper cards.');
      return services.jobs.requestCards(body.sourceIds);
    });
    router.get('/api/knowledge/jobs', () => services.jobs.summary());
    router.post('/api/knowledge/jobs', ({ body }) => {
      if (body.action !== 'retry')
        throw new AppError('KNOWLEDGE_JOB_ACTION', 'Choose retry to retry failed knowledge jobs.');
      return services.jobs.retryFailed();
    });
  }
}
