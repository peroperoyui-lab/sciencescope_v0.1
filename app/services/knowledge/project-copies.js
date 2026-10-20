// Copies are immutable source artifacts, named by byte content, not by parser IDs.
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
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

/**
 * Only completed immutable copies are inventory entries; temporary writes belong
 * to the scanner. The caller serializes cleanup with that project's scans.
 * @param {import('../../core/index.js').Core} core
 * @param {import('../research/store.js').ResearchStore} store
 */
export function createProjectCopies(core, store) {
  async function inventory(projectId) {
    core.projects.get(projectId);
    const directory = path.join(core.paths.library, 'project-files', projectId);
    const referenced = new Set(
      store
        .listSources({ projectId, includePersonal: false })
        .map((source) => source.originalPath?.replaceAll('\\', '/')),
    );
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}$/u.test(entry.name)) continue;
      const file = path.join(directory, entry.name);
      files.push({
        file,
        bytes: (await stat(file)).size,
        referenced: referenced.has(`project-files/${projectId}/${entry.name}`),
      });
    }
    return files;
  }
  async function usage(projectId) {
    const files = await inventory(projectId);
    const unreferenced = files.filter((file) => !file.referenced);
    return {
      projectId,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      unreferencedBytes: unreferenced.reduce((sum, file) => sum + file.bytes, 0),
      totalFiles: files.length,
      unreferencedFiles: unreferenced.length,
    };
  }
  async function cleanup(projectId) {
    let releasedBytes = 0,
      removedFiles = 0;
    for (const entry of await inventory(projectId)) {
      if (entry.referenced) continue;
      await unlink(entry.file);
      releasedBytes += entry.bytes;
      removedFiles++;
    }
    return { projectId, releasedBytes, removedFiles };
  }
  return {
    usage,
    cleanup,
    async all() {
      const projects = [];
      for (const project of core.projects.list({ includeArchived: true }))
        projects.push(await usage(project.id));
      return { projects };
    },
  };
}
