import { randomUUID } from 'node:crypto';
import { AppError } from '../../core/errors.js';
import { readCredentials, saveKeys } from '../providers.js';

/**
 * Configuration contains references only. The transport resolves them just
 * before connecting; neither API responses nor model tools receive secrets.
 * @param {import('../../core/index.js').Core} core
 */
export function createMcpConfig(core) {
  const settings = async () =>
    (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
  async function list() {
    return (await settings()).mcp.servers;
  }
  async function save(input, id = `s_${randomUUID().replaceAll('-', '')}`) {
    const current = (await list()).find((entry) => entry.id === id);
    const server = {
      name: id,
      enabled: true,
      disabledTools: [],
      ...current,
      ...input,
      id,
    };
    if (!['stdio', 'http'].includes(server.transport))
      throw new AppError('MCP_CONFIG', '请选择本地命令或服务器网址。');
    if (server.transport === 'stdio' && !server.command?.trim())
      throw new AppError('MCP_CONFIG', '请填写启动命令。');
    if (server.transport === 'http') {
      try {
        const url = new URL(server.url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        throw new AppError('MCP_CONFIG', '请填写有效的 HTTP 或 HTTPS 网址。');
      }
    }
    const secrets = /** @type {Record<string,string>} */ ({});
    for (const field of ['env', 'headers']) {
      server[field] = Object.fromEntries(
        Object.entries(server[field] ?? {}).map(([name, value]) => {
          if (typeof value === 'object' && value?.keyRef) return [name, value];
          const keyRef = `mcp.${id}.${field}.${name}`;
          secrets[keyRef] = String(value);
          return [name, { keyRef }];
        }),
      );
    }
    await saveKeys(core.paths, secrets);
    await core.workspace.edit(
      { resource: 'settings', key: 'app', op: 'put-mcp-server', args: { server } },
      { actorId: 'person_user' },
    );
    return server;
  }
  async function remove(id) {
    await core.workspace.edit(
      { resource: 'settings', key: 'app', op: 'remove-mcp-server', args: { id } },
      { actorId: 'person_user' },
    );
  }
  async function resolve(server) {
    const { refs = {} } = await readCredentials(core.paths);
    const result = { ...server };
    for (const field of ['env', 'headers'])
      result[field] = Object.fromEntries(
        Object.entries(server[field] ?? {}).map(([name, reference]) => {
          const value = refs[reference.keyRef];
          if (value == null)
            throw new AppError('MCP_CREDENTIAL', `请重新填写 ${server.name} 的 ${name}。`);
          return [name, value];
        }),
      );
    return result;
  }
  return { settings, list, save, remove, resolve };
}

/**
 * Accept both a complete desktop configuration and a single server object.
 * @param {string | any} input
 * @returns {any[]}
 */
export function parseMcpImport(input) {
  let value;
  try {
    value = typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    throw new AppError('MCP_IMPORT', '粘贴的内容不是有效的 JSON。');
  }
  const entries =
    value?.mcpServers ?? (value?.command || value?.url ? { [value.name ?? 'MCP']: value } : value);
  if (!entries || typeof entries !== 'object' || Array.isArray(entries))
    throw new AppError('MCP_IMPORT', '没有找到 MCP 服务器配置。');
  return Object.entries(entries).map(([name, entry]) => ({
    ...entry,
    name,
    transport: entry.url ? 'http' : 'stdio',
  }));
}
