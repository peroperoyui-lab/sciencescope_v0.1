// Markdown resources. They share the text operations and differ only in where
// the file lives. Keys: see docs/design/CORE_MODEL.md §4.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../errors.js';
import { safeFileName } from '../../paths.js';
import { applyTextOp, TEXT_OPS } from '../text-ops.js';

/** @typedef {import('../workspace.js').Locate} Locate */

/** @param {string} name */
function noteFileName(name) {
  const clean = safeFileName(name.replace(/\.md$/i, ''));
  if (!clean || clean === '.' || clean === '..') {
    throw new AppError('INVALID_NAME', '笔记名称无效。');
  }
  return `${clean}.md`;
}

function textResource(name, file, extra = {}) {
  return { name, ops: TEXT_OPS, file, apply: applyTextOp, ...extra };
}

/** Plans: key `global` or a project id. */
export const plans = textResource('plans', (locate, key) =>
  key === 'global'
    ? locate.paths.globalPlans
    : path.join(locate.projectDir(key), 'workbench', 'plans.md'),
);

/** Research log: key = project id. */
export const log = textResource('log', (locate, key) =>
  path.join(locate.projectDir(key), 'workbench', 'log.md'),
);

/** Minutes: key = meeting id. */
export const minutes = textResource('minutes', (locate, key) =>
  path.join(locate.meetingBase(key), 'minutes', `${key}.md`),
);

/** Notes: key = `<projectId>/<name>`. */
export const notes = textResource(
  'notes',
  (locate, key) => {
    const slash = key.indexOf('/');
    if (slash < 0) throw new AppError('INVALID_KEY', '笔记标识应为“项目/名称”。');
    const projectId = key.slice(0, slash);
    return path.join(locate.projectDir(projectId), 'notes', noteFileName(key.slice(slash + 1)));
  },
  {
    /** @param {Locate} locate @param {string} projectId */
    async list(locate, projectId) {
      const folder = path.join(locate.projectDir(projectId), 'notes');
      const names = await readdir(folder).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      return names
        .filter((file) => file.endsWith('.md'))
        .map((file) => `${projectId}/${file.slice(0, -3)}`);
    },
  },
);

/** AI participant definition: key = participant id. */
export const agent = textResource('agent', (locate, key) =>
  path.join(locate.paths.agents, `${key}.md`),
);
