import { createDeliverables } from '../../services/deliverables.js';

export function registerDeliverableRoutes(router, core, options) {
  const files = createDeliverables(core, options);
  router.get('/api/deliverables/:id/content', async ({ params, response }) => {
    const file = await files.content(params.id);
    response.writeHead(200, { 'content-type': file.type, 'content-length': file.bytes.length });
    response.end(file.bytes);
  });
  router.post('/api/deliverables/:id/open', ({ params }) => files.open(params.id));
}
