/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/assistant/index.js').createAssistant>} [assistant]
 */
export function registerAssistantRoutes(router, assistant) {
  if (!assistant) return;
  router.get('/api/assistant', () => assistant.ensure());
  router.post('/api/assistant', () => assistant.ensure());
}
