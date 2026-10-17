// Package installation is a filesystem operation; the catalog service owns
// status transitions and records every result passed back through these hooks.
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { requirements } from './files.js';
const BUILTIN = 'builtin-science';

/**
 * @param {any} dependencies
 */
export function createInstaller({ root, get, update, log, uv, command, envPath, interpreter }) {
  async function sync(id, packages, lock = null, signal = null) {
    signal?.throwIfAborted();
    const temp = path.join(root, 'tmp', randomUUID());
    await mkdir(temp, { recursive: true });
    const input = path.join(temp, 'requirements.in'),
      output = path.join(temp, 'requirements.lock');
    const details = [];
    try {
      await writeFile(input, packages.join('\n'));
      if (lock) await writeFile(output, lock.join('\n'));
      else {
        const previous = get(id).lock;
        if (previous.length) await writeFile(output, previous.join('\n'));
        details.push(
          await command(
            [
              'pip',
              'compile',
              input,
              '--python',
              interpreter(id),
              '--output-file',
              output,
              '--no-header',
              '--no-annotate',
            ],
            signal,
          ),
        );
      }
      const resolved = requirements(await readFile(output, 'utf8'));
      details.push(await command(['pip', 'sync', '--python', interpreter(id), output], signal));
      return { lock: resolved, details };
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  async function prepare(id, packages, lock, actor, reason, signal = null) {
    signal?.throwIfAborted();
    update(id, { status: 'preparing', error: null });
    const details = [];
    try {
      await mkdir(path.dirname(envPath(id)), { recursive: true });
      if (!(await stat(interpreter(id)).catch(() => null))) {
        details.push(
          await command(
            ['venv', '--managed-python', '--python', get(id).version, envPath(id)],
            signal,
          ),
        );
      }
      const versionResult = await uv.python(interpreter(id), ['--version'], signal);
      const version = `${versionResult.stdout} ${versionResult.stderr}`.match(
        /Python\s+(3\.\d+\.\d+)/u,
      )?.[1];
      const requested = get(id).version;
      if (!version || !(version === requested || version.startsWith(requested + '.')))
        throw new Error('Python version differs from requested version');
      let result;
      const failed = [];
      try {
        result = await sync(id, packages, lock, signal);
      } catch (error) {
        signal?.throwIfAborted();
        if (id !== BUILTIN || !lock) throw error;
        details.push({ message: error.message, stdout: error.stdout, stderr: error.stderr });
        // A missing platform wheel must not prevent independent packages from
        // being usable. Keep the fixed constraints and report each failure.
        const constraints = path.join(root, 'tmp', randomUUID() + '.lock');
        await writeFile(constraints, lock.join('\n'));
        try {
          for (const spec of packages) {
            try {
              details.push(
                await command(
                  [
                    'pip',
                    'install',
                    '--python',
                    interpreter(id),
                    '--constraint',
                    constraints,
                    spec,
                  ],
                  signal,
                ),
              );
            } catch (failure) {
              signal?.throwIfAborted();
              failed.push({ package: spec, reason: failure.message });
            }
          }
        } finally {
          await rm(constraints, { force: true });
        }
        const frozen = await command(['pip', 'freeze', '--python', interpreter(id)], signal);
        result = { lock: requirements(frozen.stdout), details: [] };
      }
      const status = failed.length
        ? failed.length < packages.length
          ? 'partial'
          : 'failed'
        : 'ready';
      update(id, {
        version,
        status,
        error: failed.length ? '部分软件包未安装，请重试。' : null,
        packages_json: JSON.stringify(packages),
        lock_json: JSON.stringify(result.lock),
        failed_json: JSON.stringify(failed),
      });
      log(id, 'prepare', actor, reason, status, {
        packages,
        details: [...details, ...result.details],
        failed,
      });
      if (status === 'failed') throw new Error('No builtin packages could be installed');
      return get(id);
    } catch (error) {
      update(id, { status: 'failed', error: '环境准备失败，请检查网络、镜像源后重试。' });
      log(id, 'prepare', actor, reason, 'failed', {
        packages,
        message: error.message,
        stdout: error.stdout,
        stderr: error.stderr,
        details,
      });
      throw new AppError('UV_OPERATION_FAILED', '环境准备失败，请检查网络、镜像源后重试。', 500);
    }
  }
  return { sync, prepare };
}
