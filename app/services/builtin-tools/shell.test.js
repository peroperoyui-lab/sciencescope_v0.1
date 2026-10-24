import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { tempDir } from '../../testing.js';
import { runShell } from './shell.js';

const quote = (value) =>
  process.platform === 'win32'
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`;
const command = (script) =>
  `${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} ${quote(script)}`;

test('shell uses the meeting environment, preserves long output and reports exit status', async () => {
  const { dir, cleanup } = await tempDir('builtin-shell');
  try {
    const script = path.join(dir, '中文脚本.cjs');
    await writeFile(
      script,
      "console.log(process.env.VIRTUAL_ENV);console.log('开始'+ '中'.repeat(40000)+'结束');process.exitCode=7;",
    );
    const result = await runShell(
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

test('shell interruption ends both the shell and its nested command process', async () => {
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
    result = runShell(
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

test('shell timeout terminates the command and provides an explicit explanation', async () => {
  const { dir, cleanup } = await tempDir('builtin-timeout');
  try {
    const script = path.join(dir, 'wait.cjs');
    await writeFile(script, 'setInterval(()=>{},1000);');
    const result = await runShell(
      { command: command(script), timeoutSeconds: 0.2 },
      { workFolder: dir, temp: dir },
    );
    assert.equal(result.timedOut, true);
    assert.match(result.message, /0.2 seconds/);
  } finally {
    await cleanup();
  }
});

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

for (const action of ['timeout', 'stop']) {
  test(
    `Windows shell ${action} ends descendants after their parent exits with output still open`,
    {
      skip: process.platform !== 'win32',
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
            command: `[IO.File]::WriteAllText(${quote(shellPidFile)},[string]$PID); Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ${quote('"' + child + '"')} -NoNewWindow; exit 0`,
            timeoutSeconds: action === 'timeout' ? 3 : 10,
          },
          { workFolder: dir, temp: dir, signal: controller.signal },
        );
        const shellPid = await readPid(shellPidFile);
        pids.push(await readPid(childPidFile), await readPid(grandchildPidFile));
        await waitForExit(shellPid);
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

test(
  'Windows shell normal completion preserves a background process with redirected output',
  {
    skip: process.platform !== 'win32',
    timeout: 20000,
  },
  async () => {
    const { dir, cleanup } = await tempDir('builtin-background');
    let pid;
    try {
      const pidFile = path.join(dir, 'background.pid');
      const script = path.join(dir, 'background.cjs');
      const launcher = path.join(dir, 'launcher.cjs');
      await writeFile(
        script,
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`,
      );
      await writeFile(
        launcher,
        `const fs=require('node:fs');require('node:child_process').spawn(process.execPath,[${JSON.stringify(script)}],{cwd:${JSON.stringify(path.dirname(dir))},detached:true,stdio:['ignore',fs.openSync('stdout.txt','w'),fs.openSync('stderr.txt','w')]}).unref();`,
      );
      const result = await runShell(
        {
          command: command(launcher),
          timeoutSeconds: 5,
        },
        { workFolder: dir, temp: dir },
      );
      assert.equal(result.exitCode, 0);
      assert.equal(result.timedOut, false);
      pid = await readPid(pidFile);
      process.kill(pid, 0);
    } finally {
      if (pid) {
        killFixture(pid);
        await waitForExit(pid);
      }
      await cleanup();
    }
  },
);
