import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { tempDir } from '../../testing.js';
import { dataPaths } from '../../core/paths.js';
import { saveKey } from '../../services/providers.js';
import { createModelCatalog } from './catalog.js';
import { createPiRuntime } from './runtime.js';

async function withStream(work, limits) {
  const { dir, cleanup } = await tempDir('pi-http');
  let connectionClosed;
  const closed = new Promise((resolve) => {
    connectionClosed = resolve;
  });
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(
      `data: ${JSON.stringify({ id: 'chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '保留这句话' }, finish_reason: null }] })}\n\n`,
    );
    response.on('close', connectionClosed);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const paths = dataPaths(dir);
  await saveKey(paths, 'test', 'fixture');
  const providers = async () => [
    {
      id: 'test',
      name: 'Local test',
      keyRef: 'test',
      api: 'openai-completions',
      baseUrl: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/v1`,
      models: [{ id: 'test' }],
    },
  ];
  const catalog = createModelCatalog({ paths, providers });
  const runtime = createPiRuntime({
    home: paths.runtime,
    logs: path.join(dir, 'logs'),
    catalog,
    limits,
  });
  try {
    const id = await runtime.startSession({
      model: { provider: 'test', model: 'test' },
      workFolder: dir,
      instructions: 'Test',
      tools: [],
      onToolCall: async () => null,
    });
    await work({ runtime, id, closed });
  } finally {
    await runtime.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await cleanup();
  }
}

test('interrupt closes a real OpenAI-compatible SSE connection and preserves streamed text', async () => {
  await withStream(async ({ runtime, id, closed }) => {
    let received;
    const visible = new Promise((resolve) => {
      received = resolve;
    });
    let text = '';
    const answer = runtime.send(id, 'Hello', (event) => {
      if (event.type === 'text-delta') {
        text += event.delta;
        received();
      }
    });
    await visible;
    const stoppedAt = performance.now();
    await runtime.interrupt(id);
    assert.equal((await answer).stopReason, 'cancelled');
    await closed;
    assert.ok(performance.now() - stoppedAt < 2000);
    assert.equal(text, '保留这句话');
  });
});

test('an idle stream fails visibly with partial content and never automatically retries', async () => {
  await withStream(
    async ({ runtime, id, closed }) => {
      const events = [];
      const result = await runtime.send(id, 'Hello', (event) => events.push(event));
      await closed;
      assert.equal(result.stopReason, 'failed');
      assert.match(result.error, /没有返回新内容/);
      assert.equal(events.filter((event) => event.type === 'retry').length, 0);
      assert.equal(
        events
          .filter((event) => event.type === 'text-delta')
          .map((event) => event.delta)
          .join(''),
        '保留这句话',
      );
      assert.equal(result.usage.requests, 1);
    },
    { firstEventMs: 10000, idleEventMs: 40 },
  );
});
