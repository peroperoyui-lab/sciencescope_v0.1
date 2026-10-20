import { AppError } from '../../core/errors.js';
import { createMcpConfig, parseMcpImport } from './config.js';
import { openConnection } from './connection.js';

/**
 * Discovery is asynchronous without delaying the window. Each turn awaits the
 * initial catalog and configuration changes before taking its tool snapshot.
 * @param {import('../../core/index.js').Core} core
 */
export function createMcp(core) {
  const config = createMcpConfig(core);
  const entries = new Map();
  let closed = false;
  let queue = /** @type {Promise<unknown>} */ (Promise.resolve());
  /**
   * @template T
   * @param {()=>Promise<T>} action
   * @returns {Promise<T>}
   */
  function serialize(action) {
    const operation = queue.then(action);
    queue = operation.catch(() => {});
    return operation;
  }
  async function connect(entry) {
    await entry.connection?.close();
    entry.connection = null;
    if (!entry.server.enabled) {
      entry.state = { status: 'disabled', toolCount: 0 };
      entry.tools = [];
      return;
    }
    try {
      entry.connection = await openConnection(
        await config.resolve(entry.server),
        await config.settings(),
        core.paths.root,
      );
      entry.tools = entry.connection.tools;
      entry.state = { status: 'connected', toolCount: entry.tools.length };
    } catch (error) {
      entry.state = { status: 'failed', toolCount: 0, error: error.message };
    }
  }
  async function sync() {
    if (closed) return;
    const servers = await config.list();
    for (const [id, entry] of entries)
      if (!servers.some((server) => server.id === id)) {
        await entry.connection?.close();
        entries.delete(id);
      }
    await Promise.all(
      servers.map(async (server) => {
        const old = entries.get(server.id);
        if (old && JSON.stringify(old.server) === JSON.stringify(server)) return;
        await old?.connection?.close();
        const entry = {
          server,
          connection: null,
          tools: [],
          state: { status: 'disabled', toolCount: 0 },
        };
        entries.set(server.id, entry);
        await connect(entry);
      }),
    );
  }
  const ready = () => serialize(sync);
  // A failed server is a state, not a rejected application startup.
  void ready();
  function row(entry) {
    const state =
      entry.state.status === 'connected' && !entry.connection?.connected
        ? {
            status: 'failed',
            toolCount: entry.tools.length,
            error: '连接已断开，下次调用时将重新连接。',
          }
        : entry.state;
    return { ...entry.server, ...state };
  }
  function catalog() {
    return [...entries.values()].flatMap((entry) =>
      entry.server.enabled
        ? entry.tools.map((tool) => ({
            // Model APIs accept only [A-Za-z0-9_-]{1,64}; calls map back through `tool`.
            name: `mcp__${entry.server.id}__${tool.name}`.replace(/[^\w-]/gu, '_').slice(0, 64),
            description: tool.description ?? tool.name,
            parameters: {},
            inputSchema: tool.inputSchema,
            source: 'mcp',
            server: entry.server.id,
            serverName: entry.server.name,
            tool: tool.name,
            enabled: !entry.server.disabledTools.includes(tool.name),
            needsApproval: true,
          }))
        : [],
    );
  }
  async function list() {
    await ready();
    return [...entries.values()].map(row);
  }
  async function save(input, id) {
    return serialize(async () => {
      if (closed) throw new AppError('MCP_CLOSED', 'MCP 服务已关闭。', 409);
      if (id && !(await config.list()).some((server) => server.id === id))
        throw new AppError('MCP_NOT_FOUND', '找不到这个 MCP 服务器。', 404);
      const server = await config.save(input, id);
      // A replacement secret keeps the same keyRef, so equality of the public
      // configuration alone cannot detect a changed credential.
      const previous = entries.get(server.id);
      await previous?.connection?.close();
      entries.delete(server.id);
      await sync();
      return row(entries.get(server.id));
    });
  }
  async function reconnect(id) {
    return serialize(async () => {
      await sync();
      const entry = entries.get(id);
      if (!entry) throw new AppError('MCP_NOT_FOUND', '找不到这个 MCP 服务器。', 404);
      await connect(entry);
      return row(entry);
    });
  }
  async function call(name, args, signal) {
    await ready();
    signal?.throwIfAborted();
    const spec = catalog().find((item) => item.name === name && item.enabled);
    if (!spec) throw new AppError('MCP_TOOL_UNAVAILABLE', '这个 MCP 工具已停用或不可用。');
    let entry = entries.get(spec.server);
    // Reconnect before sending only. Never replay an ambiguous tool execution.
    if (!entry.connection?.connected) {
      await reconnect(spec.server);
      entry = entries.get(spec.server);
    }
    if (!entry.connection?.connected) throw new Error(entry.state.error);
    const result = await entry.connection.call(spec.tool, args ?? {}, signal);
    const text = [];
    const images = [];
    for (const item of result.content ?? []) {
      if (item.type === 'text') text.push(item.text);
      else if (item.type === 'image') images.push({ data: item.data, mimeType: item.mimeType });
      else text.push(JSON.stringify(item));
    }
    if (result.structuredContent) text.push(JSON.stringify(result.structuredContent));
    return {
      text: text.join('\n'),
      ...(images.length ? { images } : {}),
      ...(result.isError ? { isError: true } : {}),
    };
  }
  return {
    ready,
    list,
    save,
    reconnect,
    call,
    catalog,
    async import(input) {
      const result = /** @type {any[]} */ ([]);
      for (const server of parseMcpImport(input)) result.push(await save(server, undefined));
      return result;
    },
    async remove(id) {
      return serialize(async () => {
        await config.remove(id);
        await sync();
        return { deleted: true };
      });
    },
    async close() {
      closed = true;
      await queue;
      await Promise.all([...entries.values()].map((entry) => entry.connection?.close()));
      entries.clear();
    },
  };
}
