// Facts about this installation for the settings pages, and opening a folder
// in the system file manager.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import trash from 'trash';

// The install (or checkout) root holds package.json, and in installed builds
// the third-party notices written by tools/package/notices.js.
const installRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const version = String(
  JSON.parse(readFileSync(path.join(installRoot, 'package.json'), 'utf8')).version,
);
const notices = path.join(installRoot, 'THIRD_PARTY_NOTICES');

/** @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths */
export function systemInfo(paths) {
  return {
    version,
    // Only installed builds carry the notices file; the About page hides its button otherwise.
    files: existsSync(notices) ? { notices } : {},
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
 * @param {typeof spawn} [launch] Native process launcher (injectable in tests).
 */
export async function openPath(target, launch = spawn) {
  // Native launchers need not include the Windows directory in PATH.
  const command =
    process.platform === 'win32'
      ? path.join(process.env.SystemRoot ?? 'C:/Windows', 'explorer.exe')
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  const child = launch(command, [target], { detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => resolve(undefined));
  });
  child.unref();
}

/** @param {string} folder Created first if missing. */
export async function openFolder(folder) {
  await mkdir(folder, { recursive: true });
  await openPath(folder);
}

/**
 * Move user-selected entries to the operating system's recycle bin.
 * No permanent-delete fallback: failures leave the original entry in place.
 * @param {string} target
 * @param {typeof trash} [recycle]
 * @returns {Promise<void>}
 */
export async function recyclePath(target, recycle = trash) {
  await recycle([target], { glob: false });
}
