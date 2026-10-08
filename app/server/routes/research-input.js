/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/research-input/index.js').createResearchInput>} input
 */
export function registerResearchInputRoutes(router, input) {
  if (!input) return;
  router.get('/api/research-input/:owner', ({ params }) => input.draft(params.owner));
  router.patch('/api/research-input/:owner', ({ params, body }) =>
    input.change(params.owner, body),
  );
}
