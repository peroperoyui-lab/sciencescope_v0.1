import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';
import { createDesktopApi } from '../scripts/desktop-api.mjs';
import { openApplicationDatabaseSync } from '../scripts/application-database.mjs';
import { createResearchBase } from '../scripts/research-base/index.mjs';
import { createCappedProxy, createLiveHost, eligibleUnpaidQuestions, parseArgs, requestReceipt, resultMetrics, selectQuestions, shouldStopBatch, validateUpstreamProxy } from '../scripts/evals/hybrid-live-retrieval.mjs';

const projectId = 't10-runtime-project';
const model = { providerId: 't10-retrieval-counted', modelId: 'deepseek-v4.1-flash' };

function sendEvent(response, value) { response.write(`data: ${JSON.stringify(value)}\n\n`); }
function done(response) { response.end('data: [DONE]\n\n'); }

test('T10 single-pass selection preserves frozen order and never retries a failed or interrupted paid question', () => {
  const questions = ['q1', 'q2', 'q3'].map(id => ({ id }));
  const args = parseArgs(['--authorized-live', '--single-pass', '--run-name', 'new-run', '--questions', 'q3,q1']);
  assert.equal(args.continueAfterQuestionFailure, true);
  const selected = selectQuestions(questions, args.questionIds);
  assert.deepEqual(selected.map(row => row.id), ['q1', 'q3']);
  assert.throws(() => selectQuestions(questions, ['q1', 'q1']), /unique/u);
  assert.throws(() => selectQuestions(questions, ['unapproved']), /unapproved/u);
  assert.throws(() => parseArgs(['--single-pass']), /authorized-live/u);
  assert.throws(() => parseArgs(['--authorized-live', '--single-pass', '--pilot']), /exactly one/u);
  for (const status of ['FAILED', 'RUNNING', 'INTERRUPTED_NO_RETRY', 'COMPLETED_AUDIT_PENDING']) {
    assert.deepEqual(eligibleUnpaidQuestions(selected, [{ id: 'q1', status }], { questions: { q1: { forwardedCompletions: 6 } } }).map(row => row.id), ['q3']);
  }
  assert.throws(() => eligibleUnpaidQuestions(selected, [], { questions: { q1: { forwardedCompletions: 1 } } }), /refusing a retry/u);
});

test('T10 single-pass continues local question failures and stops systemic failures', () => {
  const question = { prohibitedTools: ['bash'], providerFailures: [], hostErrors: [], requestCount: { blockedCompletions: 0 }, stopReason: 'NON_RESEARCH_TOOL_ATTEMPT' };
  const proxyState = { blockedUnattributed: 0, events: [] };
  assert.equal(shouldStopBatch({ singlePass: true, question, proxyState }), false);
  assert.equal(shouldStopBatch({ singlePass: false, question, proxyState }), true);
  assert.equal(shouldStopBatch({ singlePass: true, question: { ...question, prohibitedTools: [], stopReason: null, requestCount: { blockedCompletions: 1 } }, proxyState }), false);
  assert.equal(shouldStopBatch({ singlePass: true, question, proxyState: { ...proxyState, blockedUnattributed: 1 } }), true);
  assert.equal(shouldStopBatch({ singlePass: true, question, proxyState: { ...proxyState, events: [{ blockReason: 'global-cap' }] } }), true);
  assert.equal(shouldStopBatch({ singlePass: true, question: { ...question, stopReason: 'RUNNER_FAILURE' }, proxyState }), true);
  const capped = { ...question, id: 'q1', prohibitedTools: [], stopReason: null, requestCount: { blockedCompletions: 1 }, hostErrors: [{ code: 'RATE_LIMIT', name: 'Error', message: 'DSH model request failed: 429' }] };
  assert.equal(shouldStopBatch({ singlePass: true, question: capped, proxyState: { ...proxyState, events: [{ questionId: 'q1', blockReason: 'question-cap', status: 429, forwarded: false }] } }), false);
  assert.equal(shouldStopBatch({ singlePass: true, question: { ...capped, requestCount: { blockedCompletions: 0 } }, proxyState }), true);
  assert.equal(shouldStopBatch({ singlePass: false, question: { ...question, prohibitedTools: [], stopReason: null, terminal: 'completed', providerFailures: [{ code: 'SERVER' }] }, proxyState }), false, 'recovered attempts do not stop a completed batch');
});

