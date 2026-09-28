import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { validateFrozenMapping, recallAt, memoryRecordOptions, recallMetrics, summarizeMemory, combinePriorAnswerAudit, attachPriorAnswerAudit, cloneDatabaseWithBackup, RETRIEVAL_EVAL_MODES, APPROVED_GOLD_SHA256, PAPER_DENOMINATOR, MEMORY_DENOMINATOR } from '../../../scripts/evals/real-corpus-retrieval.mjs';
import { assertRunIdentity, createCappedProxy, createLiveHost, eligibleUnpaidQuestions, providerForwardHeaders } from '../../../scripts/evals/hybrid-live-retrieval.mjs';
import { openApplicationDatabaseSync } from '../../../scripts/application-database.mjs';
import { createResearchBase } from '../../../scripts/research-base/index.mjs';

const goldBytes = await readFile(new URL('./gold.json', import.meta.url));
const gold = JSON.parse(goldBytes);
const paperIds = gold.questions.filter((question) => question.category !== 'memory_synthetic').map((question) => question.id);
const goldSha256 = createHash('sha256').update(goldBytes).digest('hex');

test('retrieval eval frozen mapping and scoring contracts are offline and exact', () => {
  assert.equal(goldSha256, APPROVED_GOLD_SHA256);
  assert.equal(paperIds.length, PAPER_DENOMINATOR);
  assert.equal(new Set(paperIds).size, PAPER_DENOMINATOR);
  const frozen = { freezeStatus: 'FROZEN', immutableGoldSha256: goldSha256, mapping: paperIds.map((questionId) => ({ questionId })) };
  assert.equal(validateFrozenMapping(frozen, { goldSha256, questionIds: paperIds }), true);
  assert.equal(recallAt(['chunk-a', 'chunk-b'], ['chunk-b'], 2), true);
  assert.equal(recallAt(['chunk-a'], ['chunk-b'], 1), false);
  assert.equal(recallAt(['chunk-a'], [], 1), false);
  assert.throws(() => validateFrozenMapping({ ...frozen, mapping: [...frozen.mapping.slice(0, -1), { questionId: paperIds[0] }] }, { goldSha256, questionIds: paperIds }), /duplicate/u);
  assert.throws(() => validateFrozenMapping({ ...frozen, mapping: [...frozen.mapping.slice(0, -1), { questionId: 'not-approved' }] }, { goldSha256, questionIds: paperIds }), /exactly match/u);
});

