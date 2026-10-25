import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempDir } from '../../testing.js';
import { runShell } from './shell.js';

const quote = (value) =>
  process.platform === 'win32'
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`;
const command = (script) =>
  `${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} ${quote(script)}`;

const windows = process.platform === 'win32';
const system = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32');
const powershell5 = path.join(system, 'WindowsPowerShell/v1.0/powershell.exe');
let powershell7;
if (windows) {
  try {
    powershell7 = execFileSync(path.join(system, 'where.exe'), ['pwsh.exe'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    // PS5 is installed with Windows; PS7 is optional on end-user machines.
  }
}
const configurations = windows
  ? [
      { name: 'PS5 Job', options: { shellExecutable: powershell5 } },
      {
        name: 'PS5 fallback',
        options: { shellExecutable: powershell5, createJobOwner: async () => null },
      },
      ...(powershell7 ? [{ name: 'PS7 Job', options: { shellExecutable: powershell7 } }] : []),
    ]
  : [{ name: 'bash', options: {} }];

for (const configuration of configurations) {
  const run = (args, context) => runShell(args, context, configuration.options);

  test(`${configuration.name} shell uses the meeting environment, preserves long output and reports exit status`, async () => {
    const { dir, cleanup } = await tempDir('builtin-shell');
    try {
      const script = path.join(dir, '中文脚本.cjs');
      await writeFile(
        script,
        "console.log(process.env.VIRTUAL_ENV);console.log('开始'+ '中'.repeat(40000)+'结束');process.exitCode=7;",
      );
      const result = await run(
        { command: command(script) },
        {
          workFolder: dir,
          temp: path.join(dir, 'temp'),
          env: { VIRTUAL_ENV: '中文环境', PATH: process.env.PATH },
        },
      );
      assert.equal(result.exitCode, 7);
      assert.match(result.output, /中文环境/);
      assert.match(result.output, /结束/);
      assert.ok(result.omittedBytes > 0);
      const full = await readFile(result.fullOutputPath, 'utf8');
      assert.equal(full.includes('中'.repeat(40000)), true);
    } finally {
      await cleanup();
    }
  });

  test(`${configuration.name} shell interruption ends both the shell and its nested command process`, async () => {
    const { dir, cleanup } = await tempDir('builtin-stop');
    const controller = new AbortController();
    let result;
    try {
      const pidFile = path.join(dir, 'child.pid');
      const script = path.join(dir, 'wait.cjs');
      await writeFile(
        script,
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`,
      );
      result = run(
        { command: command(script) },
        { workFolder: dir, temp: dir, signal: controller.signal },
      );
      let pid;
      const deadline = Date.now() + 10000;
      while (!pid && Date.now() < deadline) {
        pid = Number(await readFile(pidFile, 'utf8').catch(() => ''));
        if (!pid) await delay(20);
      }
      assert.ok(pid);
      const start = performance.now();
      controller.abort();
      assert.equal((await result).cancelled, true);
      assert.ok(performance.now() - start < 2000);
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    } finally {
      controller.abort();
      await result;
      await cleanup();
    }
  });

  test(`${configuration.name} shell timeout terminates the command and provides an explicit explanation`, async () => {
    const { dir, cleanup } = await tempDir('builtin-timeout');
    try {
      const script = path.join(dir, 'wait.cjs');
      await writeFile(script, 'setInterval(()=>{},1000);');
      const result = await run(
        { command: command(script), timeoutSeconds: 0.2 },
        { workFolder: dir, temp: dir },
      );
      assert.equal(result.timedOut, true);
      assert.match(result.message, /0.2 seconds/);
    } finally {
      await cleanup();
    }
  });
}

async function readPid(file) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const pid = Number(await readFile(file, 'utf8').catch(() => ''));
    if (pid) return pid;
    await delay(20);
  }
  assert.fail(`Process did not start: ${file}`);
}

async function waitForExit(pid) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(20);
  }
  assert.fail(`Process did not exit: ${pid}`);
}

