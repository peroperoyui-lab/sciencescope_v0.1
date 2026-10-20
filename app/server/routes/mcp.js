/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/mcp/index.js').createMcp>} [mcp]
 */
export function registerMcpRoutes(router, mcp) {
  if (!mcp) return;
  router.get('/api/mcp/servers', () => mcp.list());
  router.post('/api/mcp/servers', ({ body }) => mcp.save(body, undefined));
  router.post('/api/mcp/import', ({ body }) => mcp.import(body.config ?? body));
  router.patch('/api/mcp/servers/:id', ({ params, body }) => mcp.save(body, params.id));
  router.delete('/api/mcp/servers/:id', ({ params }) => mcp.remove(params.id));
  router.post('/api/mcp/servers/:id/reconnect', ({ params }) => mcp.reconnect(params.id));
}
