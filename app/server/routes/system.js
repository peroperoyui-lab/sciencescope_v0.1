import { AppError } from '../../core/errors.js';
import { openFolder, systemInfo } from '../../services/system.js';

/** @param {import('../router.js').Router} router @param {import('../../core/index.js').Core} core */
export function registerSystemRoutes(router, core) {
  router.get('/api/system', () => systemInfo(core.paths));
  // `folder` is a name from `systemInfo().folders`.
  router.post('/api/system/open', async ({ body }) => {
    const folder = systemInfo(core.paths).folders[String(body.folder ?? '')];
    if (!folder) throw new AppError('UNKNOWN_FOLDER', '没有这个文件夹。');
    await openFolder(folder);
    return { opened: true };
  });
}
