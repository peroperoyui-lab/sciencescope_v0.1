// Adapted in design from pi-coding-agent 1.0.0 core/tools/bash and utils/shell
// (MIT). ScienceScope uses PowerShell on Windows and always retains full output.
import { spawn, execFileSync } from 'node:child_process';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { outputPath, previewFile } from './output.js';
import { windowsShellJob } from './windows-shell-job.js';

function shellCommand(command, selectedExecutable, nonce) {
  if (process.platform !== 'win32') return { executable: 'bash', args: ['-c', command] };
  const system = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
  let executable = selectedExecutable;
  if (!executable) {
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
  }
  const script =
    (nonce ? `# ScienceScope shell ${nonce}\n` : '') +
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
 * @param {string[]} commandArgs
 */
async function stopTree(pid, commandArgs) {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    return;
  }
  const system = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
  const executable = path.join(system, 'WindowsPowerShell/v1.0/powershell.exe');
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', STOP_SCRIPT],
      {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      },
    );
    child.once('error', reject);
    child.once('close', resolve);
    child.stdin.on('error', () => {});
    child.stdin.end(
      JSON.stringify({ pid, parent: process.pid, command: commandArgs.at(-1) }) + '\n',
    );
  });
  if (code === 0) return;
  throw new AppError(
    'SHELL_STOP_FAILED',
    'Could not confirm that all command descendants stopped. Check for tasks still running.',
  );
}

