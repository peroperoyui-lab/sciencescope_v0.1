// The project folder view (项目文件夹): the external folder the user bound to
// the project, or else the project's own folder under the data root. These
// are the user's files; ScienceScope lists, creates, renames, recycles and adds
// them when the user asks.
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../core/errors.js';
import { recyclePath } from './system.js';
import { ownFolders } from './knowledge/project-index-listing.js';

/**
 * @param {import('../core/index.js').Core} core
 * @param {{recycle?: typeof recyclePath, requestIndex?:(projectId:string)=>void,
 * indexEntry?:(projectId:string,relative:string)=>any}} [options]
 */
export function createProjectFiles(core, { recycle = recyclePath, requestIndex, indexEntry } = {}) {
  /** The folder shown for a project. @param {string} projectId */
  function rootOf(projectId) {
    const project = core.projects.get(projectId);
    return project.folder ?? path.join(core.paths.projects, project.dirName);
  }

  /** An absolute path inside the project folder. */
  function inside(projectId, relative = '') {
    const root = rootOf(projectId);
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new AppError('PATH_OUTSIDE_PROJECT', '只能操作项目文件夹里的内容。');
    }
    return { root, target };
  }

  const toRelative = (root, file) => path.relative(root, file).split(path.sep).join('/');

  return {
    rootOf,
    /** Absolute path of an entry. @param {string} projectId @param {string} [relative] */
    locate: (projectId, relative) => inside(projectId, relative).target,

    /** Entries of a folder, folders first. @param {string} projectId @param {string} [folder] */
    async list(projectId, folder = '') {
      const { root, target } = inside(projectId, folder);
      if (!folder) requestIndex?.(projectId);
      let entries = [];
      try {
        entries = await readdir(target, { withFileTypes: true });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      // The built-in folder also holds ScienceScope's own workspace; it is not shown.
      const own = !folder && core.projects.get(projectId).folder == null;
      return {
        root,
        entries: entries
          .filter((entry) => !(own && entry.isDirectory() && ownFolders.has(entry.name)))
          .map((entry) => ({
            name: entry.name,
            path: toRelative(root, path.join(target, entry.name)),
            kind: entry.isDirectory() ? 'folder' : 'file',
            ...(entry.isFile() && indexEntry
              ? { index: indexEntry(projectId, toRelative(root, path.join(target, entry.name))) }
              : {}),
          }))
          .sort((a, b) =>
            a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1,
          ),
      };
    },

    /** @param {string} projectId @param {string} folder New folder's relative path. */
    async makeFolder(projectId, folder) {
      await mkdir(inside(projectId, folder).target, { recursive: true });
      requestIndex?.(projectId);
    },

    /** @param {string} projectId @param {string} from @param {string} to Relative paths. */
    async rename(projectId, from, to) {
      try {
        await rename(inside(projectId, from).target, inside(projectId, to).target);
        requestIndex?.(projectId);
      } catch (error) {
        if (error.code === 'ENOENT') throw new AppError('FILE_NOT_FOUND', '找不到这个文件。', 404);
        throw error;
      }
    },

    /**
     * Recycle the selected file or folder without deleting the project root.
     * @param {string} projectId
     * @param {string} relative
     * @returns {Promise<void>}
     */
    async recycle(projectId, relative) {
      const { root, target } = inside(projectId, relative);
      if (target === root) throw new AppError('ENTRY_REQUIRED', '请选择要删除的文件或文件夹。');
      await recycle(target);
      requestIndex?.(projectId);
    },

    /**
     * Add a file the user chose (sent as base64).
     * @param {string} projectId @param {string} file Relative path @param {string} base64
     */
    async add(projectId, file, base64) {
      const { target } = inside(projectId, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(base64, 'base64'), { flag: 'wx' }).catch((error) => {
        if (error.code === 'EEXIST') {
          throw new AppError('FILE_EXISTS', '已有同名文件，请先改名。', 409);
        }
        throw error;
      });
      requestIndex?.(projectId);
    },
  };
}
