import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const builds = new Map();

/**
 * Installed tools use the build-time Job owner. Node-only tools also run
 * outside the desktop host, so retain compilation with the existing Windows
 * .NET compiler when no packaged owner is available.
 * @param {string} temp
 * @returns {Promise<string>}
 */
export async function windowsShellJob(temp) {
  const packaged = new URL('../../../runtime/windows-shell-job.exe', import.meta.url);
  try {
    await access(packaged);
    return fileURLToPath(packaged);
  } catch {
    // Source checkouts and standalone Node tools retain their existing fallback.
  }
  const source = new URL('./windows-shell-job.cs', import.meta.url);
  const hash = createHash('sha256')
    .update(await readFile(source))
    .digest('hex')
    .slice(0, 16);
  const directory = path.join(temp, 'shell-job');
  const executable = path.join(directory, `owner-${hash}.exe`);
  if (!builds.has(executable)) {
    builds.set(
      executable,
      (async () => {
        await mkdir(directory, { recursive: true });
        try {
          await access(executable);
        } catch {
          const compiler = path.join(
            process.env.SystemRoot ?? 'C:/Windows',
            'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
          );
          const temporary = path.join(directory, `build-${randomUUID()}.exe`);
          try {
            await execute(
              compiler,
              ['/nologo', '/target:exe', `/out:${temporary}`, fileURLToPath(source)],
              { windowsHide: true },
            );
            try {
              await rename(temporary, executable);
            } catch (error) {
              // Another Node process may have published this same source hash.
              await access(executable).catch(() => {
                throw error;
              });
            }
          } finally {
            await rm(temporary, { force: true });
          }
        }
        return executable;
      })().catch((error) => {
        builds.delete(executable);
        throw error;
      }),
    );
  }
  return builds.get(executable);
}
