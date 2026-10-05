import { saveKey } from '../../services/providers.js';

/** @param {import('../router.js').Router} router @param {import('../../core/index.js').Core} core */
export function registerProviderRoutes(router, core) {
  // Provider settings themselves are part of /api/settings (`providers`).
  // Keys go only to the credentials file and are never returned.
  router.post('/api/providers/keys/:keyRef', async ({ params, body }) => {
    await saveKey(core.paths, params.keyRef, String(body.key ?? ''));
    return { saved: true };
  });
}
