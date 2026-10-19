import { AppError } from '../../core/errors.js';
import { openFolder, openPath, systemInfo } from '../../services/system.js';

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
  // `file` is a name from `systemInfo().files`, opened with its default program.
  router.post('/api/system/open-file', async ({ body }) => {
    const file = systemInfo(core.paths).files[String(body.file ?? '')];
    if (!file) throw new AppError('UNKNOWN_FILE', '没有这个文件。');
    await openPath(file);
    return { opened: true };
  });
}
