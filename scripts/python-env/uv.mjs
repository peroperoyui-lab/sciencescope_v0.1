import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr?.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const result = { code: code ?? -1, signal, stdout, stderr };
      if (code === 0) resolve(result);
      else {
        const error = new Error(`process ${args[0] ?? ''} failed (${result.code}): ${(stderr || stdout).trim()}`);
        Object.assign(error, result);
        reject(error);
      }
    });
  });
}

/** Build an isolated uv command runner. It never reads user uv/pip config. */
export function createUvCommand({ dataRoot, uvPath, runner } = {}) {
  if (!dataRoot) throw new TypeError('dataRoot is required');
  const pythonRoot = path.join(path.resolve(dataRoot), '.sciencescope-local', 'python');
  const executable = uvPath || process.env.SCIENCESCOPE_UV || path.join(path.resolve(dataRoot), '.sciencescope-local', 'runtimes', 'uv', 'uv.exe');
  const run = runner || ((command, args, options) => runProcess(command, args, options));
  const active = new Set();
  let closed = false;

  async function isolatedEnv(indexUrl) {
    await Promise.all([
      mkdir(path.join(pythonRoot, 'cache'), { recursive: true }),
      mkdir(path.join(pythonRoot, 'interpreters'), { recursive: true }),
      mkdir(path.join(pythonRoot, 'tmp'), { recursive: true }),
    ]);
    if (closed) throw new Error('Python environment service closed before a child process could start.');
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(UV_|PIP_)/iu.test(key)) delete env[key];
    Object.assign(env, {
      UV_NO_CONFIG: '1',
      PIP_CONFIG_FILE: os.devNull,
      UV_CACHE_DIR: path.join(pythonRoot, 'cache'),
      UV_PYTHON_INSTALL_DIR: path.join(pythonRoot, 'interpreters'),
      UV_TOOL_DIR: path.join(pythonRoot, 'tools'),
      UV_LINK_MODE: 'hardlink',
      UV_TMPDIR: path.join(pythonRoot, 'tmp'),
      TMP: path.join(pythonRoot, 'tmp'),
      TEMP: path.join(pythonRoot, 'tmp'),
      TMPDIR: path.join(pythonRoot, 'tmp'),
    });
    if (indexUrl) env.UV_INDEX_URL = indexUrl;
    return env;
  }

  async function invoke(command, args, { env, cwd, signal, retryHardlink = false } = {}) {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromParent();
    else signal?.addEventListener('abort', abortFromParent, { once: true });
    active.add(controller);
    try {
      try {
        const result = await run(command, args, { env, cwd, signal: controller.signal, windowsHide: true });
        return typeof result === 'string' ? { stdout: result, stderr: '', code: 0 } : result;
      } catch (error) {
        if (!retryHardlink || env.UV_LINK_MODE !== 'hardlink' || !/hard.?link|linking|link mode/iu.test(String(error.message)) || controller.signal.aborted) throw error;
        env.UV_LINK_MODE = 'copy';
        const result = await run(command, args, { env, cwd, signal: controller.signal, windowsHide: true });
        return typeof result === 'string' ? { stdout: result, stderr: '', code: 0 } : result;
      }
    } finally { active.delete(controller); signal?.removeEventListener('abort', abortFromParent); }
  }

  return {
    executable,
    pythonRoot,
    async run(args, { indexUrl, signal, cwd } = {}) {
      const env = await isolatedEnv(indexUrl);
      return invoke(this.executable, args, { env, cwd, signal, retryHardlink: true });
    },
    async runPython(interpreterPath, args = [], { indexUrl, signal, cwd } = {}) {
      const env = await isolatedEnv(indexUrl);
      return invoke(interpreterPath, args, { env, cwd, signal });
    },
    close() { closed = true; for (const controller of active) controller.abort(new Error('Python environment service closed.')); },
  };
}
