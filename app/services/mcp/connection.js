// Uses the official MCP TypeScript SDK (MIT), including its documented
// Streamable HTTP -> legacy SSE compatibility path. No protocol implementation
// is copied. Windows closes the owned process tree before losing its root PID.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const require = createRequire(import.meta.url);
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Resolve package launchers using the application's Node/uv, not a global install.
 * @param {any} server
 * @param {any} settings
 * @param {string} dataRoot
 */
export async function commandOptions(server, settings, dataRoot) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const packagedUv = path.join(root, 'runtime', `uv${suffix}`);
  const uv =
    process.env.SCIENCESCOPE_UV ??
    (existsSync(packagedUv)
      ? packagedUv
      : path.join(root, '.sciencescope-local/runtimes/uv', `uv${suffix}`));
  const env = { ...getDefaultEnvironment(), ...server.env };
  const inheritedPath =
    Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
  env.PATH = [path.dirname(process.execPath), path.dirname(uv), inheritedPath].join(path.delimiter);
  const cache = path.join(dataRoot, 'mcp');
  await mkdir(cache, { recursive: true });
  env.npm_config_cache = path.join(cache, 'npm-cache');
  env.npm_config_registry = settings.mcp.npmRegistry ?? 'https://registry.npmjs.org';
  env.UV_CACHE_DIR = path.join(cache, 'uv-cache');
  env.UV_INDEX_URL = settings.python.indexUrl ?? 'https://pypi.org/simple';
  if (settings.python.installMirror) env.UV_PYTHON_INSTALL_MIRROR = settings.python.installMirror;
  let command = server.command;
  let args = server.args ?? [];
  const basename = path
    .basename(command)
    .replace(/\.(cmd|exe)$/iu, '')
    .toLowerCase();
  if (basename === 'npx' || basename === 'npm') {
    args = [
      path.join(path.dirname(require.resolve('npm/package.json')), 'bin', `${basename}-cli.js`),
      ...args,
    ];
    command = process.execPath;
  } else if (basename === 'uvx') {
    command = uv;
    args = ['tool', 'run', ...args];
  } else if (basename === 'uv') command = uv;
  else if (basename === 'node') command = process.execPath;
  return { command, args, env, cwd: cache, stderr: /** @type {const} */ ('pipe') };
}

/**
 * @param {any} server Resolved credentials; kept inside this transport closure.
 * @param {any} settings
 * @param {string} dataRoot
 * @returns {Promise<any>}
 */
export async function openConnection(server, settings, dataRoot) {
  let client = new Client({ name: 'ScienceScope', version: '1.0.0-alpha.0' }, { capabilities: {} });
  let transport;
  let connected = false;
  let connectionError;
  const safeError = (error) => {
    let message =
      error.code === 'ENOENT'
        ? `启动失败：找不到命令 ${server.command}`
        : String(error.message ?? error);
    for (const value of [
      ...Object.values(server.env ?? {}),
      ...Object.values(server.headers ?? {}),
    ])
      if (typeof value === 'string' && value) message = message.replaceAll(value, '[credential]');
    return message;
  };
  async function close() {
    connected = false;
    const pid = transport instanceof StdioClientTransport ? transport.pid : null;
    if (pid && process.platform === 'win32')
      await execute(
        path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/taskkill.exe'),
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true },
      ).catch((error) => {
        if (!error.code || error.code === 'ENOENT') throw error;
      });
    await client?.close();
  }
  async function connect(next) {
    transport = next;
    if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => {});
    client = new Client({ name: 'ScienceScope', version: '1.0.0-alpha.0' }, { capabilities: {} });
    client.onclose = () => {
      connected = false;
    };
    client.onerror = (error) => {
      connectionError ??= error;
    };
    await client.connect(transport, { timeout: 60000 });
    connected = true;
  }
  try {
    if (server.transport === 'stdio') {
      await connect(new StdioClientTransport(await commandOptions(server, settings, dataRoot)));
    } else {
      const options = { requestInit: { headers: server.headers } };
      try {
        await connect(new StreamableHTTPClientTransport(new URL(server.url), options));
      } catch (error) {
        await close();
        if (![400, 404, 405].includes(error.code)) throw error;
        await connect(new SSEClientTransport(new URL(server.url), options));
      }
    }
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return {
      tools,
      get connected() {
        return connected;
      },
      get pid() {
        return transport instanceof StdioClientTransport ? transport.pid : null;
      },
      close,
      async call(name, args, signal) {
        try {
          return await client.callTool({ name, arguments: args }, undefined, {
            signal,
            resetTimeoutOnProgress: true,
          });
        } catch (error) {
          throw new Error(safeError(error));
        }
      },
    };
  } catch (error) {
    await close();
    throw new Error(safeError(connectionError ?? error));
  }
}
