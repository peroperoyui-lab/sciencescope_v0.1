import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCappedProxy, renameSnapshotSync } from '../scripts/evals/hybrid-live-retrieval.mjs';

test('snapshot replacement retries the same bytes for transient sharing errors only', async t => {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 't10-ledger-rename-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = path.join(root, 'requests.json'), snapshot = `${destination}.next`;
  await writeFile(destination, 'previous'); await writeFile(snapshot, 'reserved-request');
  let attempts = 0; const waits = [];
  renameSnapshotSync(snapshot, destination, {
    rename(from, to) {
      assert.equal(from, snapshot); assert.equal(to, destination);
      assert.equal(readFileSync(from, 'utf8'), 'reserved-request');
      assert.equal(readFileSync(to, 'utf8'), 'previous');
      const code = ['EPERM', 'EBUSY', 'EACCES'][attempts++];
      if (code) throw Object.assign(new Error('sharing conflict'), { code });
      renameSync(from, to);
    }, wait: milliseconds => waits.push(milliseconds),
  });
  assert.equal(attempts, 4); assert.deepEqual(waits, [100, 100, 100]);
  assert.equal(await readFile(destination, 'utf8'), 'reserved-request');
  await assert.rejects(readFile(snapshot), { code: 'ENOENT' });

  for (const [code, expectedAttempts, expectedWaits] of [['EPERM', 20, 19], ['ENOENT', 1, 0]]) {
    await writeFile(snapshot, 'failed-snapshot');
    const failure = Object.assign(new Error('rename failure'), { code });
    let calls = 0, delays = 0;
    assert.throws(() => renameSnapshotSync(snapshot, destination, {
      rename(from, to) { assert.equal(from, snapshot); assert.equal(to, destination); calls++; throw failure; },
      wait(milliseconds) { assert.equal(milliseconds, 100); delays++; },
    }), error => error === failure);
    assert.equal(calls, expectedAttempts); assert.equal(delays, expectedWaits);
    assert.equal(await readFile(snapshot, 'utf8'), 'failed-snapshot');
    assert.equal(await readFile(destination, 'utf8'), 'reserved-request');
  }
});

test('Windows read sharing denies atomic replacement until the independent reader releases it', { skip: process.platform !== 'win32' }, async t => {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 't10-ledger-windows-lock-'));
  const destination = path.join(root, 'requests.json'), snapshot = `${destination}.next`, release = path.join(root, 'release');
  await writeFile(destination, 'previous'); await writeFile(snapshot, 'reserved-request');
  const quote = value => `'${value.replace(/'/gu, "''")}'`;
  const script = `$reader = [System.IO.File]::Open(${quote(destination)}, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read); try { [Console]::WriteLine('locked'); $deadline = [DateTime]::UtcNow.AddSeconds(10); while (-not [System.IO.File]::Exists(${quote(release)}) -and [DateTime]::UtcNow -lt $deadline) { [System.Threading.Thread]::Sleep(20) } } finally { $reader.Dispose() }`;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child = spawn(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill(); await closed; await rm(root, { recursive: true, force: true }); });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  await new Promise((resolve, reject) => {
    let stdout = '';
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`reader exited before locking: ${stderr}`)));
    child.stdout.on('data', bytes => { stdout += bytes; if (stdout.includes('locked')) resolve(); });
  });
  let attempts = 0; const errors = [];
  renameSnapshotSync(snapshot, destination, { rename(from, to) {
    attempts++;
    try { renameSync(from, to); }
    catch (error) {
      errors.push(error.code);
      // The child can release while the parent is inside Atomics.wait.
      writeFileSync(release, 'release'); throw error;
    }
  } });
  assert.ok(attempts >= 2, 'the real locked-file failure precedes successful replacement');
  assert.ok(errors.every(code => ['EPERM', 'EBUSY', 'EACCES'].includes(code)), errors.join(','));
  t.diagnostic(`real Windows sharing lock: ${errors.join(',')}; rename attempts ${attempts}`);
  assert.equal(await readFile(destination, 'utf8'), 'reserved-request');
  assert.equal(await closed, 0, stderr);
});

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

test('long-output evaluations may choose a larger request deadline without changing historical ledgers',async t=>{
  const f=await fixture(t,(_count,_request,response)=>{
    response.writeHead(200,{'content-type':'text/event-stream'});
    response.write('data: {"choices":[{"delta":{"reasoning_content":"working"}}]}\n\n');
    setTimeout(()=>response.end('data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}\n\ndata: [DONE]\n\n'),90);
  },{requestTimeoutMs:500});
  assert.equal(await f.send(),200);
  assert.equal(f.proxy.state.requestTimeoutMs,500);
  assert.equal(f.proxy.state.events[0].status,200);
  assert.equal(f.proxy.state.events[0].usage.total_tokens,30);
  await f.proxy.close();
  const before=await readFile(f.evidencePath,'utf8');
  await assert.rejects(createCappedProxy({...f.options,requestTimeoutMs:120000}),/deadline cannot change/);
  assert.equal(await readFile(f.evidencePath,'utf8'),before);
  await assert.rejects(createCappedProxy({...f.options,evidencePath:path.join(path.dirname(f.evidencePath),'invalid.json'),requestTimeoutMs:0}),/positive integer/);
});
