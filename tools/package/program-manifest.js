import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PROGRAM_DIRECTORIES = [
  'app',
  'node_modules',
  'runtime',
  'python',
  'models',
  'reference',
];
export const PROGRAM_FILES = ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES'];

async function listFiles(root, relative) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true }).catch(
    (error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  const files = [];
  for (const entry of entries) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(root, name)));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

/**
 * Only installer-owned program files enter the manifest. The main executable
 * is produced later by Cargo; data and the NSIS-owned uninstaller are excluded.
 * @param {string} stage
 * @param {{mainBinary?:string}} [options]
 * @returns {Promise<string>}
 */
export async function writeProgramManifest(
  stage,
  { mainBinary = 'sciencescope-desktop.exe' } = {},
) {
  const files = [...PROGRAM_FILES, mainBinary, 'program-files.txt'];
  for (const directory of PROGRAM_DIRECTORIES) files.push(...(await listFiles(stage, directory)));
  const destination = path.join(stage, 'program-files.txt');
  await writeFile(destination, [...new Set(files)].sort().join('\r\n') + '\r\n', 'utf8');
  return destination;
}
