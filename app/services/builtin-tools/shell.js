// Adapted in design from pi-coding-agent 1.0.0 core/tools/bash and utils/shell
// (MIT). ScienceScope uses PowerShell on Windows and always retains full output.
import { spawn, execFileSync } from 'node:child_process';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { outputPath, previewFile } from './output.js';

function shellCommand(command) {
  if (process.platform !== 'win32') return { executable: 'bash', args: ['-c', command] };
  const system = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
  let executable;
  try {
    executable = execFileSync(path.join(system, 'where.exe'), ['pwsh.exe'], {
      encoding: 'utf8',
      windowsHide: true,
    })
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    executable = path.join(system, 'WindowsPowerShell/v1.0/powershell.exe');
  }
  const script =
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); $OutputEncoding = [Console]::OutputEncoding;\n' +
    command +
    '\nif (-not $?) { if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }';
  return {
    executable,
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
  };
}

/**
 * Terminate the shell and its children, not unrelated application processes.
 * @param {number} pid
 */
async function stopTree(pid) {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    return;
  }
  const executable = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/taskkill.exe');
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('close', () => resolve(undefined));
  });
}

/**
 * @param {{command:string,timeoutSeconds?:number}} args
 * @param {{workFolder:string,env?:{PATH?:string,VIRTUAL_ENV?:string},signal?:AbortSignal,temp:string}} context
 */
export async function runShell(args, { workFolder, env, signal, temp }) {
  signal?.throwIfAborted();
  const timeoutSeconds = args.timeoutSeconds ?? 600;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
    throw new AppError('INVALID_TIMEOUT', 'timeoutSeconds must be a positive number.');
  const { executable, args: commandArgs } = shellCommand(args.command);
  const file = await outputPath(temp);
  const output = await open(file, 'w');
  const childEnv = { ...process.env };
  // Windows treats environment names case-insensitively. Avoid a stale Path
  // shadowing the meeting's PATH when Node builds the child environment block.
  if (env?.PATH != null)
    for (const key of Object.keys(childEnv)) if (key.toUpperCase() === 'PATH') delete childEnv[key];
  Object.assign(childEnv, env);
  const child = spawn(executable, commandArgs, {
    cwd: workFolder,
    env: childEnv,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let timedOut = false;
  let writeError;
  let writes = Promise.resolve();
  let stopping;
  const stop = () => {
    if (child.pid && !stopping) stopping = stopTree(child.pid);
    return stopping;
  };
  const capture = (stream) =>
    stream.on('data', (chunk) => {
      stream.pause();
      writes = writes
        .then(async () => {
          await output.write(chunk);
        })
        .catch((error) => {
          writeError = error;
          void stop();
        })
        .finally(() => stream.resume());
    });
  capture(child.stdout);
  capture(child.stderr);
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) void stop();
  // Re-arm long timeouts instead of overflowing Node's 32-bit timer range.
  const deadline = Date.now() + timeoutSeconds * 1000;
  let timer;
  const arm = () => {
    timer = setTimeout(
      () => {
        if (Date.now() < deadline) arm();
        else {
          timedOut = true;
          void stop();
        }
      },
      Math.min(2147483647, Math.max(1, deadline - Date.now())),
    );
  };
  arm();
  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code));
    });
    await stopping;
    await writes;
    if (writeError) throw writeError;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    await writes;
    await output.close();
  }
  return {
    exitCode,
    cancelled: Boolean(signal?.aborted),
    timedOut,
    ...(timedOut ? { message: `Command stopped after ${timeoutSeconds} seconds.` } : {}),
    ...(await previewFile(file)),
  };
}
