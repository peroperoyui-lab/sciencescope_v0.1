import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const execute = promisify(execFile);
const powershell = path.join(
  process.env.SystemRoot,
  'System32/WindowsPowerShell/v1.0/powershell.exe',
);
async function processInventory() {
  const { stdout } = await execute(
    powershell,
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress',
    ],
    { windowsHide: true, timeout: 15000 },
  );
  return JSON.parse(stdout);
}
function ownedProcesses(rows, pid) {
  const ids = new Set([pid]);
  for (let pass = 0; pass < rows.length; pass++) {
    for (const row of rows) if (ids.has(row.ParentProcessId)) ids.add(row.ProcessId);
  }
  return rows.filter((row) => ids.has(row.ProcessId));
}
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function until(fn, timeout = 120000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await delay(40);
  }
  throw new Error('Timed out waiting for native acceptance state');
}

export async function prepareCold(hook, run) {
  if (!hook) throw new Error('cold requires --cold-hook: a real system-cache purge script');
  const started = Date.now();
  const { stdout } = await execute(powershell, ['-NoProfile', '-File', hook, '-Run', String(run)], {
    windowsHide: true,
    timeout: 60000,
  });
  const receipt = JSON.parse(stdout);
  if (receipt.success !== true || !receipt.method || Date.parse(receipt.clearedAt) < started) {
    throw new Error('Cold hook must report success, method and current clearedAt');
  }
  return receipt;
}

export async function launchNative({
  install,
  data,
  port,
  onPage,
  observer,
  observerOutput,
  nativeStartupOutput,
  extraBrowserArguments = '',
}) {
  const occupied = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(500),
  }).then(
    () => true,
    () => false,
  );
  if (occupied)
    throw new Error(
      `CDP port ${port} is already occupied; close the previous owned native process`,
    );
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(PATH|NODE_PATH|NODE_OPTIONS|SCIENCESCOPE_(APP|NODE|DATA|UV|HOST_SCRIPT))$/i.test(key))
      delete env[key];
  }
  env.PATH = [
    path.join(install, 'runtime'),
    process.env.SystemRoot + '/System32',
    process.env.SystemRoot,
    process.env.SystemRoot + '/System32/WindowsPowerShell/v1.0',
  ].join(';');
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS =
    `--remote-debugging-port=${port} ${extraBrowserArguments}`.trim();
  env.SCIENCESCOPE_DATA = data;
  env.SCIENCESCOPE_UPDATE_ENDPOINT = 'http://127.0.0.1:1/latest.json';
  delete env.SCIENCESCOPE_PERF_HTTP;
  delete env.SCIENCESCOPE_PERF_STARTUP_NATIVE;
  if (nativeStartupOutput) env.SCIENCESCOPE_PERF_STARTUP_NATIVE = path.resolve(nativeStartupOutput);
  if (observer) {
    env.NODE_OPTIONS = `--import "${pathToFileURL(path.resolve(observer)).href}"`;
    env.SCIENCESCOPE_PERF_HTTP = observerOutput;
  }
  const started = performance.now();
  const child = spawn(path.join(install, 'sciencescope-desktop.exe'), [], {
    cwd: install,
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const browser = await until(async () => {
    if (child.exitCode !== null) throw new Error(`Native exited ${child.exitCode}`);
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      return null;
    }
  });
  const attachedMs = performance.now() - started;
  const attached = new Set();
  const watch = async (page) => {
    if (attached.has(page)) return;
    attached.add(page);
    await onPage(page);
  };
  for (const context of browser.contexts()) {
    context.on('page', (page) => void watch(page));
    for (const page of context.pages()) await watch(page);
  }
  browser.on('context', (context) => {
    context.on('page', (page) => void watch(page));
    for (const page of context.pages()) void watch(page);
  });
  const main = await until(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => {
        try {
          const url = new URL(page.url());
          return url.hostname === '127.0.0.1' && !url.searchParams.has('surface');
        } catch {
          return false;
        }
      }),
  );
  main.setDefaultTimeout(120000);
  return {
    main,
    browser,
    child,
    started,
    attachedMs,
    async close() {
      const begin = performance.now();
      const owned = ownedProcesses(await processInventory(), child.pid).map((process) => ({
        pid: process.ProcessId,
        name: process.Name,
      }));
      for (const page of browser
        .contexts()
        .flatMap((context) => context.pages())
        .filter((page) => page !== main)) {
        await page
          .evaluate(() => window.__TAURI__.window.getCurrentWindow().close())
          .catch(() => {});
      }
      await main
        .evaluate(() => window.__TAURI__.window.getCurrentWindow().close())
        .catch((error) => {
          if (!error.message.includes('closed')) throw error;
        });
      let timer;
      const result = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Native normal close timed out')), 30000);
        }),
      ]).finally(() => clearTimeout(timer));
      await browser.close().catch(() => {});
      const ids = new Set(owned.map((process) => process.pid));
      let remaining;
      await until(async () => {
        remaining = (await processInventory()).filter((process) => ids.has(process.ProcessId));
        return remaining.length === 0;
      }, 30000);
      return { ...result, elapsedMs: performance.now() - begin, owned, remaining };
    },
  };
}