test('T10 telemetry measures exact result serialization and records rules without request headers or answer text', () => {
  const result = { hits: [{ cite: '[S1 p.1]', ref: { type: 'chunk', id: 'c1' }, snippet: '片段abc', section: 'Methods' }], text: 'reading' };
  const metric = resultMetrics(result);
  assert.equal(metric.serializedCharacters, JSON.stringify(result).length);
  assert.equal(metric.hits[0].characters.snippet, 5);
  assert.equal(metric.hits[0].characters.section, 7);
  const receipt = requestReceipt({ model: 'fake', messages: [{ role: 'system', content: 'For research questions use research_search first.' }, { role: 'user', content: 'user question never copied' }], headers: { authorization: 'secret-fixture' } });
  assert.equal(receipt.researchFirstRulePresent, true);
  assert.equal(receipt.systemText, 'For research questions use research_search first.');
  assert.ok(receipt.contextApiVersion);
  assert.equal(JSON.stringify(receipt).includes('user question never copied'), false);
  assert.equal(JSON.stringify(receipt).includes('secret-fixture'), false);
  assert.equal(validateUpstreamProxy('http://127.0.0.1:10808'), 'http://127.0.0.1:10808');
  for (const proxy of ['http://public.example:8080', 'http://user:password@127.0.0.1:10808', 'https://127.0.0.1:10808']) assert.throws(() => validateUpstreamProxy(proxy));
});

