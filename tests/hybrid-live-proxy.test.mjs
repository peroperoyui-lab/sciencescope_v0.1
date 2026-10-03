import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCappedProxy } from '../scripts/evals/hybrid-live-retrieval.mjs';

async function fixture(t, handler, limits = {}) {
  const tempRoot = path.resolve('.sciencescope-local/temp');
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(path.join(tempRoot, 't10-proxy-transport-'));
  const evidencePath = path.join(root, 'requests.json');
  let physical = 0;
  const upstream = createServer(async (request, response) => {
    for await (const chunk of request) { /* consume without retaining request content */ }
    handler(++physical, request, response);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const options = { evidencePath, maxCompletionRequests: 12, maxPerQuestion: 6,
    upstreamOrigin: `http://127.0.0.1:${upstream.address().port}`, allowTestLoopbackUpstream: true, ...limits };
  const proxy = await createCappedProxy(options);
  proxy.registerSession('session-q1', { questionId: 'q1', kind: 'main' });
  t.after(async () => { await proxy.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const send = async (step = 1, sessionId = 'session-q1') => {
    const response = await fetch(`http://127.0.0.1:${proxy.port}/zen/go/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-sciencescope-t10-session': sessionId },
      body: JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content: `private-question-${step}` }] }),
    });
    await response.text();
    return response.status;
  };
  return { proxy, send, options, evidencePath, physical: () => physical };
}

function success(response) { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"choices":[{"message":{"content":"fixture"}}]}'); }
function fail(response, status = 503) { response.writeHead(status, { 'content-type': 'application/json' }); response.end('{"error":{"code":"temporary_failure","type":"server_error","message":"private-provider-body-and-key"}}'); }

test('T10 two transient failures then success count one model step and two retries; seventh step is blocked', async t => {
  const f = await fixture(t, (count, _request, response) => count <= 2 ? fail(response) : success(response));
  assert.equal(await f.send(), 503); assert.equal(await f.send(), 503); assert.equal(await f.send(), 200);
  assert.equal(f.proxy.state.questions.q1.effectiveModelSteps, 1);
  assert.equal(f.proxy.state.questions.q1.forwardedCompletions, 3);
  assert.equal(f.proxy.state.questions.q1.retryAttempts, 2);
  for (let step = 2; step <= 6; step += 1) assert.equal(await f.send(step), 200);
  assert.equal(await f.send(7), 429);
  assert.equal(f.proxy.state.events.at(-1).blockReason, 'question-cap');
  assert.equal(f.physical(), 8);
  assert.equal(f.proxy.state.questions.q1.effectiveModelSteps, 6);
  const event = f.proxy.state.events[0];
  assert.equal(event.upstreamStatus, 503); assert.equal(event.upstreamErrorCode, 'temporary_failure'); assert.equal(event.upstreamErrorType, 'SERVER');
  const persisted = await readFile(f.evidencePath, 'utf8');
  for (const privateValue of ['private-provider-body-and-key', 'private-question-', 'authorization']) assert.equal(persisted.includes(privateValue), false);
});

test('T10 successful identical payloads and permanent auth failures consume new model steps', async t => {
  const f = await fixture(t, (count, _request, response) => count === 3 ? fail(response, 401) : success(response));
  assert.equal(await f.send(), 200); assert.equal(await f.send(), 200);
  assert.equal(await f.send(), 401); assert.equal(await f.send(), 200);
  assert.equal(f.proxy.state.questions.q1.effectiveModelSteps, 4);
  assert.equal(f.proxy.state.questions.q1.retryAttempts, 0);
  assert.equal(f.proxy.state.events[2].upstreamErrorType, 'AUTH');
  assert.equal(f.proxy.state.events[2].retryEligible, false);
});

test('T10 connection reset and stream cut are sanitized transport failures with bounded retries', async t => {
  const f = await fixture(t, (count, request, response) => {
    if (count === 1) { request.socket.destroy(); return; }
    if (count === 2) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"choices":[]}\n\n');
      setTimeout(() => response.destroy(), 10); return;
    }
    success(response);
  });
  assert.equal(await f.send(), 502);
  await assert.rejects(f.send());
  assert.equal(await f.send(), 200);
  assert.equal(f.proxy.state.forwardedCompletions, 3);
  assert.equal(f.proxy.state.effectiveModelSteps, 1);
  assert.equal(f.proxy.state.retryAttempts, 2);
  assert.equal(f.proxy.state.events[0].connectionErrorType, 'TRANSPORT');
  assert.equal(f.proxy.state.events[0].connectionErrorCode, 'ECONNRESET');
  assert.equal(f.proxy.state.events[1].upstreamAborted, true);
  assert.equal(f.proxy.state.events[1].upstreamStatus, 200);
});

test('T10 attribution and global model-step cap still prevent upstream traffic', async t => {
  const f = await fixture(t, (_count, _request, response) => success(response), { maxCompletionRequests: 1 });
  assert.equal(await f.send(1, 'session-unknown'), 429);
  assert.equal(await f.send(), 200);
  f.proxy.registerSession('session-q2', { questionId: 'q2', kind: 'main' });
  assert.equal(await f.send(1, 'session-q2'), 429);
  assert.equal(f.physical(), 1); assert.equal(f.proxy.state.blockedUnattributed, 1);
  assert.equal(f.proxy.state.events.at(-1).blockReason, 'global-cap');
});

test('T10 physical retry bound stops a sixth retry without converting it to a fresh model step', async t => {
  const f = await fixture(t, (_count, _request, response) => fail(response));
  for (let attempt = 0; attempt < 6; attempt += 1) assert.equal(await f.send(), 503);
  assert.equal(await f.send(), 429);
  assert.equal(f.proxy.state.events.at(-1).blockReason, 'retry-cap');
  assert.equal(f.proxy.state.forwardedCompletions, 6);
  assert.equal(f.proxy.state.effectiveModelSteps, 1);
  assert.equal(f.proxy.state.retryAttempts, 5);
});

test('T10 resumed schema 2 preserves retry chain and rejects historical accounting without mutation', async t => {
  const f = await fixture(t, (count, _request, response) => count === 1 ? fail(response) : success(response));
  assert.equal(await f.send(), 503);
  await f.proxy.close();
  const resumed = await createCappedProxy(f.options);
  try {
    const response = await fetch(`http://127.0.0.1:${resumed.port}/zen/go/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-sciencescope-t10-session': 'session-q1' },
      body: JSON.stringify({ model: 'fixture', messages: [{ role: 'user', content: 'private-question-1' }] }),
    });
    await response.text(); assert.equal(response.status, 200);
    assert.equal(resumed.state.effectiveModelSteps, 1); assert.equal(resumed.state.retryAttempts, 1);
  } finally { await resumed.close(); }
  const historical = JSON.stringify({ ...resumed.state, schema: 1 });
  await writeFile(f.evidencePath, historical);
  await assert.rejects(createCappedProxy(f.options), /fresh run/);
  assert.equal(await readFile(f.evidencePath, 'utf8'), historical);
});
