import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createApp } from '../../app.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { agentTools } from '../../runtime/pi/tools.js';
import { tempDir, withCore } from '../../testing.js';
import { readCredentials } from '../providers.js';
import { createMcp } from './index.js';
import { commandOptions } from './connection.js';

const fixture = `
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
const child = spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
const server = new Server({name:'fixture',version:'1'}, {capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:['first','second'].map(name=>({name,description:name,inputSchema:{type:'object',properties:{question:{type:'string'}},required:['question']}}))}));
server.setRequestHandler(CallToolRequestSchema,async(req)=>{
if(req.params.arguments.question==='disconnect') setTimeout(()=>{child.kill();process.exit(0);},30);
return {content:[{type:'text',text:JSON.stringify({name:req.params.name,question:req.params.arguments.question,pid:process.pid,child:child.pid,credential:process.env.TEST_TOKEN})}]};
});
process.on('exit',()=>child.kill());
await server.connect(new StdioServerTransport());
`;

test('legacy SSE uses the same stored HTTP headers and tool contract', async () =>
  withCore('mcp-sse', async (core) => {
    const server = new Server(
      { name: 'sse-fixture', version: '1' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{ type: 'text', text: 'SSE response' }],
    }));
    let transport;
    const http = createServer(async (request, response) => {
      if (request.headers.authorization !== 'fixture-header') {
        response.writeHead(401).end();
        return;
      }
      if (request.method === 'GET' && request.url === '/sse') {
        assert.equal(request.headers.accept, 'text/event-stream');
        transport = new SSEServerTransport('/messages', response);
        await server.connect(transport);
      } else if (request.method === 'POST' && request.url.startsWith('/messages')) {
        await transport.handlePostMessage(request, response);
      } else response.writeHead(405).end();
    });
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const mcp = createMcp(core);
    try {
      const port = /** @type {import('node:net').AddressInfo} */ (http.address()).port;
      const [entry] = await mcp.import({
        name: 'SSE',
        url: `http://127.0.0.1:${port}/sse`,
        headers: { Authorization: 'fixture-header' },
      });
      assert.equal(entry.status, 'connected', entry.error);
      assert.equal((await mcp.call(mcp.catalog()[0].name, {})).text, 'SSE response');
    } finally {
      await mcp.close();
      await server.close();
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
    }
  }));

