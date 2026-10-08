import { createPreview } from '../../services/preview/index.js';

/**
 * @param {import('../router.js').Router} router
 * @param {import('../../core/index.js').Core} core
 * @param {ReturnType<typeof import('../../services/research/index.js').createResearch>} research
 */
export function registerPreviewRoutes(router, core, research) {
  if (!research) return;
  const preview = createPreview(core, research);
  const target = (query) => ({
    kind: query.get('kind') ?? 'source',
    id: query.get('id'),
    projectId: query.get('projectId'),
    path: query.get('path'),
  });
  router.get('/api/preview/document', ({ query }) => preview.document(target(query)));
  router.get('/api/preview/content', async ({ query, response }) => {
    const file = await preview.content(target(query));
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': file.bytes.length,
    });
    response.end(file.bytes);
  });
  router.get('/api/messages/:id/citations', ({ params }) => preview.citations(params.id));
}
