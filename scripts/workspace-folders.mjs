// Working folders chosen by the user for a project or an independent chat.
// The folder becomes the DSH workspace (ask mode writes only there), so it must
// be a real directory the user owns — never the application's own data, a
// drive root or an operating-system directory.
import os from 'node:os';
import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';

export class WorkFolderError extends Error {
  constructor(message) { super(message); this.code = 'INVALID_WORK_FOLDER'; this.status = 400; }
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel)); };

function systemFolders() {
  if (process.platform === 'win32') {
    const env = process.env;
    return [env.SystemRoot || 'C:\\Windows', env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', env.ProgramData || 'C:\\ProgramData'].filter(Boolean);
  }
  return ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/sbin', '/sys', '/usr', '/var', '/System', '/Library', '/Applications'];
}

/**
 * @returns {Promise<{folder:string, warning?:string}>}
 */
export async function validateWorkFolder(input, { dataRoot }) {
  if (typeof input !== 'string' || !input.trim() || input.length > 1000) throw new WorkFolderError('请选择或填写一个文件夹。');
  const raw = input.trim();
  if (!path.isAbsolute(raw)) throw new WorkFolderError('请填写完整路径（例如 D:\\研究\\项目A）。');
  let folder;
  try { folder = await realpath(raw); } catch { throw new WorkFolderError('这个文件夹不存在。'); }
  if (!(await stat(folder)).isDirectory()) throw new WorkFolderError('这里需要一个文件夹，而不是文件。');
  if (same(path.parse(folder).root, folder) || same(path.parse(folder).root, folder + path.sep)) throw new WorkFolderError('不能直接使用整个磁盘作为工作文件夹，请选择其中的一个文件夹。');
  const appData = path.resolve(dataRoot, '.sciencescope-local');
  let appReal = appData; try { appReal = await realpath(appData); } catch {}
  if (inside(folder, appReal) || inside(appReal, folder)) throw new WorkFolderError('不能使用 ScienceScope 自己的数据目录，或包含它的文件夹。');
  for (const system of systemFolders()) {
    let real = system; try { real = await realpath(system); } catch {}
    if (inside(folder, real)) throw new WorkFolderError('不能使用系统目录作为工作文件夹。');
  }
  const home = os.homedir();
  return same(folder, home) ? { folder, warning: '这是你的整个用户目录：在"询问"模式下，模型可以写入其中的所有文件。建议选择一个专门的子文件夹。' } : { folder };
}
