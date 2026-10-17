import { discoverModels, keyRefs, saveKey } from '../../services/providers.js';

/**
 * @param {import('../router.js').Router} router
 * @param {import('../../core/index.js').Core} core
 * @param {ReturnType<typeof import('../../services/providers.js').createProviderService>} [providers]
 */
export function registerProviderRoutes(router, core, providers) {
  // Provider settings themselves are part of /api/settings (`providers`).
  // Keys go only to the credentials file and are never returned.
  router.get('/api/providers/keys', async () => ({ refs: await keyRefs(core.paths) }));
  router.post('/api/providers/keys/:keyRef', async ({ params, body }) => {
    await saveKey(core.paths, params.keyRef, String(body.key ?? ''));
    return { saved: true };
  });
  router.post('/api/providers/discover', async ({ body }) => ({
    models: await discoverModels(core.paths, body),
  }));
  if (providers) {
    router.get('/api/providers/presets', () => providers.presets());
    router.post('/api/providers/presets/:presetId', ({ params, body }) =>
      providers.savePreset(params.presetId, String(body.key ?? '')),
    );
    router.post('/api/providers/:providerId/adopt-preset', ({ params, body }) =>
      providers.adoptPreset(params.providerId, String(body.preset ?? '')),
    );
    router.post('/api/providers/:providerId/test', ({ params, body }) =>
      providers.test(params.providerId, body.model),
    );
    router.get('/api/models', () => providers.models());
  }
}