function killFixture(pid) {
  try {
    process.kill(pid);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function removeBackgroundFixture(dir) {
  // TerminateProcess can report an exited PID before Windows releases its
  // inherited file/console handles. Retry that filesystem result, not assertions.
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

for (const action of ['timeout', 'stop']) {
  for (const configuration of configurations.filter(() => windows)) {
    // PS7 retains pipe capture and its existing stop-after-parent-exit behavior.
    // PS5 now completes when the root exits; its still-writing descendants are
    // covered below, while active-command cancellation is exercised for both.
    test(
      `${configuration.name} shell ${action} ends the whole running process tree`,
      {
        skip: !windows,
        timeout: 20000,
      },
      async () => {
        const { dir, cleanup } = await tempDir(`builtin-orphan-${action}`);
        const controller = new AbortController();
        let running;
        const pids = [];
        try {
          const shellPidFile = path.join(dir, 'shell.pid');
          const childPidFile = path.join(dir, 'child.pid');
          const grandchildPidFile = path.join(dir, 'grandchild.pid');
          const grandchild = path.join(dir, 'grandchild.cjs');
          const child = path.join(dir, 'child.cjs');
          const pipeOutput = configuration.options.shellExecutable === powershell7;
          await writeFile(
            grandchild,
            `require('node:fs').writeFileSync(${JSON.stringify(grandchildPidFile)},String(process.pid));setInterval(()=>{},1000);`,
          );
          await writeFile(
            child,
            `require('node:fs').writeFileSync(${JSON.stringify(childPidFile)},String(process.pid));require('node:child_process').spawn(process.execPath,[${JSON.stringify(grandchild)}],{stdio:'inherit'});setInterval(()=>{},1000);`,
          );
          running = runShell(
            {
              command: `[IO.File]::WriteAllText(${quote(shellPidFile)},[string]$PID); Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ${quote('"' + child + '"')} -NoNewWindow; ${pipeOutput ? 'exit 0' : 'Start-Sleep -Seconds 60'}`,
              timeoutSeconds: action === 'timeout' ? 3 : 10,
            },
            { workFolder: dir, temp: dir, signal: controller.signal },
            configuration.options,
          );
          const shellPid = await readPid(shellPidFile);
          pids.push(await readPid(childPidFile), await readPid(grandchildPidFile));
          if (pipeOutput) await waitForExit(shellPid);
          else process.kill(shellPid, 0);
          // The parent is already gone; a PID-based taskkill cannot find this tree.
          for (const pid of pids) process.kill(pid, 0);
          if (action === 'stop') controller.abort();
          const result = await running;
          assert.equal(result.timedOut, action === 'timeout');
          assert.equal(result.cancelled, action === 'stop');
          for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
        } finally {
          controller.abort();
          await running;
          for (const pid of pids) killFixture(pid);
          await cleanup();
        }
      },
    );
  }
}

for (const configuration of configurations.filter(() => windows)) {
  test(
    `${configuration.name} shell normal completion preserves background processes with continuously redirected output`,
    {
      skip: process.platform !== 'win32',
      timeout: 20000,
    },
    async () => {
      const { dir } = await tempDir('builtin-background');
      const pids = [];
      const pidFiles = [];
      try {
        const pidFile = path.join(dir, 'background.pid');
        const startedPidFile = path.join(dir, 'started.pid');
        pidFiles.push(pidFile, startedPidFile);
        const script = path.join(dir, 'background.cjs');
        const launcher = path.join(dir, 'launcher.cjs');
        await writeFile(
          script,
          `require('node:fs').writeFileSync(process.argv[2] || ${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{console.log('background output');console.error('background error')},20);`,
        );
        await writeFile(
          launcher,
          `const fs=require('node:fs');require('node:child_process').spawn(process.execPath,[${JSON.stringify(script)}],{cwd:${JSON.stringify(path.dirname(dir))},detached:true,stdio:['ignore',fs.openSync('stdout.txt','w'),fs.openSync('stderr.txt','w')]}).unref();`,
        );
        const startedOutput = path.join(dir, 'started-output.txt');
        const startedError = path.join(dir, 'started-error.txt');
        const startProcess = configuration.options.shellExecutable === powershell5;
        // The disposable case directory should not remain a background console's
        // working directory while Windows finishes tearing that console down.
        const startCommand = startProcess
          ? `Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ${quote('"' + script + '" "' + startedPidFile + '"')} -WorkingDirectory ${quote(path.dirname(dir))} -WindowStyle Hidden -RedirectStandardOutput ${quote(startedOutput)} -RedirectStandardError ${quote(startedError)}; `
          : '';
        const start = performance.now();
        const result = await runShell(
          {
            command: `${command(launcher)}; ${startCommand}[Console]::WriteLine('shell完整输出'); [Console]::Error.WriteLine('shell完整错误')`,
            timeoutSeconds: 5,
          },
          { workFolder: dir, temp: dir },
          configuration.options,
        );
        const elapsedMs = performance.now() - start;
        assert.equal(result.exitCode, 0);
        assert.equal(result.timedOut, false);
        assert.ok(elapsedMs < 5000, `${configuration.name}: ${elapsedMs} ms`);
        assert.match(result.output, /shell完整输出/);
        assert.match(result.output, /shell完整错误/);
        pids.push(await readPid(pidFile));
        if (startProcess) pids.push(await readPid(startedPidFile));
        for (const pid of pids) process.kill(pid, 0);
        const backgroundOutput = startProcess ? startedOutput : path.join(dir, 'stdout.txt');
        const before = await readFile(backgroundOutput, 'utf8');
        const deadline = Date.now() + 3000;
        while (
          (await readFile(backgroundOutput, 'utf8')).length <= before.length &&
          Date.now() < deadline
        )
          await delay(20);
        assert.ok((await readFile(backgroundOutput, 'utf8')).length > before.length);
      } finally {
        for (const file of pidFiles) {
          const pid = Number(await readFile(file, 'utf8').catch(() => ''));
          if (pid && !pids.includes(pid)) pids.push(pid);
        }
        for (const pid of pids) {
          killFixture(pid);
          await waitForExit(pid);
        }
        await removeBackgroundFixture(dir);
      }
    },
  );
}

for (const configuration of configurations.filter((entry) => entry.name.startsWith('PS5'))) {
  test(`${configuration.name} returns while an inherited-output background process keeps writing`, async () => {
    const { dir } = await tempDir('builtin-live-background');
    const pidFile = path.join(dir, 'background.pid');
    let pid;
    try {
      const script = path.join(dir, 'background.cjs');
      await writeFile(
        script,
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{console.log('background');console.error('background error')},10);`,
      );
      const started = performance.now();
      const result = await runShell(
        {
          command: `Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ${quote('"' + script + '"')} -WorkingDirectory ${quote(path.dirname(dir))} -NoNewWindow; [Console]::WriteLine(('主进程' * 30000) + '完整尾部'); [Console]::Error.WriteLine('完整错误尾部')`,
          timeoutSeconds: 5,
        },
        { workFolder: dir, temp: dir },
        configuration.options,
      );
      assert.equal(result.timedOut, false);
      assert.equal(result.exitCode, 0);
      assert.ok(performance.now() - started < 5000);
      pid = await readPid(pidFile);
      process.kill(pid, 0);
      const output = await readFile(result.fullOutputPath, 'utf8');
      // Concurrent writers can interleave OS writes. Remove the known background
      // records, then verify every foreground character without weakening counts.
      const foreground = output.replace(/background(?: error)?\r?\n/g, '');
      assert.ok(foreground.includes('主进程'.repeat(30000) + '完整尾部'));
      assert.match(output, /完整错误尾部/);
      const deadline = Date.now() + 3000;
      while (
        (await readFile(result.fullOutputPath, 'utf8')).length <= output.length &&
        Date.now() < deadline
      )
        await delay(20);
      assert.ok((await readFile(result.fullOutputPath, 'utf8')).length > output.length);
      process.kill(pid, 0);
    } finally {
      pid ??= Number(await readFile(pidFile, 'utf8').catch(() => ''));
      if (pid) {
        killFixture(pid);
        await waitForExit(pid);
      }
      await removeBackgroundFixture(dir);
    }
  });
}
