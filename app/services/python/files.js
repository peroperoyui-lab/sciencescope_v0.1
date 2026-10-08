import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../core/errors.js';

/**
 * Only named distributions/extras/version clauses: uv options and file inputs
 * have different meanings and are not package specifications.
 * @param {string[]} packages
 */
export function validatePackages(packages) {
  if (!Array.isArray(packages)) throw new AppError('INVALID_PACKAGES', '软件包必须是数组。');
  return packages.map((entry) => {
    const value = typeof entry === 'string' ? entry.trim() : '';
    const match = value.match(
      /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(\[[A-Za-z0-9_,.-]+\])?(?:\s*((?:(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9][A-Za-z0-9.*+!-]*(?:\s*,\s*(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9][A-Za-z0-9.*+!-]*)*)))?$/u,
    );
    if (!match) throw new AppError('INVALID_PACKAGE_SPEC', `不支持的软件包格式：${value}`);
    return `${match[1]}${match[2] ?? ''}${match[3]?.replace(/\s+/gu, '') ?? ''}`;
  });
}

/**
 * @param {string} text
 */
export function requirements(text) {
  return String(text)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * @param {string} root
 * @returns {Promise<{totalBytes:number,exclusiveBytes:number}>}
 */
export async function directorySize(root) {
  let totalBytes = 0,
    exclusiveBytes = 0;
  const seen = new Set();
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const info = await stat(file).catch(() => null);
        if (!info) continue;
        const key = `${info.dev}:${info.ino}`;
        if (seen.has(key)) continue;
        seen.add(key);
        totalBytes += info.size;
        if (info.nlink <= 1) exclusiveBytes += info.size;
      }
    }
  }
  await visit(root);
  return { totalBytes, exclusiveBytes };
}
