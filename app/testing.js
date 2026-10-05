// Test helpers shared by app tests. Every test folder lives under
// .sciencescope-local/temp and is removed by the test that created it.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Hold a real Windows file handle without delete sharing. @param {string} file */
export async function lockWindowsFile(file) {
  const command = [
    '$file = [Console]::ReadLine()',
    '$handle = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)',
    'try { [Console]::WriteLine("READY"); [Console]::ReadLine() | Out-Null } finally { $handle.Dispose() }',
  ].join('; ');
  const executable = path.join(
    process.env.SystemRoot ?? 'C:/Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', (data) => resolve(String(data).trim() === 'READY'));
    child.once('exit', () => reject(new Error('File lock process exited before READY')));
  });
  child.stdin.write(`${file}\n`);
  if (!(await ready)) throw new Error('File lock did not become ready');
  return async () => {
    child.stdin.end('\n');
    await exited;
  };
}

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
