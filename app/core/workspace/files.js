import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renameWithRetry } from '../rename.js';

/**
 * @param {string} file
 * @returns {Promise<string | null>} File text, or null when the file does not exist.
 */
export async function readText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Write through a temporary file and rename, so readers never see half a file.
 * @param {string} file
 * @param {string} text
 */
export async function writeTextAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, 'utf8');
    await renameWithRetry(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** @param {string} file */
export async function removeFile(file) {
  await rm(file, { force: true });
}

/**
 * @param {string | null} text
 * @returns {string | null}
 */
export function hashText(text) {
  if (text == null) return null;
  return createHash('sha256').update(text).digest('hex');
}