// taskkill /T snapshots before killing the shell, which can create another child
// in between. Stop the identity-checked root first, then re-scan its descendants.
// Hold every observed Process.Handle until verification ends, and compare both
// parent lifetime and child birth time before acting on an OS-reused PID.
const STOP_SCRIPT = Buffer.from(
  String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$request = [Console]::ReadLine() | ConvertFrom-Json
$known = @{}
$root = $null
function SameBirth($process, $row) {
  return [Math]::Abs($process.StartTime.ToUniversalTime().Ticks - $row.CreationDate.ToUniversalTime().Ticks) -lt 10
}
function StopOwned($process) {
  $null = $process.Handle
  $record = @{ Process = $process; Start = $process.StartTime.ToUniversalTime(); End = $null }
  $known[[int]$process.Id] = $record
  try {
    if (-not $process.HasExited) { $process.Kill() }
  } catch [InvalidOperationException] {
    if (-not $process.HasExited) { throw }
  } catch [ComponentModel.Win32Exception] {
    if (-not $process.HasExited) { throw }
  }
  $process.WaitForExit()
  $record.End = $process.ExitTime.ToUniversalTime()
}
try {
  try { $root = [Diagnostics.Process]::GetProcessById([int]$request.pid) }
  catch [ArgumentException] { throw 'The shell exited before its identity could be verified.' }
  $null = $root.Handle
  if ($root.HasExited) { throw 'The shell exited before its identity could be verified.' }
  $identity = Get-CimInstance Win32_Process -Filter "ProcessId=$($request.pid)" -Property ProcessId,ParentProcessId,CreationDate,CommandLine
  if (-not $identity -or $root.HasExited) { throw 'The shell exited before its identity could be verified.' }
  if ($identity.ParentProcessId -ne $request.parent -or -not (SameBirth $root $identity) -or -not $identity.CommandLine.EndsWith([string]$request.command)) {
    throw 'The shell process identity changed.'
  }
  StopOwned $root
  do {
    $changed = $false
    $rows = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate)
    do {
      $found = $false
      foreach ($row in $rows) {
        if ($known.ContainsKey([int]$row.ProcessId)) { continue }
        $parent = $known[[int]$row.ParentProcessId]
        if (-not $parent) { continue }
        $birth = $row.CreationDate.ToUniversalTime()
        if ($birth -lt $parent.Start -or $birth -gt $parent.End) { continue }
        $process = $null
        try {
          try { $process = [Diagnostics.Process]::GetProcessById([int]$row.ProcessId) }
          catch [ArgumentException] { continue }
          $null = $process.Handle
          if (-not (SameBirth $process $row)) { continue }
          StopOwned $process
          $process = $null
          $changed = $true
          $found = $true
        } finally {
          if ($process) { $process.Dispose() }
        }
      }
    } while ($found)
  } while ($changed)
} finally {
  foreach ($record in $known.Values) { $record.Process.Dispose() }
  if ($root -and -not $known.ContainsKey([int]$request.pid)) { $root.Dispose() }
}
`,
  'utf16le',
).toString('base64');

/**
 * Prefer the packaged Job owner, compiling it in source checkouts. A machine
 * without either still runs commands with the Windows process-tree stop.
 * @param {string} temp
 */
async function jobOwner(temp) {
  if (process.platform !== 'win32') return null;
  try {
    return await windowsShellJob(temp);
  } catch {
    return null;
  }
}

/**
 * @param {{command:string,timeoutSeconds?:number}} args
 * @param {{workFolder:string,env?:{PATH?:string,VIRTUAL_ENV?:string},signal?:AbortSignal,temp:string}} context
 * @param {{shellExecutable?:string,createJobOwner?:typeof jobOwner}} [options]
 */
export async function runShell(
  args,
  { workFolder, env, signal, temp },
  { shellExecutable, createJobOwner = jobOwner } = {},
) {
  signal?.throwIfAborted();
  const timeoutSeconds = args.timeoutSeconds ?? 600;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
    throw new AppError('INVALID_TIMEOUT', 'timeoutSeconds must be a positive number.');
  const file = await outputPath(temp);
  const owner = await createJobOwner(temp);
  signal?.throwIfAborted();
  const { executable, args: commandArgs } = shellCommand(
    args.command,
    shellExecutable,
    process.platform === 'win32' && !owner ? path.basename(file) : undefined,
  );
  // PS5 duplicates inheritable standard handles into native/background children,
  // even when their actual output is redirected. A regular append-only output
  // file has no pipe EOF to hold open, and preserves ongoing background writes.
  const fileOutput =
    process.platform === 'win32' && path.basename(executable).toLowerCase() === 'powershell.exe';
  const output = await open(file, fileOutput ? 'a' : 'w');
  const childEnv = { ...process.env };
  // Windows treats environment names case-insensitively. Avoid a stale Path
  // shadowing the meeting's PATH when Node builds the child environment block.
  if (env?.PATH != null)
    for (const key of Object.keys(childEnv)) if (key.toUpperCase() === 'PATH') delete childEnv[key];
  Object.assign(childEnv, env);
  const ownerArgs = [executable, ...commandArgs];
  if (fileOutput) ownerArgs.unshift('--output-file', file);
  const child = spawn(owner ?? executable, owner ? ownerArgs : commandArgs, {
    cwd: workFolder,
    env: childEnv,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: [
      owner ? 'pipe' : 'ignore',
      !owner && fileOutput ? output.fd : 'pipe',
      !owner && fileOutput ? output.fd : 'pipe',
    ],
  });
  let timedOut = false;
  let writeError;
  let writes = Promise.resolve();
  let stopping;
  let stopError;
  let rejectCompletion;
  // The owner acknowledges stop only after every Job member is gone. Normal
  // PS5 completion releases background processes without waiting for pipe EOF.
  child.stdin?.on('error', () => {});
  const stop = () => {
    if (child.pid && !stopping) {
      if (owner) {
        if (child.exitCode !== null || child.signalCode !== null) stopping = Promise.resolve();
        else {
          stopping = new Promise((resolve) => child.once('close', resolve));
          child.stdin.end('stop\n');
        }
      } else
        stopping = stopTree(child.pid, commandArgs).catch((error) => {
          stopError = error;
          rejectCompletion?.(error);
        });
    }
    return stopping;
  };
  const capture = (stream) =>
    stream?.on('data', (chunk) => {
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
      rejectCompletion = reject;
      child.once('error', reject);
      child.once('close', (code) => resolve(code));
      if (stopError) reject(stopError);
    });
    await stopping;
    await writes;
    if (writeError) throw writeError;
    if (stopError) throw stopError;
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
