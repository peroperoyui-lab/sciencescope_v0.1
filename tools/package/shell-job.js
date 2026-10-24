// Installed tools should use a build artifact rather than wait for csc on the
// user's first shell command. Source compilation remains the Node-only fallback.
import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/**
 * @param {string} root
 * @param {string} output
 * @returns {Promise<string>}
 */
export async function compileShellJob(root, output) {
  const executable = path.join(output, 'runtime/windows-shell-job.exe');
  const compiler = path.join(
    process.env.SystemRoot ?? 'C:/Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  );
  await mkdir(path.dirname(executable), { recursive: true });
  await execute(
    compiler,
    [
      '/nologo',
      '/target:exe',
      `/out:${executable}`,
      path.join(root, 'app/services/builtin-tools/windows-shell-job.cs'),
    ],
    { windowsHide: true },
  );
  return executable;
}
