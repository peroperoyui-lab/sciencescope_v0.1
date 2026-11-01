/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/home-starters/index.js').createHomeStarters>} [starters]
 */
export function registerHomeRoutes(router, starters) {
  router.get('/api/home/starters', () => starters?.slot() ?? { slot: null });
}
