import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { renameWithRetry } from './rename.js';

/**
 * Write through a temporary file and rename, so readers never see half a file.
 * @param {string} file
 * @param {Uint8Array} bytes
 * @param {{mode?:number}} [options]
 * @returns {Promise<void>}
 */
export async function writeBytesAtomic(file, bytes, { mode } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { mode });
    await renameWithRetry(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
