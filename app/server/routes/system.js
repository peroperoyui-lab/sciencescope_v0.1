import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { openFolder, systemInfo } from '../../services/system.js';

/** @param {import('../router.js').Router} router @param {import('../../core/index.js').Core} core */
export function registerSystemRoutes(router, core) {
  router.get('/api/system', () => systemInfo(core.paths));
  // `folder` is a name from `systemInfo().folders`, or `project:<id>` for a project folder.
  router.post('/api/system/open', async ({ body }) => {
    const name = String(body.folder ?? '');
    let folder = systemInfo(core.paths).folders[name];
    if (name.startsWith('project:')) {
      const project = core.projects.get(name.slice('project:'.length));
      folder = path.join(core.paths.projects, project.dirName, String(body.path ?? ''));
    }
    if (!folder) throw new AppError('UNKNOWN_FOLDER', '没有这个文件夹。');
    await openFolder(folder);
    return { opened: true };
  });
}