test(
  'MCP import, model calls, project server approval, disable, reconnect and process cleanup',
  { timeout: 45000 },
  async () => {
    const temporary = await tempDir('mcp');
    const file = path.join(temporary.dir, '服务器.mjs');
    await writeFile(file, fixture);
    const results = [];
    let server;
    const runtime = createScriptedRuntime({
      script: async function* ({ call }) {
        results.push(await call(`mcp__${server.id}__first`, { question: '一' }));
        results.push(await call(`mcp__${server.id}__second`, { question: '二' }));
        yield '工具已回答';
      },
    });
    const app = await createApp({
      dataRoot: path.join(temporary.dir, 'data'),
      token: 'test',
      runtime,
    });
    const base = await app.listen();
    const pids = [];
    const request = async (method, route, body) => {
      const response = await fetch(base + route, {
        method,
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const value = await response.json();
      assert.equal(response.status, 200, JSON.stringify(value));
      return value;
    };
    try {
      await request('PATCH', '/api/settings', {
        models: { default: { provider: 'test', model: 'test' } },
        python: { defaultEnvironment: 'system' },
        memory: { enabled: false },
      });
      [server] = await request('POST', '/api/mcp/import', {
        config: JSON.stringify({
          mcpServers: {
            测试服务器: { command: 'node', args: [file], env: { TEST_TOKEN: 'fixture-value' } },
          },
        }),
      });
      assert.equal(server.status, 'connected');
      assert.equal(server.toolCount, 2);
      assert.equal(typeof server.env.TEST_TOKEN.keyRef, 'string');
      assert.equal(
        (await readCredentials(app.core.paths)).refs[server.env.TEST_TOKEN.keyRef],
        'fixture-value',
      );
      assert.doesNotMatch(await readFile(app.core.paths.settings, 'utf8'), /fixture-value/);
      const project = await request('POST', '/api/projects', { name: 'MCP project' });
      const meeting = await request('POST', '/api/meetings', {
        projectId: project.id,
        members: [{ participantId: 'agent_main' }],
      });
      let approvals = 0;
      const approval = new Promise((resolve) => {
        const unsubscribe = app.core.events.subscribe((event) => {
          if (event.type !== 'turn.phase' || event.payload.phase !== 'waiting-approval') return;
          approvals++;
          unsubscribe();
          resolve(
            app.core.turns.toolCalls(event.payload.id).findLast((row) => row.kind === 'approval'),
          );
        });
      });
      await request('POST', `/api/meetings/${meeting.id}/messages`, { text: '使用两个工具' });
      const row = await approval;
      assert.match(row.args.summary, /测试服务器 · first/);
      assert.equal(row.args.scopes[0].kind, 'server');
      await request('POST', `/api/turns/${row.turnId}/approvals/${row.id}`, {
        decision: 'always',
        scope: row.args.scopes[0],
      });
      await app.conductor.idle();
      assert.equal(app.core.messages.since(meeting.id, 0).at(-1).text, '工具已回答');
      assert.equal(approvals, 1);
      assert.equal(results.length, 2);
      for (const result of results) {
        const content = JSON.parse(result.text);
        assert.equal(content.credential, 'fixture-value');
        pids.push(content.pid, content.child);
      }
      assert.ok(
        app.core.turns.toolCalls(row.turnId).find((call) => call.name.endsWith('__second')).result
          .approvedBy,
      );
      // A second meeting in this project reuses the server rule, including another tool.
      const another = await request('POST', '/api/meetings', {
        projectId: project.id,
        members: [{ participantId: 'agent_main' }],
      });
      await request('POST', `/api/meetings/${another.id}/messages`, { text: '再次调用' });
      await app.conductor.idle();
      assert.equal(results.length, 4);
      await request('PATCH', `/api/mcp/servers/${server.id}`, { disabledTools: ['second'] });
      const catalog = await request('GET', '/api/tools');
      assert.equal(
        catalog.find((item) => item.name === `mcp__${server.id}__second`).enabled,
        false,
      );
      assert.equal(catalog.find((item) => item.name === `mcp__${server.id}__first`).source, 'mcp');
      const active = JSON.parse(
        (await app.mcp.call(`mcp__${server.id}__first`, { question: 'restart' })).text,
      );
      pids.push(active.pid, active.child);
      await app.mcp.call(`mcp__${server.id}__first`, { question: 'disconnect' });
      const deadline = Date.now() + 5000;
      while ((await app.mcp.list()).find((item) => item.id === server.id).status === 'connected') {
        assert.ok(Date.now() < deadline, 'Fixture did not disconnect');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const reconnected = JSON.parse(
        (await app.mcp.call(`mcp__${server.id}__first`, { question: 'after' })).text,
      );
      assert.notEqual(reconnected.pid, active.pid);
      pids.push(reconnected.pid, reconnected.child);
      await request('PATCH', `/api/mcp/servers/${server.id}`, { enabled: false });
      for (const pid of new Set(pids)) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      assert.equal(
        (await request('GET', '/api/tools')).some((item) => item.server === server.id),
        false,
      );
      const failed = await request('POST', '/api/mcp/servers', {
        name: '不存在',
        transport: 'stdio',
        command: 'sciencescope-no-such-command',
      });
      assert.equal(failed.status, 'failed');
      assert.match(failed.error, /找不到命令/);
      await request('DELETE', `/api/mcp/servers/${failed.id}`);
      await request('PATCH', `/api/mcp/servers/${server.id}`, { enabled: true });
      const finalProcess = JSON.parse(
        (await app.mcp.call(`mcp__${server.id}__first`, { question: 'shutdown' })).text,
      );
      pids.push(finalProcess.pid, finalProcess.child);
      await app.mcp.close();
      for (const pid of new Set(pids)) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    } finally {
      await app.close();
      // Failure cleanup is separate from the assertions above proving shutdown.
      for (const pid of new Set(pids)) {
        try {
          process.kill(pid, 0);
          process.kill(pid);
        } catch (error) {
          assert.equal(error.code, 'ESRCH');
        }
      }
      await temporary.cleanup();
    }
  },
);

test('MCP HTTP forwards full JSON Schema and image results; bundled launchers use mirror settings', async () =>
  withCore('mcp-http', async (core) => {
    const schema = {
      type: 'object',
      properties: { choice: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
      required: ['choice'],
      additionalProperties: false,
    };
    const connections = [];
    const http = createServer(async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405).end();
        return;
      }
      const server = new Server(
        { name: 'http-fixture', version: '1' },
        { capabilities: { tools: {} } },
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{ name: 'picture', description: 'Read picture', inputSchema: schema }],
      }));
      server.setRequestHandler(CallToolRequestSchema, async () => ({
        content: [
          { type: 'text', text: 'picture' },
          { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
        ],
      }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      connections.push(server);
      await server.connect(transport);
      await transport.handleRequest(request, response);
    });
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const mcp = createMcp(core);
    try {
      const port = /** @type {import('node:net').AddressInfo} */ (http.address()).port;
      const [entry] = await mcp.import({
        name: 'HTTP',
        url: `http://127.0.0.1:${port}/mcp`,
        headers: { Authorization: 'fixture-header' },
      });
      assert.equal(entry.status, 'connected');
      const spec = mcp.catalog()[0];
      assert.deepEqual(agentTools([spec], async () => null)[0].parameters, schema);
      assert.deepEqual(await mcp.call(spec.name, { choice: 1 }), {
        text: 'picture',
        images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }],
      });
      const settings = {
        mcp: { npmRegistry: 'https://registry.npmmirror.com' },
        python: { indexUrl: 'https://mirrors.aliyun.com/pypi/simple/' },
      };
      const npx = await commandOptions(
        { command: 'npx', args: ['-y', 'example'] },
        settings,
        core.paths.root,
      );
      assert.equal(npx.command, process.execPath);
      assert.match(npx.args[0], /npx-cli\.js$/);
      assert.equal(npx.env.npm_config_registry, settings.mcp.npmRegistry);
      const uvx = await commandOptions(
        { command: 'uvx', args: ['mcp-server-time'] },
        settings,
        core.paths.root,
      );
      assert.deepEqual(uvx.args, ['tool', 'run', 'mcp-server-time']);
      assert.equal(uvx.env.UV_INDEX_URL, settings.python.indexUrl);
    } finally {
      await mcp.close();
      await Promise.all(connections.map((server) => server.close()));
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
    }
  }));
