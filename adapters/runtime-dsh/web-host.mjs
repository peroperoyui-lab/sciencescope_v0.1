/**
 * Controlled launcher for the installed DeepSeek Harness web profile.
 *
 * This deliberately starts the public `dsh web` CLI rather than importing
 * profile internals.  The returned URL is the boundary used by the desktop
 * host for the upstream web application's HTTP API and UI.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

const DEFAULT_PORT = 0;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_MS = 100;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function reservePort(host) {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolveListen);
  });
  const address = server.address();
  const selected = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return selected;
}

async function waitForHttp(url, child, timeoutMs, pollMs, getOutput, headers = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`DSH web process exited before readiness (code ${child.exitCode}).`);
    }
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(Math.min(1_000, timeoutMs)) });
      if (response.status >= 200 && response.status < 300) return response.status;
    } catch (error) {
      lastError = error;
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for authenticated DSH web server at ${url}.${lastError ? ` ${lastError.message}` : ''}`);
}

async function waitForLaunchUrl(baseUrl, child, timeoutMs, pollMs, getOutput, getSpawnError) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getSpawnError()) throw new Error('DSH web process could not be started');
    if (child.exitCode !== null) throw new Error(`DSH web process exited before readiness (code ${child.exitCode}).`);
    const match = getOutput().match(/https?:\/\/127\.0\.0\.1:\d+\/?\?token=[A-Za-z0-9_-]+/u);
    if (match) return match[0];
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for DSH web authentication URL at ${baseUrl}.`);
}

async function killProcessTree(child, graceMs = 5_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  if (!pid) return;
  const exited = new Promise(resolveExit => child.once('exit',resolveExit));
  if (process.platform === 'win32') {
    // /T is required: DSH may create descendants for its worker/plugin tree.
    // Ignore taskkill's result; the exit event below is the authoritative wait.
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error',()=>child.kill());
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
  }
  await Promise.race([
    exited,
    sleep(graceMs),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    await Promise.race([exited,sleep(3_000).then(()=>{throw new Error('DSH process exit was not confirmed');})]);
  }
}

/**
 * Start the installed full DSH web profile.
 *
 * @param {{home: string, cwd?: string, port?: number, host?: string,
 *   nodePath?: string, dshBin?: string, timeoutMs?: number, env?: object}} options
 * @returns {Promise<{url: string, port: number, process: import('node:child_process').ChildProcess, close: (options?: {timeoutMs?: number}) => Promise<void>, request: typeof fetch}>}
 */
export async function createDshWebHost(options = {}) {
  if (!options.home) throw new TypeError('createDshWebHost requires home');
  const home = resolve(options.home);
  const cwd = resolve(options.cwd ?? home);
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new TypeError('DSH web host is restricted to 127.0.0.1');
  const requestedPort = options.port ?? DEFAULT_PORT;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new TypeError('port must be an integer from 0 to 65535');
  const port = requestedPort === 0 ? await reservePort(host) : requestedPort;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive integer');

  const localRoot = join(home, '.sciencescope-local');
  const localTemp = join(localRoot, 'temp');
  const localCache = join(localRoot, 'cache');
  await mkdir(localTemp, { recursive: true });
  await mkdir(localCache, { recursive: true });
  await mkdir(cwd, { recursive: true });

  const nodePath = options.nodePath ?? process.execPath;
  const dshBin = options.dshBin ?? fileURLToPath(new URL('../../node_modules/@deepseek-ai/dsh/lib/bin.js', import.meta.url));
  const child = spawn(nodePath, [dshBin, 'web', '--host', host, '--port', String(port), '--no-open'], {
    cwd,
    env: {
      ...process.env,
      DSH_HOME: home,
      TEMP: localTemp,
      TMP: localTemp,
      npm_config_cache: localCache,
      DSH_TELEMETRY_DISABLED: '1',
      ...(options.env ?? {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let output = '';
  const append = (chunk) => {
    output = `${output}${chunk}`.slice(-8_000);
  };
  child.stdout?.on('data', append);
  child.stderr?.resume();
  let spawnError;
  child.once('error', (error) => { spawnError = error; });
  const getOutput = () => output;
  const url = `http://${host}:${port}/`;
  try {
    const launchUrl = await waitForLaunchUrl(url, child, timeoutMs, DEFAULT_POLL_MS, getOutput, () => spawnError);
    const bootstrap = await fetch(launchUrl, { redirect: 'manual' });
    const cookie = bootstrap.headers.get('set-cookie')?.split(';', 1)[0];
    if (bootstrap.status !== 303 || !cookie) throw new Error('DSH web authentication bootstrap failed');
    await waitForHttp(url, child, timeoutMs, DEFAULT_POLL_MS, getOutput, { cookie });
    const call = async (namespace, method, args = {}, { signal } = {}) => {
      if (typeof namespace !== 'string' || !namespace || typeof method !== 'string' || !method) throw new TypeError('namespace and method are required');
      if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('args must be a plain object');
      const response = await fetch(`${url}api/${namespace}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: `${namespace}/${method}`, payload: { args } }),
        signal,
      });
      if (!response.ok) throw new Error(`DSH RPC transport failed: HTTP ${response.status}`);
      const envelope = await response.json();
      if (envelope?.type !== 'server-response' || typeof envelope.rpcId !== 'string' || !envelope.result) throw new Error('DSH RPC returned an invalid response envelope');
      if (envelope.result.ok === false) throw new Error(`DSH RPC ${namespace}/${method} failed: ${envelope.result.error?.message ?? 'remote error'}`);
      if (envelope.result.ok !== true) throw new Error('DSH RPC returned an invalid result');
      return envelope.result.value;
    };
    return finish({ url, port, child, call });
  } catch (error) {
    await killProcessTree(child, Math.min(2_000, timeoutMs));
    throw error;
  }

}

function finish({ url, port, child, call }) {
  let closed = false;
  const close = async ({ timeoutMs: closeTimeoutMs = 5_000 } = {}) => {
    if (closed) return;
    closed = true;
    await killProcessTree(child, closeTimeoutMs);
  };
  return {
    url,
    port,
    process: child,
    close,
    request: fetch,
    ...(call ? { call } : {}),
    capabilities: Object.freeze({ webProfile: true, loopbackOnly: true, providerSave: Boolean(call), providerDiscover: Boolean(call) }),
  };
}

export default { createDshWebHost };
