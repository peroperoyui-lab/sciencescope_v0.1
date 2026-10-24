import { AppError } from '../../core/errors.js';

/**
 * Whether a download source answers: any reply below 400 within ten seconds.
 * Settings uses it before saving a source the person added.
 * @param {unknown} url
 */
export async function probeSource(url, request = fetch) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    throw new AppError('INVALID_URL', '地址格式不对，要以 https:// 或 http:// 开头。');
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new AppError('INVALID_URL', '地址格式不对，要以 https:// 或 http:// 开头。');
  try {
    const response = await request(parsed, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });
    await response.body?.cancel();
    return response.status < 400
      ? { ok: true, status: response.status }
      : { ok: false, status: response.status, reason: `HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      reason:
        error?.name === 'TimeoutError'
          ? 'timeout'
          : String(error?.cause?.code ?? error?.message ?? error),
    };
  }
}

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
  router.post('/api/python/probe', ({ body }) => probeSource(body.url));
  router.get('/api/python/operations', () => python.operations());
  router.get('/api/python/binding/:scope/:id', async ({ params }) => ({
    id: params.scope === 'meeting' ? await python.selected(params.id, null) : null,
    explicit: python.binding(params.scope, params.id),
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
