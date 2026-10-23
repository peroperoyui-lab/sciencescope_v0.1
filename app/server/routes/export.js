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
}
