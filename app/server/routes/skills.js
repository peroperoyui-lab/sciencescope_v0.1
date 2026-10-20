import { openFolder } from '../../services/system.js';

/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/skills/index.js').createSkills>} [skills]
 */
export function registerSkillRoutes(router, skills) {
  if (!skills) return;
  router.get('/api/skills', () => skills.list());
  router.get('/api/skills/:name', ({ params }) => skills.read(params.name));
  router.post('/api/skills/import', ({ body }) => skills.import(body));
  router.post('/api/skills/:name/copy', ({ params }) => skills.copyBuiltin(params.name));
  router.delete('/api/skills/:name', ({ params }) => skills.remove(params.name));
  router.post('/api/skills/:name/open', async ({ params }) => {
    await openFolder((await skills.read(params.name)).directory);
    return { opened: true };
  });
  // Enable/disable uses the existing PATCH /api/settings, skills.disabled array.
}
