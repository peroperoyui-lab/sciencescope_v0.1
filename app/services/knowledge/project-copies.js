// Copies are immutable source artifacts, named by byte content, not by parser IDs.
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} file
 * @returns {Promise<string>}
 */
export async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

/**
 * The temporary copy stays in the data directory, never in the project folder.
 * @param {string} library
 * @param {string} projectId
 * @param {string} file
 * @param {string} hash
 * @returns {Promise<string>}
 */
export async function copyProjectFile(library, projectId, file, hash) {
  const relative = `project-files/${projectId}/${hash}`;
  const destination = path.join(library, relative);
  try {
    await stat(destination);
    return relative;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await copyFile(file, temporary);
    if ((await fileHash(temporary)) !== hash)
      throw new Error('File changed during indexing; scan again.');
    await rename(temporary, destination);
    return relative;
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
