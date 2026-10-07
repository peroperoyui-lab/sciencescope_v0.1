// Thin memory endpoints; candidate production, decisions and history live in
// the secretary's service and all confirmed brief consumers share one projection.
import { projectBrief } from '../../services/secretary/project-brief.js';
/**
 * @param {import('../router.js').Router} router
 * @param {import('../../core/index.js').Core} core
 * @param {any} memory
 * @param {any} research
 */
export function registerMemoryRoutes(router, core, memory, research) {
  if (!memory) return;
  router.get('/api/memory/inbox', ({ query }) => memory.inbox(query.get('projectId') || null));
  router.get('/api/memory/brief', ({ query }) =>
    projectBrief(core, query.get('projectId') || null, research.store),
  );
  router.patch('/api/memory/items/:id', ({ params, body }) => memory.update(params.id, body));
  router.post('/api/memory/decisions', ({ body }) => {
    return core.db.transaction(() =>
      body.ids.map((id) => memory.update(id, { status: body.status })),
    );
  });
  router.get('/api/memory/history', ({ query }) =>
    memory.historyProject(query.get('projectId') || null, {
      limit: query.has('limit') ? Number(query.get('limit')) : undefined,
    }),
  );
  router.get('/api/memory/items/:id/history', ({ params }) => memory.history(params.id));
  router.post('/api/memory/revisions/:id/undo', ({ params }) => memory.undo(params.id));
  router.get('/api/meetings/:id/memory/status', ({ params }) => memory.status(params.id));
  router.post('/api/meetings/:id/memory', ({ params }) => memory.consolidate(params.id));
}
