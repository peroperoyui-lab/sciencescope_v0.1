// Minutes routes only adapt HTTP to the background participant service.
import { AppError } from '../../core/errors.js';

/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/secretary/minutes.js').createMinutesService>} [minutes]
 */
export function registerMinutesRoutes(router, minutes) {
  const service = () => {
    if (!minutes) throw new AppError('MINUTES_UNAVAILABLE', '纪要服务未启动。', 503);
    return minutes;
  };
  router.get('/api/meetings/:id/minutes', ({ params }) => service().status(params.id));
  router.post('/api/meetings/:id/minutes', ({ params, body }) =>
    service().edit(params.id, body.text, body.expectedRevision),
  );
  router.post('/api/meetings/:id/minutes/refresh', async ({ params }) => {
    await service().refresh(params.id);
    return service().status(params.id);
  });
  router.post('/api/projects/:id/focus', async ({ params, body }) => {
    await service().focus(body.focused === false ? null : params.id);
    return { focused: body.focused !== false };
  });
}
