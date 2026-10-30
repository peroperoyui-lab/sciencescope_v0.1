import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { writeBytesAtomic } from '../files.js';

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
  await writeBytesAtomic(file, Buffer.from(text, 'utf8'));
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
