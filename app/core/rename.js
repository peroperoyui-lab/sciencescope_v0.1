import { rename } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { AppError } from './errors.js';

/**
 * Windows readers may temporarily deny delete sharing, which rename requires.
 * Never fall back to deleting the destination: it must survive a failed write.
 * @param {string} source
 * @param {string} destination
 */
export async function renameWithRetry(source, destination) {
  const delays = [50, 100, 200, 400];
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      if (attempt === delays.length) {
        throw new AppError(
          'PATH_BUSY',
          '文件或文件夹被占用，或没有改名权限。请关闭相关编辑器或窗口，检查权限后重试；原文件和记录未更改。',
          409,
        );
      }
      await setTimeout(delays[attempt]);
    }
  }
}
