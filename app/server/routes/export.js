import { AppError } from '../../core/errors.js';
import { openFolder } from '../../services/system.js';

/**
 * Full exports share one service with one active job for this application.
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/export.js').createFullExport>} exporter
 */
export function registerExportRoutes(router, exporter) {
  router.post('/api/export/all', ({ body }) =>
    exporter.start({
      target: body.target,
      includeProjectCopies: body.includeProjectCopies === true,
    }),
  );
  router.get('/api/export/all/:jobId', ({ params }) => exporter.get(params.jobId));
  router.delete('/api/export/all/:jobId', ({ params }) => exporter.cancel(params.jobId));
  // Only the folder a job created can be opened, and only once it is complete.
  router.post('/api/export/all/:jobId/open', async ({ params }) => {
    const status = await exporter.get(params.jobId);
    if (status.phase !== 'finished')
      throw new AppError('EXPORT_NOT_FINISHED', '导出还没有完成。', 409);
    await openFolder(status.folder);
    return { opened: true };
  });
}