test('memory fixture status and project scope use the real Research Base visibility rules', async () => {
  const root = await mkdtemp(path.resolve('.sciencescope-local/temp/retrieval-eval-unit-'));
  const database = openApplicationDatabaseSync({ stateDir: root });
  try {
    const research = createResearchBase({ database, resolveResourcePath: async () => { throw new Error('not used'); } });
    for (const record of [
      { id: 'confirmed-memory', project: 'local-validation-r4', status: 'confirmed', content: 'confirmed e5-small' },
      { id: 'candidate-memory', project: 'local-validation-r4', status: 'candidate', content: 'candidate e5-large' },
      { id: 'superseded-memory', project: 'local-validation-r4', status: 'superseded', content: 'old e5' },
      { id: 'private-other-project', project: 'other-project', status: 'confirmed', content: 'other private note' },
    ]) {
      const options = memoryRecordOptions(record);
      research.store.createItem({ id: record.id, type: 'memory', subtype: 'decision', projectId: options.projectId, scope: options.scope, title: record.id, body: record.content, visibility: options.visibility }, { status: options.status });
    }
    assert.equal(research.store.getItem('confirmed-memory').status, 'active');
    assert.equal(research.store.getItem('candidate-memory').status, 'proposed');
    assert.equal(research.store.getItem('superseded-memory').status, 'superseded');
    assert.deepEqual(research.retrieval.search({ query: 'confirmed e5-small', docTypes: ['item'], itemTypes: ['memory'], projectId: 'local-validation-r4', audience: 'agent', k: 10 }).map((hit) => hit.ref.id), ['confirmed-memory']);
    assert.equal(research.retrieval.search({ query: 'candidate e5-large', docTypes: ['item'], itemTypes: ['memory'], projectId: 'local-validation-r4', audience: 'agent', k: 10 }).some((hit) => hit.ref.id === 'candidate-memory'), false);
    assert.equal(research.retrieval.search({ query: 'old e5', docTypes: ['item'], itemTypes: ['memory'], projectId: 'local-validation-r4', audience: 'agent', k: 10 }).some((hit) => hit.ref.id === 'superseded-memory'), false);
    assert.equal(research.retrieval.search({ query: 'other private note', docTypes: ['item'], itemTypes: ['memory'], projectId: 'local-validation-r4', audience: 'agent', k: 10 }).some((hit) => hit.ref.id === 'private-other-project'), false);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('hybrid eval contract reports all four modes and paper/memory denominators', () => {
  assert.deepEqual(RETRIEVAL_EVAL_MODES, ['keyword', 'single-vector', 'bilingual-vector', 'weighted-hybrid']);
  const rows = [
    { topIds: ['a'], expectedIds: ['a'] },
    { topIds: ['x', 'b'], expectedIds: ['b'] },
    { topIds: ['x'], expectedIds: ['missing'] },
  ];
  assert.deepEqual(recallMetrics(rows), { r1: 1 / 3, r5: 2 / 3, r10: 2 / 3 });
  const memory = summarizeMemory([
    { topIds: ['m1'], expectedIds: ['m1'] },
    { topIds: [], expectedIds: [] , noMatch: true },
    { topIds: ['other'], expectedIds: [], noMatch: false },
  ]);
  assert.equal(memory.denominator, 3);
  assert.equal(memory.positiveDenominator, 1);
  assert.equal(memory.negativeDenominator, 2);
  assert.equal(memory.positive.r1, 1);
  assert.equal(memory.negativeNoMatchAccuracy, 0.5);
  assert.equal(PAPER_DENOMINATOR, 52);
  assert.equal(MEMORY_DENOMINATOR, 8);
});

test('offline eval clones the prepared DB with node:sqlite backup and leaves source unchanged', async () => {
  const root = await mkdtemp(path.resolve('.sciencescope-local/temp/retrieval-eval-backup-'));
  const sourcePath = path.join(root, 'source.sqlite');
  const clonePath = path.join(root, 'output', 'clone.sqlite');
  const source = new DatabaseSync(sourcePath);
  source.exec('CREATE TABLE facts(value TEXT); INSERT INTO facts(value) VALUES (\'source\')');
  source.close();
  try {
    await mkdir(path.dirname(clonePath), { recursive: true });
    await cloneDatabaseWithBackup(sourcePath, clonePath);
    const clone = new DatabaseSync(clonePath);
    clone.exec("UPDATE facts SET value='clone'");
    clone.close();
    const unchanged = new DatabaseSync(sourcePath, { readOnly: true });
    try { assert.equal(unchanged.prepare('SELECT value FROM facts').get().value, 'source'); }
    finally { unchanged.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('historical 43/52 answer judgments join by approved question IDs and gold/mapping hashes', () => {
  const ids = Array.from({ length: 52 }, (_, index) => `q-${index}`);
  const first = {
    goldSha256, mappingSha256: 'frozen-map-sha',
    questions: ids.slice(0, 26).map((id, index) => ({ id, state: index < 24 ? 'COMPLETED_AUDIT_PENDING' : 'FAILED', terminal: index < 24 ? 'completed' : 'cancelled', assessment: index < 24 ? 'full' : 'failed' })),
  };
  const last = {
    goldSha256, mappingSha256: 'frozen-map-sha',
    rows: ids.slice(26).map((id, index) => ({ id, rawStatus: 'COMPLETED_AUDIT_PENDING', coreGrade: index < 19 ? 'full' : 'wrong' })),
  };
  const result = combinePriorAnswerAudit(first, last, { goldSha256, mappingSha256: 'frozen-map-sha', questionIds: ids });
  assert.equal(result.denominator, 52);
  assert.equal(result.full, 43);
  assert.equal(result.counts.failed, 2);
  assert.equal(result.counts.wrong, 7);
  assert.equal(result.rows[25].questionId, 'q-25');
  const paper = Object.fromEntries(RETRIEVAL_EVAL_MODES.map((mode) => [mode, {
    rows: ids.map((questionId) => ({ questionId, topIds: [], expectedIds: [] })),
  }]));
  const report = attachPriorAnswerAudit({ goldSha256, paper }, result, ids, ['audit-first26.json', 'audit-last26.json']);
  assert.equal(report.noModelAnswersAudited, true);
  assert.equal(report.baselineAnswerAudit.full, 43);
  assert.equal(report.paper['weighted-hybrid'].rows[25].priorAnswerGrade, 'failed');
  assert.deepEqual(report.baselineAnswerAudit.sources, ['audit-first26.json', 'audit-last26.json']);
  assert.throws(() => combinePriorAnswerAudit(first, { ...last, mappingSha256: 'different-map' }, { goldSha256, mappingSha256: 'frozen-map-sha', questionIds: ids }), /does not match/u);
});

test('fresh recovery ledger exposes only zero-paid questions and never retries an orphan paid question', () => {
  const questions = [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }];
  assert.deepEqual(eligibleUnpaidQuestions(questions, [], { questions: {} }).map(row => row.id), ['q1', 'q2', 'q3']);
  const afterPilot = eligibleUnpaidQuestions(questions, [{ id: 'q1', status: 'COMPLETED' }], {
    questions: { q1: { forwardedCompletions: 2 }, q2: { forwardedCompletions: 0 }, q3: { forwardedCompletions: 0 } },
  });
  assert.deepEqual(afterPilot.map(row => row.id), ['q2', 'q3']);
  assert.throws(() => eligibleUnpaidQuestions(questions, [], { questions: { q2: { forwardedCompletions: 1 } } }), /refusing a retry/u);
});

test('saved live ledger resumes only under its pinned project/gold/mapping/chunk identity', () => {
  const inputs = { goldSha256, mappingSha256: 'frozen-map-sha', chunksSha256: 'frozen-chunks-sha' };
  const ledger = { ...inputs, projectId: 't10-hybrid-retrieval' };
  assert.equal(assertRunIdentity(ledger, inputs, 't10-hybrid-retrieval'), true);
  assert.throws(() => assertRunIdentity(ledger, inputs, 'another-project'), /projectId changed/u);
  assert.throws(() => assertRunIdentity({ ...ledger, chunksSha256: 'changed' }, inputs, 't10-hybrid-retrieval'), /chunksSha256 changed/u);
});

test('live proxy forwards OpenCode session header, strips only private attribution, and enforces caps before upstream', async () => {
  const forwardedHeaders = providerForwardHeaders({
    host: '127.0.0.1', authorization: 'Bearer non-secret-fixture-value', 'content-type': 'application/json',
    'x-opencode-session': 'provider-session-header', 'x-sciencescope-t10-session': 'local-attribution', connection: 'close',
  }, 'provider.example');
  assert.deepEqual(forwardedHeaders, {
    host: 'provider.example', authorization: 'Bearer non-secret-fixture-value', 'content-type': 'application/json',
    'x-opencode-session': 'provider-session-header',
  });

  const root = await mkdtemp(path.resolve('.sciencescope-local/temp/t10-proxy-contract-'));
  const evidencePath = path.join(root, 'request-ledger.json');
  const received = [];
  const upstream = createServer((request, response) => {
    received.push({ method: request.method, url: request.url, headers: request.headers });
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const proxy = await createCappedProxy({
    evidencePath, maxCompletionRequests: 1, maxPerQuestion: 1,
    upstreamOrigin: `http://127.0.0.1:${upstream.address().port}`, allowTestLoopbackUpstream: true,
  });
  try {
    proxy.registerSession('session-q1', { questionId: 'q1', kind: 'main' });
    proxy.registerSession('session-q2', { questionId: 'q2', kind: 'main' });
    const send = (sessionId, route = '/zen/go/v1/chat/completions') => fetch(`http://127.0.0.1:${proxy.port}${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer non-secret-fixture-value',
        'x-opencode-session': 'provider-session-header', 'x-sciencescope-t10-session': sessionId }, body: '{}',
    });
    assert.equal((await send('session-q1')).status, 200);
    assert.equal((await send('session-q2')).status, 429); // global cap reached before second upstream hop.
    assert.equal((await send('session-q1')).status, 429); // per-question cap also blocks retry.
    assert.equal((await send('session-q1', '/zen/go/v1/models')).status, 404);
    assert.equal(received.length, 1);
    assert.equal(received[0].headers['x-opencode-session'], 'provider-session-header');
    assert.equal(received[0].headers['x-sciencescope-t10-session'], undefined);
    assert.equal(received[0].headers.authorization, 'Bearer non-secret-fixture-value');
    assert.equal(proxy.state.completionAttempts, 3);
    assert.equal(proxy.state.forwardedCompletions, 1);
    assert.equal(proxy.state.blockedCompletions, 2);
    const persisted = await readFile(evidencePath, 'utf8');
    assert.equal(persisted.includes('authorization'), false);
    assert.equal(persisted.includes('non-secret-fixture-value'), false);
    assert.equal(persisted.includes('provider-session-header'), false);
  } finally {
    await proxy.close();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('T10 host wrapper preserves the T17 application session identity and attributes tool receipts to it', async () => {
  const starts = [], registrations = [], sessions = [];
  let wrappedToolHandler;
  const fakeDsh = {
    async startSession(options) { starts.push(options); return { sessionId: options.sessionId }; },
    observeSession(session, callback) { sessions.push({ session, callback }); },
    setToolHandler(handler) { wrappedToolHandler = handler; },
    async close() {},
  };
  const owner = { id: 'question-1', chatId: 't10-chat-1', sessions: [], toolSequence: [], toolCalls: [], researchModes: [], prohibitedTools: [], providerFailures: [] };
  let persists = 0;
  const activeRef = { current: owner, persist: async () => { persists += 1; } };
  const paths = { home: '.sciencescope-local/temp/t10-live-host-contract/dsh', projects: '.sciencescope-local/temp/t10-live-host-contract/projects', dataRoot: path.resolve('.sciencescope-local/temp/t10-live-host-contract/data') };
  const proxy = { port: 12345, registerSession(id, assignment) { registrations.push({ id, ...assignment }); }, sealQuestion() {} };
  const host = await createLiveHost({ paths, proxy, activeRef, dshFactory: async () => fakeDsh });
  const applicationSessionId = 'session-T17Application123';
  const workspace = path.join(paths.dataRoot, '.sciencescope-local', 'projects', 'owned');
  await host.startSession({ sessionId: applicationSessionId, workspace });
  await host.startSession({ noTools: true, workspace });
  assert.equal(starts[0].sessionId, applicationSessionId);
  assert.match(starts[1].sessionId, /^session-[A-Za-z0-9]+$/u);
  assert.deepEqual(registrations.map(row => row.id), starts.map(row => row.sessionId));
  assert.deepEqual(owner.sessions.map(row => row.sessionId), starts.map(row => row.sessionId));
  assert.deepEqual(registrations.map(row => row.kind), ['main', 'minutes']);
  assert.equal(sessions.length, 2);

  let manifestCalls = 0;
  host.setToolHandler(async invocation => {
    if (invocation.name === '__manifest') { manifestCalls += 1; return { tools: [{ name: 'research_search' }] }; }
    return { mode: 'hybrid', fallbackReason: null, hits: [{ cite: '[S2 p.1]', ref: { type: 'chunk', id: 'src_test-c1' } }] };
  });
  const manifest = await wrappedToolHandler({ sessionId: applicationSessionId, name: '__manifest', callId: 'manifest-1', args: {} });
  assert.deepEqual(manifest, { tools: [{ name: 'research_search' }] });
  assert.equal(manifestCalls, 1);
  assert.equal(owner.toolCalls.length, 0, '__manifest is an internal capability handshake, not a scored model tool call');
  assert.equal(owner.toolSequence.length, 0, '__manifest does not enter the user-visible tool sequence');
  const result = await wrappedToolHandler({ sessionId: applicationSessionId, name: 'research_search', callId: 'call-1', args: { query: 'fixture query' } });
  assert.equal(result.mode, 'hybrid');
  assert.deepEqual(owner.researchModes, [{ mode: 'hybrid', fallbackReason: null, citations: ['[S2 p.1]'] }]);
  assert.equal(owner.toolCalls[0].sessionKind, 'main');
  assert.equal(owner.toolSequence[0].name, 'research_search');
  assert.ok(persists >= 3);
  await assert.rejects(() => wrappedToolHandler({ sessionId: 'session-not-owned', name: 'research_search', args: {} }), /not attributed/u);
  await host.close();
});
