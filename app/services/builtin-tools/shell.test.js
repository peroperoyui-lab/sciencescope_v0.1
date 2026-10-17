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
