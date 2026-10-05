// Facts about this installation for the settings pages, and opening a folder
// in the system file manager.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/** @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths */
export function systemInfo(paths) {
  return {
    folders: {
      root: paths.root,
      database: path.dirname(paths.database),
      projects: paths.projects,
      library: paths.library,
      runtime: paths.runtime,
      skills: paths.skills,
    },
    runtime: { node: process.versions.node, platform: process.platform, arch: process.arch },
  };
}

/**
 * Open a file with its default program, or a folder in Explorer / Finder /
 * the desktop file manager.
 * @param {string} target
 */
export function openPath(target) {
  const command =
    process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [target], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

/** @param {string} folder Created first if missing. */
export async function openFolder(folder) {
  await mkdir(folder, { recursive: true });
  openPath(folder);
}
