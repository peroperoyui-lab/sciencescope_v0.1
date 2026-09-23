import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';

test('persona changes use DSH system prompt updates and retain session history', async () => {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'role-prompt-runtime-'));
  const requests = [];
  const fixture = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"ROLE_OK"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const host = await createDshHost({ home: root, cwd: root, sessionHeaders: ['x-fixture'], env: { SCIENCESCOPE_OFFLINE_KEY: 'fixture' } });
  try {
    const sessionId = await host.startSession({
      model: { providerId: 'fixture', modelId: 'fixture' }, workspace: root,
      persona: 'Initial research persona.',
      runtimeConfig: { providers: { fixture: { api: 'openai-completions', baseURL: `http://127.0.0.1:${fixture.address().port}/v1`, apiKeyEnv: 'SCIENCESCOPE_OFFLINE_KEY', models: [{ id: 'fixture', contextWindow: 32768, maxTokens: 256 }] } } },
    });
    await host.send({ sessionId, text: 'Prior user sentinel.' });
    await host.configurePersona({ sessionId, persona: 'Updated reviewer persona.' });
    await host.send({ sessionId, text: 'Current user sentinel.' });
    assert.equal(requests.length, 2);
    assert.match(JSON.stringify(requests[0].messages), /Initial research persona/);
    assert.match(JSON.stringify(requests[1].messages), /Updated reviewer persona/);
    assert.doesNotMatch(JSON.stringify(requests[1].messages), /Initial research persona/);
    assert.match(JSON.stringify(requests[1].messages), /Prior user sentinel/);
  } finally {
    await host.close();
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('persona update rejects a running session without changing the old persona', async () => {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'role-prompt-idle-'));
  const requests = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fixture = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    requests.push(JSON.parse(body));
    if (requests.length === 1) await gate;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"ROLE_OK"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const host = await createDshHost({ home: root, cwd: root, sessionHeaders: ['x-fixture'], env: { SCIENCESCOPE_OFFLINE_KEY: 'fixture' } });
  try {
    const sessionId = await host.startSession({
      model: { providerId: 'fixture', modelId: 'fixture' }, workspace: root,
      persona: 'Stable persona.',
      runtimeConfig: { providers: { fixture: { api: 'openai-completions', baseURL: `http://127.0.0.1:${fixture.address().port}/v1`, apiKeyEnv: 'SCIENCESCOPE_OFFLINE_KEY', models: [{ id: 'fixture', contextWindow: 32768, maxTokens: 256 }] } } },
    });
    const first = host.send({ sessionId, text: 'Running user sentinel.' });
    while (requests.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(host.configurePersona({ sessionId, persona: 'Rejected persona.' }), /idle/);
    release();
    await first;
    await host.send({ sessionId, text: 'After user sentinel.' });
    assert.equal(requests.length, 2);
    assert.match(JSON.stringify(requests[1].messages), /Stable persona/);
    assert.doesNotMatch(JSON.stringify(requests[1].messages), /Rejected persona/);
  } finally {
    release();
    await host.close();
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
