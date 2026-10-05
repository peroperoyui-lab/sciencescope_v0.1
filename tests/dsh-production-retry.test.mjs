import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';
import { createDesktopApi } from '../scripts/desktop-api.mjs';

// Production desktop API -> real SDK profile -> upstream retry plugin. No
// retry override is installed; the provider's normal default policy applies.
test('production DSH retries two temporary failures within one answer without a user error', { timeout: 90000 }, async () => {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'dsh-production-retry-'));
  const requests = [], runtimeEvents = [], apiErrors = [];
  let api, apiServer, host;
  const fixture = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    if (requests.length <= 2) {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'fixture temporary server failure', type: 'server_error' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: {"choices":[{"delta":{"content":"RETRY_RECOVERED"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const runtimeConfig = { providers: { fixture: {
    api: 'openai-completions', baseURL: `http://127.0.0.1:${fixture.address().port}/v1`,
    apiKeyEnv: 'SCIENCESCOPE_OFFLINE_KEY', models: [{ id: 'fixture', contextWindow: 32768, maxTokens: 256 }],
  } } };
  try {
    host = await createDshHost({ home: path.join(root, '.sciencescope-local/dsh'), cwd: root,
      sessionHeaders: ['x-fixture-session'], env: { SCIENCESCOPE_OFFLINE_KEY: 'local-only' } });
    host.getRuntimeConfig = async () => runtimeConfig;
    const send = host.send.bind(host);
    host.send = input => send({ ...input, onEvent: event => { runtimeEvents.push(event); input.onEvent?.(event); } });
    api = await createDesktopApi({ dataRoot: root, runtimeHost: host, onError: error => apiErrors.push(error.message) });
    apiServer = createServer((request, response) => { void api.handle(request, response); });
    await new Promise(resolve => apiServer.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${apiServer.address().port}`;
    const reply = await fetch(origin + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: 'retry-production-chat', projectId: null, model: { providerId: 'fixture', modelId: 'fixture' },
        text: 'Reply briefly.', executionMode: 'ask', workspaceChoice: { mode: 'new' },
        userMessageId: 'retry-user', assistantMessageId: 'retry-answer',
        researchInput: { attachmentIds: [], messageQuotes: [], annotations: [], contextRefs: [] } }),
      signal: AbortSignal.timeout(60000),
    });
    const responseBody = await reply.text();
    assert.equal(reply.status, 200, responseBody);
    const events = responseBody.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(requests.length, 3, 'two failed requests and one successful retry');
    assert.deepEqual(requests[1], requests[0], 'retry preserves the model step');
    assert.deepEqual(requests[2], requests[0], 'second retry preserves the model step');
    assert.equal(runtimeEvents.filter(event => event.type === 'accepted').length, 1, 'one DSH user invocation');
    assert.deepEqual(events.filter(event => ['completed', 'failed', 'cancelled', 'error'].includes(event.type)).map(event => event.type), ['completed']);
    assert.equal(events.find(event => event.type === 'completed').text, 'RETRY_RECOVERED');
    assert.equal(runtimeEvents.filter(event => event.type === 'completed').length, 1);
    assert.deepEqual(apiErrors, []);
    const saved = await fetch(origin + '/api/chats/retry-production-chat/messages').then(response => response.json());
    assert.equal(saved.messages.filter(message => message.role === 'assistant').length, 1);
    assert.equal(saved.messages.find(message => message.role === 'assistant').text, 'RETRY_RECOVERED');
  } finally {
    if (api) await api.close(); else await host?.close();
    if (apiServer) { apiServer.closeAllConnections(); await new Promise(resolve => apiServer.close(resolve)); }
    fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