for (const failuresBeforeSuccess of [0, 2]) test(`T10 production API + real DSH completes manifest, search and answer after ${failuresBeforeSuccess} transient failures`, async () => {
  const tempRoot = path.resolve('.sciencescope-local/temp');
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(path.join(tempRoot, 't10-live-runtime-e2e-'));
  const stateDir = path.join(root, '.sciencescope-local', 'state');
  const projectDir = path.join(root, '.sciencescope-local', 'projects');
  const dshHome = path.join(root, '.sciencescope-local', 'dsh');
  const providerLedger = path.join(root, 'provider-ledger.json');
  const dbFile = path.join(stateDir, 'sciencescope.sqlite');
  const fixtureKey = 'local-only-fake-provider-key';
  const localChildKey = 'disposable-localhost-child-key';
  let database, proxy, host, api, apiServer, fakeProvider;
  const requests = [];
  const manifestCalls = [];
  let researchResult;
  let apiErrors = [];
  const active = {
    id: 'runtime-e2e-question', chatId: 't10-runtime-chat', sessions: [], events: [], toolSequence: [], toolCalls: [], researchModes: [],
    prohibitedTools: [], providerFailures: [], hostErrors: [],
  };
  const activeRef = { current: active, shuttingDown: false, async persist() {} };
  try {
    // Seed one authorized paper chunk in the real local database; the API and
    // DSH wrapper below own all subsequent search/tool/message behavior.
    await mkdir(stateDir, { recursive: true });
    database = openApplicationDatabaseSync({ stateDir });
    const research = createResearchBase({ database, resolveResourcePath: async () => { throw new Error('fixture has no original resource'); } });
    const source = research.store.addSource({ id: 'src_t10runtime', projectId, kind: 'paper', title: 'Local Runtime Fixture Paper', contentStatus: 'parsed' });
    research.store.replaceChunks(source.id, [{ page: 1, section: 'Methods', text: 'Participants were randomly assigned to two study groups.' }], { parser: 'fixture', pages: 1, contentStatus: 'parsed' });
    database.close(); database = null;

    fakeProvider = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const input = JSON.parse(body);
      const record = { input, headers: request.headers, path: request.url, method: request.method };
      requests.push(record);
      if (requests.length <= failuresBeforeSuccess) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end('{"error":{"code":"fixture_server_unavailable","message":"temporary fixture outage"}}');
        return;
      }
      const effectiveRequest = requests.length - failuresBeforeSuccess;
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      if (effectiveRequest === 1) {
        const names = (input.tools ?? []).map(tool => tool.function?.name).filter(Boolean);
        record.toolNames = names;
        assert.ok(names.includes('research_search'), 'the __manifest handshake must register production research tools before the model request');
        sendEvent(response, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-t10-search', type: 'function', function: { name: 'research_search', arguments: JSON.stringify({ query: 'randomly assigned study groups' }) } }] }, finish_reason: null }] });
        sendEvent(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        done(response);
        return;
      }
      if (effectiveRequest === 2) {
        const toolMessage = [...(input.messages ?? [])].reverse().find(message => message.role === 'tool');
        record.toolResult = String(toolMessage?.content ?? '');
        assert.match(record.toolResult, /\[S1 p\.1\]/u, 'the production search result must return the local paper citation to DSH');
        sendEvent(response, { choices: [{ delta: { content: 'The paper reports random assignment to two groups [S1 p.1].' }, finish_reason: null }] });
        sendEvent(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
        done(response);
        return;
      }
      response.writeHead(429, { 'content-type': 'application/json' });
      response.end('{"error":"unexpected extra completion in local runtime fixture"}');
    });
    await new Promise((resolve, reject) => { fakeProvider.once('error', reject); fakeProvider.listen(0, '127.0.0.1', resolve); });

    proxy = await createCappedProxy({
      evidencePath: providerLedger, maxCompletionRequests: 2, maxPerQuestion: 2,
      upstreamOrigin: `http://127.0.0.1:${fakeProvider.address().port}`, allowTestLoopbackUpstream: true,
      upstreamCredential: fixtureKey,
    });
    host = await createLiveHost({
      paths: { dataRoot: root, home: dshHome, projects: projectDir }, proxy, activeRef, credential: localChildKey,
      dshFactory: options => {
        assert.equal(options.env.SCIENCESCOPE_T10_RETRIEVAL_KEY, localChildKey);
        assert.equal(JSON.stringify(options).includes(fixtureKey), false);
        return createDshHost(options);
      },
    });
    // Observe the real internal manifest handshake without allowing it into
    // user/model tool-call scoring or provider request accounting.
    const wrappedSetToolHandler = host.setToolHandler.bind(host);
    host.setToolHandler = handler => wrappedSetToolHandler(async invocation => {
      if (invocation.name === '__manifest') manifestCalls.push({ sessionId: invocation.sessionId, expertId: invocation.expertId ?? null });
      return handler(invocation);
    });
    api = await createDesktopApi({ dataRoot: root, runtimeHost: host, onError: error => apiErrors.push({ name: error.name, code: error.code ?? null, message: error.message }) });
    apiServer = createServer((request, response) => { void api.handle(request, response); });
    await new Promise((resolve, reject) => { apiServer.once('error', reject); apiServer.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${apiServer.address().port}`;
    const call = async (route, body) => {
      const response = await fetch(origin + route, {
        method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      let value; try { value = text ? JSON.parse(text) : {}; } catch { value = { raw: text }; }
      assert.ok(response.ok, `${route} returned ${response.status}: ${text.slice(0, 300)}`);
      return value;
    };
    await call('/api/workspace', { version: 1, projects: [{ id: projectId, name: 'T10 runtime fixture', desc: '' }], pins: [], projectExpanded: {}, lastChatId: null });

    const chatId = active.chatId;
    const response = await fetch(origin + '/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chatId, projectId, model, text: '请使用本地研究资料库回答：参与者如何分组？', userMessageId: 'u-t10-runtime', assistantMessageId: 'a-t10-runtime',
        executionMode: 'ask', workspaceChoice: { mode: 'new' }, researchInput: { attachmentIds: [], messageQuotes: [], annotations: [], contextRefs: [] },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    assert.equal(response.status, 200);
    const decoder = new TextDecoder(); let pending = ''; let terminal;
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (['completed', 'failed', 'cancelled'].includes(event.type)) terminal = event;
      }
    }
    pending += decoder.decode();
    assert.equal(pending.trim(), '');
    assert.equal(terminal?.type, 'completed');
    assert.match(terminal.text, /random assignment.*\[S1 p\.1\]/iu);
    assert.equal(manifestCalls.length, 1, 'the application tool manifest handshake succeeded once');
    assert.equal(manifestCalls[0].sessionId, active.sessions[0].sessionId, 'the manifest and tools share the application session identity');
    assert.equal(active.toolCalls.length, 1, 'only the model-selected research_search is scored');
    assert.equal(active.toolCalls[0].name, 'research_search');
    assert.deepEqual(active.toolSequence.map(event => event.name), ['research_search']);
    assert.deepEqual(active.researchModes.map(({ mode, fallbackReason }) => ({ mode, fallbackReason })), [{ mode: 'keyword', fallbackReason: 'model-missing' }]);
    assert.equal(proxy.state.forwardedCompletions, 2 + failuresBeforeSuccess, '__manifest is a local host-call; retries are physical requests');
    assert.equal(proxy.state.questions[active.id].forwardedCompletions, 2 + failuresBeforeSuccess);
    assert.equal(proxy.state.questions[active.id].effectiveModelSteps, 2);
    assert.equal(proxy.state.questions[active.id].retryAttempts, failuresBeforeSuccess);
    assert.equal(requests.length, 2 + failuresBeforeSuccess);
    assert.ok(requests.every(request => request.headers['x-opencode-session'] === active.sessions[0].sessionId), 'both provider calls carry the same required DSH session header');
    assert.ok(requests.every(request => !request.headers['x-sciencescope-t10-session']), 'private attribution header never leaves the local proxy');
    assert.equal(requests[0].headers.authorization, `Bearer ${fixtureKey}`);
    assert.equal(requests[failuresBeforeSuccess].toolNames.includes('research_search'), true);
    assert.equal(active.toolCalls.some(call => call.name === '__manifest'), false, 'manifest handshake is not a model tool result');
    assert.equal(apiErrors.length, 0, JSON.stringify(apiErrors));
    researchResult = active.toolCalls[0].summary;
    assert.equal(researchResult.hits[0].cite, '[S1 p.1]');
    assert.ok(active.toolCalls[0].resultMetrics.serializedCharacters > 0);
    assert.ok(active.toolCalls[0].resultMetrics.hits[0].characters.snippet > 0);
    assert.equal(proxy.state.events[0].requestReceipt.researchFirstRulePresent, true);
    assert.ok(proxy.state.events[0].requestReceipt.systemText.includes('research_search'));
    assert.match(proxy.state.events[0].requestReceipt.systemText,/Once direct evidence covers the requested scope, answer and cite evidence for each claim/);
    assert.doesNotMatch(proxy.state.events[0].requestReceipt.systemText,/answer concisely/);
    assert.equal(JSON.stringify(proxy.state).includes(fixtureKey), false);

    const usage = await call(`/api/research/usage?chatId=${encodeURIComponent(chatId)}&messageId=a-t10-runtime`);
    assert.ok(usage.refs.some(ref => ref.how === 'search' && ref.id === 'src_t10runtime-c0'));
    activeRef.shuttingDown = true;
    await api.close(); api = null;
    const verifyDb = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const saved = verifyDb.prepare('SELECT role,text FROM messages WHERE chat_id=? AND id=?').get(chatId, 'a-t10-runtime');
      assert.equal(saved.role, 'assistant');
      assert.equal(saved.text, terminal.text, 'production desktop-api persisted the DSH final answer');
    } finally { verifyDb.close(); }
  } finally {
    activeRef.shuttingDown = true;
    if (api) await api.close().catch(() => {});
    else await host?.close().catch(() => {});
    if (apiServer) { apiServer.closeAllConnections(); await new Promise(resolve => apiServer.close(resolve)); }
    await proxy?.close().catch(() => {});
    if (fakeProvider) { fakeProvider.closeAllConnections(); await new Promise(resolve => fakeProvider.close(resolve)); }
    if (database) database.close();
    await rm(root, { recursive: true, force: true });
  }
});
