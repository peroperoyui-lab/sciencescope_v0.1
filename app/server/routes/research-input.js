/**
 * @param {import('../router.js').Router} router
 * @param {ReturnType<typeof import('../../services/research-input/index.js').createResearchInput>} input
 */
export function registerResearchInputRoutes(router, input) {
  if (!input) return;
  router.post('/api/research-input/:owner/attachments', ({ params, body }) =>
    input.attach(params.owner, body),
  );
  router.get('/api/research-input/images/:id', async ({ params, response }) => {
    const image = await input.image(params.id);
    response.writeHead(200, {
      'content-type': image.mimeType,
      'content-length': image.bytes.length,
    });
    response.end(image.bytes);
  });
  router.get('/api/research-input/:owner', ({ params }) => input.draft(params.owner));
  router.patch('/api/research-input/:owner', ({ params, body }) =>
    input.change(params.owner, body),
  );
}
