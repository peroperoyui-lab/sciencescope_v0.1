import { createProjectFiles } from './project-files.js';
import { openPath } from './system.js';
import { AppError } from '../core/errors.js';

/**
 * @param {import('../core/index.js').Core} core
 * @param {{open?:typeof openPath}} [options]
 */
export function createJournalFiles(core, { open = openPath } = {}) {
  const files = createProjectFiles(core);
  return {
    /**
     * @param {string} projectId
     * @param {import('../core/references.js').ContentReference} reference
     * @returns {Promise<{opened:boolean}>}
     */
    async open(projectId, reference) {
      let file;
      if (reference.kind === 'version') file = core.versionCatalog.file(reference.id);
      else if (reference.kind === 'project-file' || reference.kind === 'script')
        file = files.locate(reference.projectId ?? projectId, reference.path);
      else throw new AppError('UNKNOWN_REFERENCE', '请选择稿件版本或项目文件。');
      await open(file);
      return { opened: true };
    },
  };
}
