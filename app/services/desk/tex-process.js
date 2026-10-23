// Direct executable invocation; the owned process tree follows the existing
// shell tool's taskkill/process-group approach. No compiler shell is exposed.
import { spawn } from 'node:child_process';
import path from 'node:path';

async function stopTree(pid) {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    return;
  }
  await new Promise((resolve, reject) => {
    const child = spawn(
      path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/taskkill.exe'),
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    child.once('error', reject);
    child.once('close', resolve);
  });
}

/**
 * MiKTeX documents --disable-installer; its Core/Session/config.cpp also reads
 * per-program MPM AutoInstall environment overrides before persistent settings.
 * Only the subprocess receives these values; the user's configuration is untouched.
 * @param {NodeJS.ProcessEnv} source
 * @returns {NodeJS.ProcessEnv}
 */
export function noninteractiveTexEnv(source) {
  const env = { ...source, MIKTEX_MPM_AUTOINSTALL: 'no' };
  for (const name of [
    'xelatex',
    'lualatex',
    'pdflatex',
    'latexmk',
    'bibtex',
    'biber',
    'kpsewhich',
    'miktex',
    'miktex-runscript',
    'runscript',
    'xetex',
    'luatex',
    'pdftex',
  ])
    env[`MIKTEX_${name.replace(/[^a-z0-9]/gi, '').toUpperCase()}_MPM_AUTOINSTALL`] = 'no';
  return env;
}

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {{cwd?:string,env?:NodeJS.ProcessEnv,signal?:AbortSignal,timeoutMs?:number}} [options]
 * @returns {Promise<{code:number|null,output:string,stdout?:string,aborted:boolean}>}
 */
export async function runTexProcess(executable, args, options = {}) {
  const controller = new AbortController();
  const forward = () => controller.abort(options.signal.reason);
  options.signal?.addEventListener('abort', forward, { once: true });
  if (options.signal?.aborted) forward();
  const timer =
    options.timeoutMs == null ? null : setTimeout(() => controller.abort(), options.timeoutMs);
  let stop;
  try {
    if (controller.signal.aborted) return { code: null, output: '', aborted: true };
    // PowerShell scripts support deterministic temporary-PATH compiler fixtures.
    const script = process.platform === 'win32' && executable.endsWith('.ps1');
    const child = spawn(
      script
        ? path.join(
            process.env.SystemRoot ?? 'C:/Windows',
            'System32/WindowsPowerShell/v1.0/powershell.exe',
          )
        : executable,
      script ? ['-NoProfile', '-NonInteractive', '-File', executable, ...args] : args,
      {
        cwd: options.cwd,
        env: noninteractiveTexEnv(options.env ?? process.env),
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stopping;
    stop = () => {
      if (child.pid && !stopping) stopping = stopTree(child.pid);
    };
    controller.signal.addEventListener('abort', stop, { once: true });
    if (controller.signal.aborted) stop();
    let output = '';
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    await stopping;
    return { code, output, stdout, aborted: controller.signal.aborted };
  } finally {
    if (timer) clearTimeout(timer);
    if (stop) controller.signal.removeEventListener('abort', stop);
    options.signal?.removeEventListener('abort', forward);
  }
}
