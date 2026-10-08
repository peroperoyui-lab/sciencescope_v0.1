/**
 * @param {ReturnType<typeof import('../router.js').createRouter>} router
 * @param {ReturnType<typeof import('../../services/python/index.js').createPython>} python
 */
export function registerPythonRoutes(router, python) {
  if (!python) return;
  router.get('/api/python', () => python.list());
  router.get('/api/python/system', () => python.detectSystem());
  router.post('/api/python', ({ body }) => python.operate(body));
  router.post('/api/python/cache/prune', () => python.prune());
  router.get('/api/python/operations', () => python.operations());
  router.get('/api/python/binding/:scope/:id', async ({ params }) => ({
    id: params.scope === 'meeting' ? await python.selected(params.id, null) : null,
  }));
  router.post('/api/python/binding/:scope/:id', ({ params, body }) =>
    python.bind(params.scope, params.id, body.environment),
  );
  router.post('/api/python/:id/packages', ({ params, body }) =>
    python.packages(params.id, body.action, body.packages),
  );
  router.get('/api/python/:id/manifest', ({ params }) => ({
    text: python.exportManifest(params.id),
  }));
  router.post('/api/python/:id/manifest', ({ params, body }) =>
    python.importManifest(params.id, body.text),
  );
}
