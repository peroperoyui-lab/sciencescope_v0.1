// Test helpers shared by app tests. Every test folder lives under
// .sciencescope-local/temp and is removed by the test that created it.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} name
 * @returns {Promise<{ dir: string, cleanup: () => Promise<void> }>}
 */
export async function tempDir(name) {
  const base = path.join(repoRoot, '.sciencescope-local', 'temp');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, `${name}-`));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Run `work` with a fresh core on a throwaway data root, then clean up.
 * @template T
 * @param {string} name
 * @param {(core: import('./core/index.js').Core, dir: string) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withCore(name, work) {
  const { createCore } = await import('./core/index.js');
  const { dir, cleanup } = await tempDir(name);
  const core = await createCore({ dataRoot: dir });
  try {
    return await work(core, dir);
  } finally {
    core.close();
    await cleanup();
  }
}
