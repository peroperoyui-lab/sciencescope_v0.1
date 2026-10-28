import { LOCAL_USER_ID } from '../../core/defaults.js';
import { attachment } from '../attachment.js';
import { AppError } from '../../core/errors.js';
import { exportProject } from '../../services/export.js';
import { createProjectFiles } from '../../services/project-files.js';
import { openPath } from '../../services/system.js';
import { createJournalFiles } from '../../services/journal-files.js';

const user = { actorId: LOCAL_USER_ID };

/**
 * @param {import('../router.js').Router} router
 * @param {import('../../core/index.js').Core} core
 * @param {ReturnType<typeof import('../../services/python/index.js').createPython>} [python]
 * @param {ReturnType<typeof createProjectFiles>} [files]
 * @param {ReturnType<typeof import('../../services/knowledge/project-index.js').createProjectIndex>} [index]
 */
export function registerProjectRoutes(
  router,
  core,
  python,
  files = createProjectFiles(core),
  index,
) {
  const journalFiles = createJournalFiles(core);
  router.post('/api/projects/:id/log-file/open', ({ params, body }) =>
    journalFiles.open(params.id, body.reference),
  );
  router.get('/api/projects', ({ query }) =>
    core.projects.list({ includeArchived: query.get('archived') === '1' }),
  );
  router.post('/api/projects', async ({ body }) => {
    const project = await core.projects.create(body, user);
    if (body.environment) python?.bind('project', project.id, body.environment);
    return project;
  });
  router.get('/api/projects/:id', ({ params }) => core.projects.get(params.id));
  if (index) {
    router.post('/api/projects/:id/index', ({ params }) => index.scan(params.id));
    router.get('/api/projects/:id/index', ({ params }) => ({
      ...index.status(params.id),
      counts: index.fileCounts(params.id),
    }));
    router.get('/api/projects/storage/copies', () => index.copyUsage());
    router.post('/api/projects/:id/copies/cleanup', ({ params }) => index.cleanupCopies(params.id));
  }
  router.get('/api/projects/:id/files', ({ params, query }) =>
    files.list(params.id, query.get('path') ?? ''),
  );
  // { op: 'mkdir', path } | { op: 'rename', path, to } | { op: 'add', path, base64 } | { op: 'open', path }
  router.post('/api/projects/:id/files', async ({ params, body }) => {
    const relative = String(body.path ?? '');
    if (body.op === 'mkdir') await files.makeFolder(params.id, relative);
    else if (body.op === 'rename') await files.rename(params.id, relative, String(body.to ?? ''));
    else if (body.op === 'add') await files.add(params.id, relative, String(body.base64 ?? ''));
    else if (body.op === 'recycle') await files.recycle(params.id, relative);
    else if (body.op === 'open') await openPath(files.locate(params.id, relative));
    else throw new AppError('UNKNOWN_OP', `不支持的操作：${body.op}`);
    return { done: true };
  });
  router.get('/api/projects/:id/export', async ({ params, response }) => {
    const { name, zip } = await exportProject(core, params.id);
    response.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': attachment(name),
    });
    response.end(zip);
    return undefined;
  });
  router.patch('/api/projects/:id', ({ params, body }) =>
    core.projects.update(params.id, body, user),
  );
}
