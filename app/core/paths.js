import path from 'node:path';

/**
 * Every location under the data root. Nothing else in core builds data paths.
 * @param {string} root Absolute data root (install `data/` or a test folder).
 */
export function dataPaths(root) {
  const base = path.resolve(root);
  return {
    root: base,
    database: path.join(base, 'sciencescope.sqlite'),
    settings: path.join(base, 'settings.json'),
    agents: path.join(base, 'agents'),
    skills: path.join(base, 'skills'),
    projects: path.join(base, 'projects'),
    globalMinutes: path.join(base, 'minutes'),
    globalPlans: path.join(base, 'plans.md'),
    library: path.join(base, 'library'),
    deliverables: path.join(base, 'deliverables'),
    runtime: path.join(base, 'runtime'),
    models: path.join(base, 'models'),
    python: path.join(base, 'python'),
    secret: path.join(base, 'secret'),
    backups: path.join(base, 'backups'),
  };
}

// Characters Windows does not allow in file names, plus control characters.
// eslint-disable-next-line no-control-regex -- control characters are exactly what we strip
const UNSAFE_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * A readable file or folder name: unsafe characters become spaces.
 * @param {string} name
 * @param {number} [maxLength]
 */
export function safeFileName(name, maxLength = 80) {
  return name.replace(UNSAFE_NAME, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * Folder name for a project: readable name plus id, e.g. `气候政策-prj_3f9a…`.
 * @param {string} name
 * @param {string} id
 */
export function projectDirName(name, id) {
  const readable = safeFileName(name, 40);
  return readable ? `${readable}-${id}` : id;
}
