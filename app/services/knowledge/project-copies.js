// Copies are immutable source artifacts, named by byte content, not by parser IDs.
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { AppError } from '../../core/errors.js';

const publications = new Map();
const directories = new Map();

function ensureCopyDirectory(directory) {
  if (directories.has(directory)) return directories.get(directory);
  const operation = mkdir(directory, { recursive: true })
    .catch(async (error) => {
      // Windows can report EPERM when another worker just created the directory.
      const existing = await stat(directory).catch(() => null);
      if (['EEXIST', 'EPERM'].includes(error.code) && existing?.isDirectory()) return;
      throw error;
    })
    .finally(() => directories.delete(directory));
  directories.set(directory, operation);
  return operation;
}

async function publishSnapshot(temporary, destination, fileSize) {
  const previous = publications.get(destination) ?? Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(async () => {
      const existing = await stat(destination).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (existing) {
        if (!existing.isFile() || existing.size !== fileSize)
          throw new AppError(
            'INDEX_COPY_MISMATCH',
            'Saved project copy has a different size.',
            409,
          );
        return true;
      }
      try {
        await rename(temporary, destination);
        return false;
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
        const saved = await stat(destination).catch(() => null);
        if (saved?.isFile() && saved.size === fileSize) return true;
        throw error;
      }
    });
  publications.set(destination, operation);
  try {
    return await operation;
  } finally {
    if (publications.get(destination) === operation) publications.delete(destination);
  }
}

/**
 * Hash and copy the same bytes in one source read. Publish the immutable copy
 * without replacing an existing hash file when two workers finish together.
 * The temporary copy stays in the data directory, never in the project folder.
 * @param {string} library
 * @param {string} projectId
 * @param {string} file
 * @param {{fileSize:number,fileMtimeMs:number}} [expected]
 * @returns {Promise<{contentHash:string,originalPath:string,fileSize:number,fileMtimeMs:number,reused:boolean}>}
 */
export async function snapshotProjectFile(library, projectId, file, expected) {
  const before = await stat(file);
  const changed = () =>
    new AppError('INDEX_FILE_CHANGED', 'File changed during indexing; scan again.', 409);
  if (expected && (before.size !== expected.fileSize || before.mtimeMs !== expected.fileMtimeMs))
    throw changed();
  const directory = path.join(library, 'project-files', projectId);
  await ensureCopyDirectory(directory);
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  const hash = createHash('sha256');
  let bytesRead = 0;
  try {
    await pipeline(
      createReadStream(file),
      new Transform({
        transform(bytes, encoding, callback) {
          hash.update(bytes);
          bytesRead += bytes.length;
          callback(null, bytes);
        },
      }),
      createWriteStream(temporary, { flags: 'wx' }),
    );
    const after = await stat(file).catch((error) => {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw changed();
      throw error;
    });
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.ino !== after.ino ||
      bytesRead !== before.size
    )
      throw changed();
    const contentHash = hash.digest('hex');
    const originalPath = `project-files/${projectId}/${contentHash}`;
    const reused = await publishSnapshot(temporary, path.join(library, originalPath), before.size);
    return {
      contentHash,
      originalPath,
      fileSize: before.size,
      fileMtimeMs: before.mtimeMs,
      reused,
    };
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
