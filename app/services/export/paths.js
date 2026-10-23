import { mkdir, realpath, stat, rmdir, open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeFileName } from '../../core/paths.js';
import { AppError } from '../../core/errors.js';

/** @param {string} root @param {string} file */
export function isWithin(root, file) {
  const relative = path.relative(root, file);
  return (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

/** @param {unknown} value @param {string} dataRoot */
export async function validateTarget(value, dataRoot) {
  try {
    if (typeof value !== 'string' || !value.trim()) throw new Error('请选择已有的导出文件夹。');
    const [target, root] = await Promise.all([realpath(path.resolve(value)), realpath(dataRoot)]);
    if (!(await stat(target)).isDirectory()) throw new Error('导出位置必须是已有的文件夹。');
    if (isWithin(root, target)) throw new Error('导出位置不能在 ScienceScope 数据目录内。');
    const probe = path.join(target, `.sciencescope-export-${randomUUID()}`);
    await mkdir(probe);
    try {
      const handle = await open(path.join(probe, 'write-check'), 'wx');
      await handle.close();
      const { unlink } = await import('node:fs/promises');
      await unlink(path.join(probe, 'write-check'));
    } finally {
      await rmdir(probe);
    }
    return target;
  } catch (error) {
    throw new AppError('EXPORT_TARGET_INVALID', `无法使用这个导出位置：${error.message}`, 400);
  }
}

/** @param {string} value @param {number} [maxLength] */
export function fileName(value, maxLength = 80) {
  const clean = safeFileName(String(value), Number.MAX_SAFE_INTEGER);
  const extension = maxLength > 80 ? path.extname(clean) : '';
  const savedExtension = fitBytes(extension, maxLength);
  const stem = extension ? clean.slice(0, -extension.length) : clean;
  const name = fitBytes(stem, maxLength - Buffer.byteLength(savedExtension)) + savedExtension;
  return !name || name === '.' || name === '..' ? '未命名' : name;
}

/** File components must also fit Linux filesystems' UTF-8 byte boundary.
 * @param {string} value @param {number} budget
 */
function fitBytes(value, budget) {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character);
    if (bytes + size > budget) break;
    result += character;
    bytes += size;
  }
  return result;
}

/** @param {string} target @param {Date} date */
export async function reserveFolder(target, date) {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
  const base = `ScienceScope 导出 ${stamp}`;
  for (let number = 1; ; number++) {
    const name = `${base}${number === 1 ? '' : ` (${number})`}`;
    const folder = path.join(target, `${name}（未完成）`);
    const completed = path.join(target, name);
    if (
      await stat(completed).then(
        () => true,
        (error) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      )
    )
      continue;
    try {
      await mkdir(folder);
      return { folder, completed };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}
