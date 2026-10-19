/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/tools.js').createTools>} [tools]
 */
export function registerToolRoutes(router, tools) {
  if (tools) router.get('/api/tools', () => tools.list());
}
