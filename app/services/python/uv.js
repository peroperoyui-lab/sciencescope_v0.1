// uv owns interpreter discovery, dependency resolution and hardlink fallback.
// Keep its configuration/cache under the application's data root, not the user's.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} command
 * @param {string[]} args
 * @param {any} options
 * @returns {Promise<{stdout:string,stderr:string}>}
 */
export function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false, windowsHide: true });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          Object.assign(new Error(stderr.trim() || `Command failed (${code})`), { stdout, stderr }),
        );
    });
  });
}

/**
 * @param {string} root
 * @param {{uvPath?:string,runner?:typeof runProcess}} [options]
 */
export function createUv(root, { uvPath, runner = runProcess } = {}) {
  const executable =
    uvPath ??
    process.env.SCIENCESCOPE_UV ??
    fileURLToPath(
      new URL(
        `../../../.sciencescope-local/runtimes/uv/uv${process.platform === 'win32' ? '.exe' : ''}`,
        import.meta.url,
      ),
    );
  const controllers = new Set();
  let closed = false;
  async function invoke(
    command,
    args,
    indexUrl = null,
    installMirror = null,
    requestSignal = null,
  ) {
    if (closed) throw new Error('Python service is closed');
    const controller = new AbortController();
    const signal = requestSignal
      ? AbortSignal.any([controller.signal, requestSignal])
      : controller.signal;
    signal.throwIfAborted();
    controllers.add(controller);
    try {
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (/^(UV_|PIP_)/iu.test(key)) delete env[key];
      for (const folder of ['cache', 'interpreters', 'tmp'])
        await mkdir(path.join(root, folder), { recursive: true });
      Object.assign(env, {
        UV_NO_CONFIG: '1',
        PIP_CONFIG_FILE: os.devNull,
        UV_CACHE_DIR: path.join(root, 'cache'),
        UV_PYTHON_INSTALL_DIR: path.join(root, 'interpreters'),
        UV_LINK_MODE: 'hardlink',
        UV_TMPDIR: path.join(root, 'tmp'),
        TEMP: path.join(root, 'tmp'),
        TMP: path.join(root, 'tmp'),
        TMPDIR: path.join(root, 'tmp'),
      });
      if (indexUrl) env.UV_INDEX_URL = indexUrl;
      if (installMirror) env.UV_PYTHON_INSTALL_MIRROR = installMirror;
      return await runner(command, args, { env, signal });
    } finally {
      controllers.delete(controller);
    }
  }
  return {
    run: (args, indexUrl = null, installMirror = null, signal = null) =>
      invoke(executable, args, indexUrl, installMirror, signal),
    python: (executablePath, args, signal = null) =>
      invoke(executablePath, args, null, null, signal),
    close() {
      closed = true;
      for (const controller of controllers) controller.abort();
    },
  };
}
