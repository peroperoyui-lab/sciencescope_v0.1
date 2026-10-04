// Bounded T10 live evaluation. Default execution is an offline preflight;
// provider traffic requires explicit live authorization and a selected phase.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { cp, lstat, mkdir, readFile, realpath, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import { createDshHost } from '../../adapters/runtime-dsh/host.mjs';
import { createDesktopApi } from '../desktop-api.mjs';
import { APPROVED_GOLD_SHA256, cloneDatabaseWithBackup, validateFrozenMapping } from './real-corpus-retrieval.mjs';
import { embeddingManifest, verifyEmbeddingFiles } from '../research-base/model-assets.mjs';
import { CONTEXT_API_VERSION } from '../context/tools.mjs';
import { extractCitationLabels } from '../research-base/citations.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outputRoot = path.join(repo, '.sciencescope-local', 'temp', 't10-validation', 'live');
const sourceRoot = path.join(repo, '.sciencescope-local', 'temp', 'local-validation-r4');
const sourceEval = path.join(sourceRoot, 'final-eval');
const baselineDataRoot = path.join(sourceEval, 'runtime');
const baselineDbPath = path.join(baselineDataRoot, '.sciencescope-local', 'state', 'sciencescope.sqlite');
const goldPath = path.join(repo, 'tests', 'fixtures', 'retrieval-eval', 'gold.json');
const mappingPath = path.join(sourceEval, 'mapping-frozen.json');
const chunksPath = path.join(sourceEval, 'chunks.json');
const localModelDir = path.join(repo, '.sciencescope-local', 'models', 'multilingual-e5-small');
const projectId = 't10-hybrid-retrieval';
const projectName = 'T10 Hybrid Retrieval Evaluation';
const model = Object.freeze({ providerId: 't10-retrieval-counted', modelId: 'deepseek-v4.1-flash' });
const PREFIX = '请检索本地研究资料库，使用 research_search/research_read，简短回答并引用来源；没有依据请说明。';
const LIVE_KEY_PATH = path.join(repo, '.sciencescope-local', 'secret', 'opencode.key');
const REQUEST_PREFIX = '/zen/go/v1/';
const SESSION_HEADER = 'x-sciencescope-t10-session';
const OPENCODE_SESSION_HEADER = 'x-opencode-session';
const MAX_PER_QUESTION = 6;
const MAX_TRANSPORT_RETRIES = 5;
const PILOT_SIZE = 3;
const QUESTION_DEADLINE_MS = 180_000;
const SEMANTIC_READY_DEADLINE_MS = 15 * 60_000;
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade']);
let secretForRedaction = '';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isDirect = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
const safe = value => JSON.parse(JSON.stringify(value, (_name, item) => typeof item === 'string' && secretForRedaction ? item.split(secretForRedaction).join('[REDACTED]') : item));
const json = value => `${JSON.stringify(safe(value), null, 2)}\n`;

export function parseArgs(argv) {
  const result = { runName: 't10-hybrid-pilot', preflight: true };
  const phases = argv.filter(arg => ['--pilot', '--full', '--single-pass'].includes(arg));
  if (phases.length > 1) throw new Error('Choose exactly one live phase');
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--preflight') result.preflight = true;
    else if (arg === '--authorized-live') result.authorizedLive = true;
    else if (arg === '--pilot') result.phase = 'pilot';
    else if (arg === '--full') result.phase = 'full';
    else if (arg === '--single-pass') { result.phase = 'single-pass'; result.continueAfterQuestionFailure = true; }
    else if (arg === '--questions') result.questionIds = argv[++index]?.split(',');
    else if (arg === '--upstream-proxy') result.upstreamProxy = validateUpstreamProxy(argv[++index]);
    else if (arg === '--pilot-reviewed') result.pilotReviewed = true;
    else if (arg === '--run-name') result.runName = argv[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(result.runName ?? '')) throw new Error('run name must be 1–64 safe filename characters');
  if (result.phase && !result.authorizedLive) throw new Error('Live phases require --authorized-live');
  if (result.phase === 'full' && !result.pilotReviewed) throw new Error('Full phase requires primary review of the completed three-question pilot and --pilot-reviewed');
  if (result.authorizedLive && !result.phase) throw new Error('Choose exactly one of --pilot, --full or --single-pass with --authorized-live');
  if (result.phase && result.preflight && argv.includes('--preflight')) throw new Error('Choose preflight or live phase, not both');
  if (result.questionIds && result.phase && result.phase !== 'single-pass') throw new Error('--questions requires --single-pass (or offline preflight)');
  return result;
}

export function validateUpstreamProxy(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('upstream proxy must be an unauthenticated loopback HTTP proxy');
  return url.origin;
}

export function selectQuestions(questions, ids) {
  if (ids === undefined) return questions;
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error('question selection must contain unique nonempty ids');
  const approved = new Set(questions.map(question => question.id));
  if (ids.some(id => !approved.has(id))) throw new Error('question selection contains an unapproved id');
  const requested = new Set(ids);
  return questions.filter(question => requested.has(question.id));
}

export function shouldStopBatch({ singlePass, question, proxyState }) {
  const attributedFailure = question.prohibitedTools.length > 0 || question.providerFailures.length > 0 || question.requestCount.blockedCompletions > 0
    || proxyState.events.some(event => event.questionId === question.id && event.forwarded && (event.status >= 400 || event.upstreamAborted || event.deadlineExceeded));
  const systemic = proxyState.blockedUnattributed > 0 || proxyState.events.some(event => ['global-cap', 'global-physical-cap'].includes(event.blockReason))
    || question.hostErrors.length > 0 && !attributedFailure || question.stopReason === 'RUNNER_FAILURE';
  const failed = question.prohibitedTools.length || question.stopReason || question.requestCount.blockedCompletions
    || question.providerFailures.length && question.terminal !== 'completed';
  return Boolean(systemic || !singlePass && failed);
}

export function resultMetrics(result) {
  const fields = value => Object.fromEntries(['snippet', 'section', 'text', 'body', 'title', 'note'].filter(name => typeof value?.[name] === 'string').map(name => [name, value[name].length]));
  return { serializedCharacters: JSON.stringify(result ?? null).length, fields: fields(result),
    hits: (result?.hits ?? []).map(hit => ({ cite: hit.cite ?? null, ref: hit.ref ?? null, characters: fields(hit) })) };
}

// Syntax recognition and API resolution are receipts, not source-support grades.
export async function resolveAnswerCitations(answer, resolveLabel) {
  const citationParseAudit = extractCitationLabels(answer);
  const citations = [];
  for (const parsed of new Map(citationParseAudit.map(row => [row.raw, row])).values()) {
    if (!parsed.citations.length) {
      citations.push({ label: parsed.raw, resolved: false, citations: [], parseStatus: parsed.parseStatus, unrecognized: parsed.unrecognized });
      continue;
    }
    try {
      const result = await resolveLabel(parsed.raw);
      const members = result.citations ?? (result.citation ? [result.citation] : []);
      citations.push({ label: parsed.raw, ref: result.citation?.ref ?? null, page: result.citation?.page ?? null,
        resolved: result.parseStatus === 'parsed' && members.length === parsed.citations.length,
        citations: members, parseStatus: result.parseStatus ?? parsed.parseStatus, unrecognized: result.unrecognized ?? [] });
    } catch (error) {
      citations.push({ label: parsed.raw, resolved: false, citations: [], parseStatus: parsed.parseStatus,
        unrecognized: parsed.unrecognized, resolutionError: { name: error.name, code: error.code ?? null } });
    }
  }
  return { citations, citationParseAudit,
    unsupportedCitationSyntax: citationParseAudit.flatMap(row => row.unrecognized.map(member => ({ label: row.raw, ...member }))) };
}

export function requestReceipt(payload) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const system = messages.filter(message => message.role === 'system' || message.role === 'developer').map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
  return { serializedCharacters: JSON.stringify(payload).length, model: typeof payload.model === 'string' ? payload.model : null,
    messages: messages.map(message => { const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? null); return { role: message.role, characters: content.length, sha256: hash(content) }; }),
    toolNames: (payload.tools ?? []).map(tool => tool.function?.name).filter(name => typeof name === 'string'),
    systemCharacters: system.length, systemSha256: hash(system), systemText: safe(system), contextApiVersion: CONTEXT_API_VERSION,
    researchFirstRulePresent: /research questions use research_search first/i.test(system),
    answerSufficiencyRulePresent: /Once direct evidence covers the requested scope, answer concisely/u.test(system),
    maxTokens: payload.max_tokens ?? payload.max_completion_tokens ?? null, stream: payload.stream === true };
}

function usage() {
  return `Usage:\n  node scripts/evals/hybrid-live-retrieval.mjs --preflight [--run-name NAME] [--questions IDS]\n  node scripts/evals/hybrid-live-retrieval.mjs --authorized-live --pilot [--run-name NAME]\n  node scripts/evals/hybrid-live-retrieval.mjs --authorized-live --full --pilot-reviewed [--run-name NAME]\n  node scripts/evals/hybrid-live-retrieval.mjs --authorized-live --single-pass --run-name NAME [--questions IDS]\n\nDefault is offline-only. Pilot sends the first 3 approved questions, max 6 model steps per question (18 total). Full requires explicit review and caps the run at 312 model steps. Single-pass uses approved question order in its own directory, preserves failures and continues to the next question. Each selection is capped at 6 model steps per question; transient retries are separately reported, at most 5 per step and 36 physical requests per question. A question already marked RUNNING or present in the paid-request ledger is never rerun. Historical schema 1 runs remain unchanged and require a fresh run directory.\n`;
}

async function readInputs() {
  const [goldBytes, mappingBytes, chunksBytes, manifestBytes] = await Promise.all([
    readFile(goldPath), readFile(mappingPath), readFile(chunksPath), readFile(path.join(sourceRoot, 'corpus', 'manifest.json')),
  ]);
  const goldSha256 = hash(goldBytes), mappingSha256 = hash(mappingBytes);
  assert.equal(goldSha256, APPROVED_GOLD_SHA256, 'gold does not match the user-approved immutable SHA');
  const gold = JSON.parse(goldBytes), mapping = JSON.parse(mappingBytes), chunks = JSON.parse(chunksBytes).chunks;
  const questions = (gold.questions ?? []).filter(question => question.category !== 'memory_synthetic')
    .map(question => ({ id: question.id, category: question.category, query: question.query.zh }));
  assert.equal(questions.length, 52);
  assert.equal(new Set(questions.map(question => question.id)).size, 52);
  validateFrozenMapping(mapping, { goldSha256, questionIds: questions.map(question => question.id) });
  assert.equal(hash(chunksBytes), mapping.inputChunksSha256, 'frozen evidence mapping does not match the reviewed chunk export');
  assert.equal(chunks.length, 1412, 'prepared research corpus chunk count changed');
  assert.equal(JSON.parse(manifestBytes).records?.length, 8, 'prepared corpus must contain eight papers');

  const sourceDb = new DatabaseSync(baselineDbPath, { readOnly: true });
  let resources;
  try {
    assert.equal(sourceDb.prepare('SELECT count(*) n FROM rb_chunks').get().n, chunks.length);
    assert.equal(sourceDb.prepare('SELECT count(*) n FROM rb_sources').get().n, 8);
    assert.equal(sourceDb.prepare('SELECT count(*) n FROM messages').get().n, 0, 'baseline contains transcripts');
    assert.equal(sourceDb.prepare('SELECT count(*) n FROM rb_items').get().n, 0, 'baseline contains memory or answer fixtures');
    const getChunk = sourceDb.prepare('SELECT source_id,page,section,kind,text FROM rb_chunks WHERE id=?');
    for (const chunk of chunks) assert.deepEqual({ ...getChunk.get(chunk.chunkId) }, {
      source_id: chunk.sourceId, page: chunk.page, section: chunk.section, kind: chunk.kind, text: chunk.text,
    }, `prepared database chunk ${chunk.chunkId} differs from the approved frozen projection`);
    const getSource = sourceDb.prepare('SELECT resource_id FROM rb_sources WHERE id=?');
    const getChunkSource = sourceDb.prepare('SELECT source_id FROM rb_chunks WHERE id=?');
    for (const row of mapping.mapping) {
      assert.ok(row.goldChunkIds.length > 0, `gold mapping ${row.questionId} has no expected chunk`);
      assert.ok(row.goldChunkIds.every(id => getChunkSource.get(id)?.source_id === row.sourceId), `gold mapping ${row.questionId} escapes its approved source`);
      assert.ok(getSource.get(row.sourceId), `gold mapping ${row.questionId} source is absent`);
    }
    resources = sourceDb.prepare('SELECT id,path,metadata_json FROM resources ORDER BY id').all();
  } finally { sourceDb.close(); }
  assert.equal(resources.length, 8);
  const libraryRoot = path.join(baselineDataRoot, '.sciencescope-local', 'library');
  const libraryReal = await realpath(libraryRoot);
  for (const resource of resources) {
    assert.notEqual(JSON.parse(resource.metadata_json).storage, 'project');
    assert.ok(resource.path, `resource ${resource.id} has no owned original`);
    const absolute = path.resolve(libraryRoot, resource.path);
    assert.ok(absolute.startsWith(libraryReal + path.sep), 'only baseline-owned corpus originals may be copied');
    assert.ok((await stat(absolute)).isFile());
  }
  return {
    questions, mapping, chunks, resources,
    goldSha256, mappingSha256, chunksSha256: hash(chunksBytes),
    baselineDbSha256: hash(await readFile(baselineDbPath)),
  };
}

async function ensureRunData({ runDir, inputs }) {
  const dataRoot = path.join(runDir, 'data');
  const stateDir = path.join(dataRoot, '.sciencescope-local', 'state');
  const dbPath = path.join(stateDir, 'sciencescope.sqlite');
  const library = path.join(dataRoot, '.sciencescope-local', 'library');
  const projects = path.join(dataRoot, '.sciencescope-local', 'projects');
  await mkdir(stateDir, { recursive: true });
  await mkdir(projects, { recursive: true });
  if (!existsSync(dbPath)) {
    await cloneDatabaseWithBackup(baselineDbPath, dbPath);
    await cp(path.join(baselineDataRoot, '.sciencescope-local', 'library'), library, { recursive: true, force: false, errorOnExist: true });
    const db = new DatabaseSync(dbPath);
    try {
      // This database is an owned eval clone; assign its corpus to the new
      // evaluation project while preserving approved source/chunk identities.
      const sources = db.prepare('SELECT id FROM rb_sources WHERE project_id IS NULL').all();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE resources SET project_id=? WHERE project_id IS NULL').run(projectId);
        db.prepare('UPDATE rb_sources SET project_id=? WHERE project_id IS NULL').run(projectId);
        const updateFts = db.prepare("UPDATE rb_fts SET project_id=? WHERE doc_type='source' AND doc_id=?");
        const updateChunksFts = db.prepare("UPDATE rb_fts SET project_id=? WHERE doc_type='chunk' AND doc_id IN (SELECT id FROM rb_chunks WHERE source_id=?)");
        for (const source of sources) { updateFts.run(projectId, source.id); updateChunksFts.run(projectId, source.id); }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } finally { db.close(); }
  } else {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT count(*) n FROM rb_chunks').get().n, inputs.chunks.length, 'prepared run DB chunk count mismatch');
      assert.equal(db.prepare('SELECT count(*) n FROM rb_sources WHERE project_id=?').get(projectId).n, 8, 'run DB is not the isolated evaluation project');
    } finally { db.close(); }
  }
  return { dataRoot, stateDir, dbPath, library, projects, home: path.join(dataRoot, '.sciencescope-local', 'dsh') };
}

async function ensureModelJunction(dataRoot) {
  const manifest = await embeddingManifest();
  if (!(await verifyEmbeddingFiles(localModelDir, manifest))) throw new Error('Pinned local e5-small files are missing or failed checksum verification; no downloads are attempted');
  const config = JSON.parse(await readFile(path.join(localModelDir, 'config.json'), 'utf8'));
  const dimensions = config.hidden_size ?? config.d_model ?? config.dim;
  if (!Number.isInteger(dimensions) || dimensions !== manifest.dimensions) throw new Error('Model config dimension disagrees with the pinned embedding manifest');
  const ownedPath = path.join(dataRoot, '.sciencescope-local', 'models', 'multilingual-e5-small');
  await mkdir(path.dirname(ownedPath), { recursive: true });
  let created = false;
  try { await lstat(ownedPath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await symlink(localModelDir, ownedPath, 'junction'); created = true; }
  const [targetReal, ownedReal, linkInfo] = await Promise.all([realpath(localModelDir), realpath(ownedPath), lstat(ownedPath)]);
  if (!linkInfo.isSymbolicLink() || path.resolve(targetReal).toLowerCase() !== path.resolve(ownedReal).toLowerCase()) throw new Error('Evaluation model junction does not resolve to the verified local model cache');
  return { manifest, dimensions, ownedPath, modelRealpath: targetReal, created };
}

async function createLocalServer(api) {
  const server = createServer((request, response) => { void api.handle(request, response); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function localJson(origin, route, body, { timeoutMs = 10_000 } = {}) {
  const response = await fetch(origin + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : {}; } catch { value = { message: text }; }
  if (!response.ok) throw Object.assign(new Error(`local ${route} returned HTTP ${response.status}`), { code: value.code ?? 'LOCAL_API_ERROR' });
  return value;
}

async function waitForSemanticReady(origin) {
  const deadline = Date.now() + SEMANTIC_READY_DEADLINE_MS;
  let status = await localJson(origin, '/api/research/embedding');
  if (!status.enabled || status.state === 'disabled') {
    await localJson(origin, '/api/research/embedding', { action: 'enable' });
  }
  while (Date.now() < deadline) {
    status = await localJson(origin, '/api/research/embedding');
    if (status.state === 'ready' && status.enabled && status.indexed >= status.total) return status;
    if (['unsupported', 'model-missing', 'error'].includes(status.state)) throw new Error(`semantic index preflight stopped in state ${status.state}`);
    await sleep(250);
  }
  throw new Error(`semantic index did not become ready; final state=${status.state}`);
}

async function prepareProject(origin) {
  return localJson(origin, '/api/workspace', { version: 1, projects: [{ id: projectId, name: projectName, desc: 'Isolated approved T10 retrieval evaluation.' }], pins: [], projectExpanded: { [projectId]: true }, lastChatId: null });
}

async function preflight(runDir, inputs) {
  await mkdir(runDir, { recursive: true });
  const paths = await ensureRunData({ runDir, inputs });
  const modelLink = await ensureModelJunction(paths.dataRoot);
  const runtimeHost = { listProviders: async () => [], close: async () => {} };
  let api, server;
  try {
    api = await createDesktopApi({ dataRoot: paths.dataRoot, runtimeHost });
    ({ server, origin: paths.origin } = await createLocalServer(api));
    await prepareProject(paths.origin);
    const semantic = await waitForSemanticReady(paths.origin);
    assert.equal(semantic.indexed, semantic.total);
    assert.ok(semantic.total >= inputs.chunks.length, 'index must include every approved corpus chunk');
    const probe = await localJson(paths.origin, `/api/research/search?q=${encodeURIComponent('人工智能伦理教育')}&projectId=${encodeURIComponent(projectId)}&types=chunk&k=3`);
    assert.equal(probe.mode, 'hybrid', 'production research API must report a hybrid result before a live question can be sent');
    assert.ok(Array.isArray(probe.hits) && probe.hits.length > 0, 'production hybrid readiness probe must hit the authorized paper corpus');
    const result = {
      status: 'PREFLIGHT_READY_NO_PROVIDER_REQUESTS', createdAt: new Date().toISOString(),
      paidRequests: 0, questionsAvailable: inputs.questions.length, pilotQuestions: PILOT_SIZE,
      projectId, projectName, isolatedRunDataRoot: paths.dataRoot,
      goldSha256: inputs.goldSha256, mappingSha256: inputs.mappingSha256, chunksSha256: inputs.chunksSha256,
      corpus: { papers: 8, chunks: inputs.chunks.length, resources: inputs.resources.length },
      model: { id: modelLink.manifest.modelId, revision: modelLink.manifest.revision, dimensionsFromConfig: modelLink.dimensions, localCacheRealpath: modelLink.modelRealpath, ownedJunction: modelLink.ownedPath },
      semantic: { enabled: semantic.enabled, state: semantic.state, indexed: semantic.indexed, total: semantic.total, vectorMode: semantic.mode ?? null },
      productionSearchProbe: { mode: probe.mode, fallbackReason: probe.fallbackReason ?? null, hits: probe.hits.map(hit => ({ cite: hit.cite, ref: hit.ref })) },
      sourceDbSha256BeforeClone: inputs.baselineDbSha256, noGoldOrAnswersCopiedToDshHome: true,
      scopes: 'all 8 copied resources/sources and FTS rows belong only to the new T10 project; main-chat count starts at zero',
      modelAnswersAudited: false,
    };
    await atomicWrite(path.join(runDir, 'preflight.json'), result);
    return result;
  } finally {
    try { await api?.close(); } finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
    await removeOwnedJunction(modelLink);
  }
}

async function removeOwnedJunction(link) {
  if (!link?.created) return false;
  try {
    const info = await lstat(link.ownedPath);
    if (!info.isSymbolicLink()) throw new Error('refusing to remove a non-junction model path');
    const resolved = await realpath(link.ownedPath);
    if (path.resolve(resolved).toLowerCase() !== path.resolve(link.modelRealpath).toLowerCase()) throw new Error('refusing to remove a model junction with an unexpected target');
    await unlink(link.ownedPath);
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function atomicWrite(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.next`;
  await writeFile(temp, json(value), 'utf8');
  for (let attempt = 0; ; attempt += 1) {
    try { await import('node:fs/promises').then(fs => fs.rename(temp, file)); break; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 19) throw error;
      await sleep(100);
    }
  }
}

/** Retry only the already-written snapshot's rename when Windows readers
 * briefly deny replacement. Exhaustion leaves the .next evidence intact. */
export function renameSnapshotSync(from, to, { rename = renameSync,
  wait = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds) } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try { rename(from, to); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 19) throw error;
      wait(100);
    }
  }
}

function usageOnly(value) {
  const allowed = new Set(['prompt_tokens','completion_tokens','total_tokens','input_tokens','output_tokens','cached_tokens','reasoning_tokens','prompt_tokens_details','completion_tokens_details','input_tokens_details','output_tokens_details']);
  const visit = node => Object.fromEntries(Object.entries(node ?? {}).filter(([name, child]) => allowed.has(name)
    && (typeof child === 'number' && Number.isFinite(child) || child && typeof child === 'object'))
    .map(([name, child]) => [name, typeof child === 'number' ? child : visit(child)]));
  return visit(value);
}

export function providerForwardHeaders(headers, upstreamHost) {
  const output = { host: upstreamHost };
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'host' || lower === SESSION_HEADER) continue;
    output[name] = value;
  }
  return output;
}

export function eligibleUnpaidQuestions(questions, ledgerRows, requestState, limit = questions.length) {
  const recorded = new Set(ledgerRows.map(row => row.id));
  for (const question of questions) {
    const paid = Number(requestState?.questions?.[question.id]?.forwardedCompletions ?? 0);
    if (paid > 0 && !recorded.has(question.id)) throw new Error(`Question ${question.id} has a paid completion without its result row; refusing a retry`);
  }
  return questions.filter(question => !recorded.has(question.id)).slice(0, Math.max(0, limit));
}

export function assertRunIdentity(ledger, inputs, expectedProjectId) {
  for (const [field, expected] of Object.entries({ goldSha256: inputs.goldSha256, mappingSha256: inputs.mappingSha256, chunksSha256: inputs.chunksSha256, projectId: expectedProjectId })) {
    assert.equal(ledger[field], expected, `saved run ${field} changed`);
  }
  return true;
}

/** Local attribution proxy. Credentials pass to the selected upstream but are
 * never persisted, inspected, or forwarded as evaluation/session headers. */
export async function createCappedProxy({ evidencePath, maxCompletionRequests, maxPerQuestion = MAX_PER_QUESTION, upstreamOrigin = 'https://opencode.ai', allowTestLoopbackUpstream = false, upstreamProxy, upstreamCredential }) {
  if (!Number.isInteger(maxCompletionRequests) || maxCompletionRequests < 1) throw new TypeError('completion cap must be positive');
  if (!Number.isInteger(maxPerQuestion) || maxPerQuestion < 1) throw new TypeError('question cap must be positive');
  const upstream = new URL(upstreamOrigin);
  const testLoopback = allowTestLoopbackUpstream && upstream.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(upstream.hostname);
  if (!(upstream.protocol === 'https:' && upstream.hostname === 'opencode.ai') && !testLoopback) throw new Error('T10 proxy upstream is fixed to the configured OpenCode gateway');
  const upstreamAgent = upstreamProxy ? new HttpsAgent({ proxyEnv: { HTTPS_PROXY: validateUpstreamProxy(upstreamProxy) } }) : undefined;
  const maxPhysicalRequests = maxCompletionRequests * (MAX_TRANSPORT_RETRIES + 1);
  let state = { schema: 2, budgetUnit: 'effective-model-step', maxTransportRetries: MAX_TRANSPORT_RETRIES, maxPhysicalRequests, upstreamHost: upstream.host, allowedPrefix: REQUEST_PREFIX, maxPerQuestion, maxCompletionRequests, startedAt: new Date().toISOString(), completionAttempts: 0, forwardedCompletions: 0, effectiveModelSteps: 0, retryAttempts: 0, blockedCompletions: 0, blockedUnattributed: 0, questions: {}, sessions: {}, sealedQuestions: {}, events: [] };
  if (existsSync(evidencePath)) {
    const previous = JSON.parse(await readFile(evidencePath, 'utf8'));
    if (previous.schema !== 2 || previous.budgetUnit !== state.budgetUnit || previous.maxTransportRetries !== MAX_TRANSPORT_RETRIES || previous.upstreamHost !== upstream.host || previous.allowedPrefix !== REQUEST_PREFIX || previous.maxPerQuestion !== maxPerQuestion) throw new Error('existing request ledger is incompatible with this proxy; use a fresh run to preserve historical accounting');
    if (previous.maxCompletionRequests > maxCompletionRequests) throw new Error('completion cap cannot shrink when resuming');
    state = { ...previous, maxCompletionRequests, maxPhysicalRequests, resumedAt: [...(previous.resumedAt ?? []), new Date().toISOString()] };
  }
  const assignments = new Map(Object.entries(state.sessions));
  const persist = () => {
    const temp = `${evidencePath}.${process.pid}.next`;
    writeFileSync(temp, json(state));
    renameSnapshotSync(temp, evidencePath);
  };
  const questionState = id => (state.questions[id] ??= { completionAttempts: 0, forwardedCompletions: 0, effectiveModelSteps: 0, retryAttempts: 0, blockedCompletions: 0, bySessionKind: {} });
  const previousBySession = new Map();
  for (const event of state.events) if (event.forwarded && event.sessionId) previousBySession.set(event.sessionId, event);
  // Persist only bounded identifiers, never upstream messages, response bodies,
  // headers or credentials. Nested transport causes often hold the useful code.
  const errorIdentifier = value => {
    const token = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
    return typeof token === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/u.test(token)
      && ![upstreamCredential, secretForRedaction].filter(Boolean).some(secret => token.includes(secret)) ? token : null;
  };
  const connectionError = (error, type = ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(error?.code) || error?.name === 'TimeoutError' ? 'TIMEOUT' : 'TRANSPORT') => ({ connectionErrorType: type, connectionErrorName: ['Error', 'TypeError', 'AbortError', 'TimeoutError', 'AggregateError'].includes(error?.name) ? error.name : null,
    connectionErrorCode: errorIdentifier(error?.code), connectionCauseCodes: [error?.cause?.code, ...(error?.errors ?? []).map(item => item?.code), ...(error?.cause?.errors ?? []).map(item => item?.code)].map(errorIdentifier).filter(Boolean).slice(0, 8) });
  const httpErrorType = status => status === 408 || status === 504 ? 'TIMEOUT' : status === 429 ? 'RATE_LIMIT' : status >= 500 ? 'SERVER' : status === 401 || status === 403 ? 'AUTH' : 'HTTP';
  const registerSession = (id, owner) => {
    if (!id || !owner?.questionId || !['main', 'minutes'].includes(owner.kind)) throw new TypeError('proxy session attribution is invalid');
    const prior = assignments.get(id);
    if (prior && (prior.questionId !== owner.questionId || prior.kind !== owner.kind)) throw new Error('session attribution cannot be reassigned');
    assignments.set(id, { questionId: owner.questionId, kind: owner.kind });
    state.sessions[id] = { questionId: owner.questionId, kind: owner.kind };
    questionState(owner.questionId);
    persist();
  };
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    if (request.method !== 'POST' || requestUrl.pathname !== `${REQUEST_PREFIX}chat/completions`) {
      request.resume(); response.writeHead(404, { 'content-type': 'application/json' }); response.end('{"error":"route not allowed"}'); return;
    }
    const kind = 'completion';
    const header = request.headers[SESSION_HEADER];
    const sessionId = Array.isArray(header) ? header[0] : header;
    const assignment = typeof sessionId === 'string' ? assignments.get(sessionId) : null;
    const event = { sequence: state.events.length + 1, startedAt: new Date().toISOString(), finishedAt: null, method: request.method, routeKind: kind, questionId: assignment?.questionId ?? null, sessionId: typeof sessionId === 'string' ? sessionId : null, sessionKind: assignment?.kind ?? null, forwarded: false, status: null };
    if (kind === 'completion') {
      state.completionAttempts += 1;
      if (assignment) questionState(assignment.questionId).completionAttempts += 1;
      persist();
    }
    state.events.push(event);
    const chunks = []; let bytes = 0;
    try {
      for await (const chunk of request) { bytes += chunk.length; if (bytes <= 4 * 1024 * 1024) chunks.push(chunk); }
    } catch (error) {
      Object.assign(event, { finishedAt: new Date().toISOString(), status: 499, downstreamAborted: true, ...connectionError(error) }); persist(); return;
    }
    const body = Buffer.concat(chunks);
    if (bytes <= 4 * 1024 * 1024) {
      event.payloadSha256 = hash(body);
      try { event.requestReceipt = requestReceipt(JSON.parse(body.toString('utf8'))); }
      catch { event.requestReceipt = { bytes, omitted: 'invalid-json' }; }
    } else event.requestReceipt = { bytes, omitted: 'request-over-4MiB' };
    const prior = assignment ? previousBySession.get(sessionId) : null;
    const retryCandidate = prior?.finishedAt && prior.retryEligible === true && prior.payloadSha256 === event.payloadSha256;
    const isRetry = retryCandidate && prior.retryIndex < MAX_TRANSPORT_RETRIES;
    const perQuestion = assignment ? questionState(assignment.questionId) : null;
    const blockReason = kind === 'completion' && !assignment ? 'unattributed-session'
      : kind === 'completion' && state.sealedQuestions[assignment.questionId] ? 'question-sealed'
        : bytes > 4 * 1024 * 1024 ? 'request-too-large'
          : state.forwardedCompletions >= maxPhysicalRequests ? 'global-physical-cap'
            : retryCandidate && !isRetry ? 'retry-cap'
              : !isRetry && state.effectiveModelSteps >= maxCompletionRequests ? 'global-cap'
                : !isRetry && perQuestion.effectiveModelSteps >= maxPerQuestion ? 'question-cap'
                  : perQuestion.forwardedCompletions >= maxPerQuestion * (MAX_TRANSPORT_RETRIES + 1) ? 'question-physical-cap' : null;
    if (blockReason) {
      state.blockedCompletions += 1;
      if (perQuestion) perQuestion.blockedCompletions += 1;
      else state.blockedUnattributed += 1;
      Object.assign(event, { finishedAt: new Date().toISOString(), status: 429, blockReason }); persist();
      response.writeHead(429, { 'content-type': 'application/json' }); response.end('{"error":"T10 request budget reached or session unattributed"}'); return;
    }
    if (kind === 'completion') {
      state.forwardedCompletions += 1;
      perQuestion.forwardedCompletions += 1;
      perQuestion.bySessionKind[assignment.kind] = (perQuestion.bySessionKind[assignment.kind] ?? 0) + 1;
      if (isRetry) { state.retryAttempts += 1; perQuestion.retryAttempts += 1; }
      else { state.effectiveModelSteps += 1; perQuestion.effectiveModelSteps += 1; }
    }
    Object.assign(event, { forwarded: true, isRetry: Boolean(isRetry), retryIndex: isRetry ? prior.retryIndex + 1 : 0, modelStep: isRetry ? prior.modelStep : perQuestion.effectiveModelSteps, retryOfSequence: isRetry ? prior.sequence : null });
    previousBySession.set(sessionId, event); persist();
    let done = false, responseRef = null, deadline;
    const finish = (status, extra = {}) => {
      if (done) return;
      done = true; clearTimeout(deadline); Object.assign(event, { finishedAt: new Date().toISOString(), status, ...extra });
      event.retryEligible = ['TRANSPORT', 'TIMEOUT', 'SERVER', 'RATE_LIMIT'].includes(event.upstreamErrorType ?? event.connectionErrorType);
      persist();
    };
    const transport = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
    const forwardedHeaders = providerForwardHeaders(request.headers, upstream.host);
    if (upstreamCredential) forwardedHeaders.authorization = `Bearer ${upstreamCredential}`;
    const target = transport({ protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port || undefined, method: request.method,
      path: requestUrl.pathname + requestUrl.search, headers: forwardedHeaders, agent: upstreamAgent }, upstreamResponse => {
      responseRef = upstreamResponse;
      event.upstreamStatus = upstreamResponse.statusCode || 502;
      if (event.upstreamStatus >= 400) event.upstreamErrorType = httpErrorType(event.upstreamStatus);
      response.writeHead(upstreamResponse.statusCode || 502, Object.fromEntries(Object.entries(upstreamResponse.headers).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase()))));
      const decoder = new TextDecoder(); let pending = ''; const errorChunks = []; let errorBytes = 0;
      upstreamResponse.on('data', chunk => {
        if (event.upstreamStatus >= 400) { errorBytes += chunk.length; if (errorBytes <= 16 * 1024) errorChunks.push(chunk); }
        pending += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline).trim(); pending = pending.slice(newline + 1);
          if (line.startsWith('data:')) {
            try { const frame = JSON.parse(line.slice(5)); if (frame.usage) event.usage = usageOnly(frame.usage); } catch { /* content frame not persisted */ }
          }
        }
        if (pending.length > 2 * 1024 * 1024) pending = '';
      });
      upstreamResponse.pipe(response);
      upstreamResponse.once('end', () => {
        if (event.upstreamStatus >= 400 && errorBytes <= 16 * 1024) {
          try { const value = JSON.parse(Buffer.concat(errorChunks).toString('utf8')); event.upstreamErrorCode = errorIdentifier(value.error?.code ?? value.code); event.upstreamErrorName = errorIdentifier(value.error?.type ?? value.type); } catch { /* arbitrary error bodies are never persisted */ }
        }
        finish(event.upstreamStatus);
      });
      upstreamResponse.once('aborted', () => { finish(502, { upstreamAborted: true, ...connectionError(null) }); if (!response.writableEnded) response.destroy(); });
      upstreamResponse.once('error', error => { finish(502, connectionError(error)); if (!response.writableEnded) response.destroy(); });
    });
    deadline = setTimeout(() => { finish(504, { deadlineExceeded: true, ...connectionError(null, 'TIMEOUT') }); responseRef?.destroy(); target.destroy(new Error('request deadline')); }, 120_000);
    target.once('error', error => { if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' }); if (!response.writableEnded) response.end('{"error":"evaluation upstream unavailable"}'); finish(502, connectionError(error)); });
    response.once('close', () => { if (!response.writableEnded) { finish(499, { downstreamAborted: true, ...connectionError(null, 'TIMEOUT') }); responseRef?.destroy(); target.destroy(); } });
    target.end(body);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await mkdir(path.dirname(evidencePath), { recursive: true }); persist();
  return {
    port: server.address().port, state, registerSession,
    sealQuestion(id, reason) { state.sealedQuestions[id] = { reason, at: new Date().toISOString() }; persist(); },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); upstreamAgent?.destroy(); persist(); },
  };
}

function countUsageEvents(proxy, questionId) {
  return proxy.state.events.filter(event => event.questionId === questionId && event.routeKind === 'completion' && event.forwarded)
    .map(event => ({ sequence: event.sequence, sessionKind: event.sessionKind, status: event.status, isRetry: event.isRetry ?? null, modelStep: event.modelStep ?? null, retryIndex: event.retryIndex ?? null, upstreamStatus: event.upstreamStatus ?? null, upstreamErrorCode: event.upstreamErrorCode ?? null, upstreamErrorType: event.upstreamErrorType ?? null, connectionErrorType: event.connectionErrorType ?? null, connectionErrorCode: event.connectionErrorCode ?? null, connectionCauseCodes: event.connectionCauseCodes ?? [], usage: event.usage ?? null }));
}

export async function createLiveHost({ paths, proxy, activeRef, credential = secretForRedaction, dshFactory = createDshHost,
  allowedTools = ['research_search', 'research_read', 'project_memory', 'chat_recall'], sessionKind } = {}) {
  if (!Array.isArray(allowedTools) || allowedTools.some(name => typeof name !== 'string' || !name)) throw new TypeError('evaluation allowedTools must be names');
  const permittedTools = new Set(allowedTools);
  const dsh = await dshFactory({ home: paths.home, cwd: paths.projects, sessionHeaders: [SESSION_HEADER, OPENCODE_SESSION_HEADER], env: { SCIENCESCOPE_T10_RETRIEVAL_KEY: credential } });
  const runtimeConfig = { providers: { [model.providerId]: {
    api: 'openai-completions', baseURL: `http://127.0.0.1:${proxy.port}${REQUEST_PREFIX}`, apiKeyEnv: 'SCIENCESCOPE_T10_RETRIEVAL_KEY',
    models: [{ id: model.modelId, contextWindow: 131072, maxTokens: 8192 }],
  } } };
  const ownedSessions = new Map();
  const host = Object.assign(Object.create(null), dsh, {
    getRuntimeConfig: async () => runtimeConfig,
    listProviders: async () => [{ id: model.providerId, name: 'T10 isolated retrieval evaluation', models: [model.modelId], configured: true }],
    getModelInfo: async () => ({ reasoning: null }),
    startSession: async options => {
      const active = activeRef.current;
      assert.ok(active && !activeRef.shuttingDown, 'unattributed/background session launch is disabled');
      const workspace = options.workspace ?? path.join(paths.projects, 'independent', active.chatId);
      assert.ok(path.resolve(workspace).startsWith(paths.dataRoot + path.sep), 'DSH workspace escaped the owned T10 data root');
      // Preserve the application identity: T17 registers context/tool scope
      // under options.sessionId before calling this wrapper. DSH also requires
      // the stable session- prefix; a separate eval identity breaks both seams.
      const sessionId = options.sessionId ?? `session-${randomUUID().replaceAll('-', '')}`;
      const kind = sessionKind?.(options, active) ?? (options.noTools === true ? 'minutes' : 'main');
      proxy.registerSession(sessionId, { questionId: active.id, kind });
      active.sessions.push({ sessionId, kind }); ownedSessions.set(sessionId, { questionId: active.id, kind });
      await activeRef.persist();
      const session = await dsh.startSession({ ...options, workspace, sessionId });
      dsh.observeSession(session, frame => {
        if (frame.type === 'tool-call' && !permittedTools.has(frame.name)) {
          const owner = activeRef.current;
          if (!owner) return;
          owner.prohibitedTools.push({ sessionId, name: String(frame.name).slice(0, 120), callId: String(frame.callId ?? '').slice(0, 120) });
          void activeRef.stopQuestion?.('NON_RESEARCH_TOOL_ATTEMPT');
        }
        if (frame.type === 'attempt-failed') {
          const owner = activeRef.current;
          if (!owner) return;
          owner.providerFailures.push({ sessionId, code: frame.code ?? null });
        }
      });
      return session;
    },
    setToolHandler: handler => dsh.setToolHandler(async invocation => {
      const owner = ownedSessions.get(invocation.sessionId);
      if (!owner || owner.questionId !== activeRef.current?.id) throw new Error('T10 tool invocation is not attributed to the active question');
      // Internal T17 registration handshake, not a model-selected tool call.
      // Keep the application's role/scope manifest intact and out of scoring.
      if (invocation.name === '__manifest') {
        const manifest = await handler(invocation);
        activeRef.current.manifestReceipt = { serializedCharacters: JSON.stringify(manifest).length, sha256: hash(JSON.stringify(manifest)), version: manifest?.version ?? manifest?.contextApiVersion ?? null };
        await activeRef.persist();
        return manifest;
      }
      const current = activeRef.current;
      const call = { sessionKind: owner.kind, name: String(invocation.name).slice(0, 120), callId: String(invocation.callId ?? '').slice(0, 120), args: safe(invocation.args), summary: null };
      current.toolSequence.push({ type: 'tool-call', name: call.name, callId: call.callId, sessionKind: owner.kind });
      if (!permittedTools.has(call.name)) {
        current.prohibitedTools.push({ name: call.name, callId: call.callId });
        proxy.sealQuestion(current.id, 'non-research-tool-attempt');
        throw new Error('This evaluation only allows read-only research/context tools.');
      }
      const result = await handler(invocation);
      call.resultMetrics = resultMetrics(result);
      if (call.name === 'research_search') {
        call.summary = { mode: result?.mode ?? null, fallbackReason: result?.fallbackReason ?? null, hits: (result?.hits ?? []).map(hit => ({ cite: hit.cite ?? null, ref: hit.ref ?? null })) };
        current.researchModes.push({ mode: result?.mode ?? null, fallbackReason: result?.fallbackReason ?? null, citations: call.summary.hits.map(hit => hit.cite).filter(Boolean) });
      } else if (call.name === 'research_read') call.summary = { cite: result?.cite ?? null, ref: result?.ref ?? null, page: result?.page ?? null, characters: String(result?.text ?? result?.body ?? '').length };
      else call.summary = { results: Array.isArray(result?.results) ? result.results.length : undefined, count: Number.isFinite(result?.count) ? result.count : undefined };
      current.toolCalls.push(call);
      await activeRef.persist();
      return result;
    }),
    close: async () => { activeRef.shuttingDown = true; await dsh.close(); },
  });
  return host;
}

async function runLive(args, runDir, inputs) {
  const paths = await ensureRunData({ runDir, inputs });
  const modelLink = await ensureModelJunction(paths.dataRoot);
  const resultPath = path.join(runDir, 'results.json');
  const requestLedgerPath = path.join(runDir, 'request-ledger.json');
  const lockPath = path.join(runDir, 'running.lock');
  const selected = args.phase === 'pilot' ? inputs.questions.slice(0, PILOT_SIZE) : selectQuestions(inputs.questions, args.questionIds);
  const globalCap = selected.length * MAX_PER_QUESTION;
  const receiptFiles = ['scripts/context/tools.mjs', 'scripts/context/policy.mjs', 'scripts/context/research-tools.mjs', 'scripts/research-base/index.mjs', 'scripts/research-base/search.mjs', 'scripts/research-base/citations.mjs', 'scripts/research-base/hybrid.mjs', 'scripts/research-base/semantic-service.mjs', 'scripts/evals/hybrid-live-retrieval.mjs'];
  const rulesReceipt = Object.fromEntries(await Promise.all(receiptFiles.map(async file => [file, hash(await readFile(path.join(repo, file)))])));
  let ledger = {
    schema: 2, status: 'RUNNING', createdAt: new Date().toISOString(), phase: args.phase,
    model, promptPrefix: PREFIX, projectId, goldSha256: inputs.goldSha256, mappingSha256: inputs.mappingSha256,
    chunksSha256: inputs.chunksSha256, noGoldAnswersInModelContext: true, maxPerQuestion: MAX_PER_QUESTION,
    budgetUnit: 'effective-model-step', globalEffectiveStepCap: globalCap,
    globalCompletionCap: globalCap * (MAX_TRANSPORT_RETRIES + 1), maxPhysicalRequests: globalCap * (MAX_TRANSPORT_RETRIES + 1), maxTransportRetries: MAX_TRANSPORT_RETRIES,
    questions: [], phases: [], cleanup: null,
    selectedQuestionIds: selected.map(question => question.id), continueAfterQuestionFailure: args.continueAfterQuestionFailure === true, rulesReceipt, contextApiVersion: CONTEXT_API_VERSION,
    upstreamProxy: args.upstreamProxy ?? null,
  };
  let proxy, dsh, api, server, active, shuttingDown = false, lockOwned = false, saveTail = Promise.resolve();
  const activeRef = { get current() { return active; }, shuttingDown: false, persist: () => saveTail };
  const persist = () => {
    const task = saveTail.then(() => atomicWrite(resultPath, ledger));
    saveTail = task.catch(() => {}); return task;
  };
  activeRef.persist = persist;
  activeRef.stopQuestion = async reason => {
    if (!active || active.stopReason) return;
    active.stopReason = reason; proxy?.sealQuestion(active.id, reason); await persist();
    await localJson(activeRef.origin, '/api/chat/stop', { chatId: active.chatId }).catch(() => {});
    await Promise.allSettled(active.sessions.map(session => dsh?.releaseSession(session.sessionId)));
  };
  try {
    if (existsSync(lockPath)) throw new Error('T10 run lock exists; inspect the run before any continuation');
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, phase: args.phase, at: new Date().toISOString() }), { flag: 'wx' });
    lockOwned = true;
    if (existsSync(resultPath)) {
      ledger = JSON.parse(await readFile(resultPath, 'utf8'));
      assert.equal(ledger.schema, 2, 'historical result accounting requires a fresh run');
      assertRunIdentity(ledger, inputs, projectId);
      if (args.phase === 'single-pass') {
        assert.deepEqual(ledger.selectedQuestionIds, selected.map(question => question.id), 'single-pass selection changed');
        assert.deepEqual(ledger.rulesReceipt, rulesReceipt, 'rules or harness changed during this single-pass run');
        assert.equal(ledger.phase, 'single-pass', 'single-pass requires its own run directory');
      }
      if (ledger.questions.some(row => row.status === 'RUNNING')) for (const row of ledger.questions) if (row.status === 'RUNNING') row.status = 'INTERRUPTED_NO_RETRY';
    }
    const pilotQuestions = inputs.questions.slice(0, PILOT_SIZE);
    if (args.phase === 'pilot') assert.ok(ledger.questions.every(row => pilotQuestions.some(question => question.id === row.id)), 'pilot cannot reopen a full run ledger');
    else if (args.phase === 'full') assert.ok(pilotQuestions.every(question => ledger.questions.some(row => row.id === question.id && row.status !== 'RUNNING' && row.status !== 'INTERRUPTED_NO_RETRY')), 'full phase requires a completed pilot; interrupted questions are never retried');

    const previousCounter = existsSync(requestLedgerPath) ? JSON.parse(await readFile(requestLedgerPath, 'utf8')) : null;
    for (const row of ledger.questions) {
      if (row.status === 'RUNNING') row.status = 'INTERRUPTED_NO_RETRY';
      const questionCounter = previousCounter?.questions?.[row.id]?.forwardedCompletions ?? 0;
      if (questionCounter > 0 && !row.requestCount) row.requestCount = questionCounter;
    }
    await persist();
    proxy = await createCappedProxy({ evidencePath: requestLedgerPath, maxCompletionRequests: globalCap, upstreamProxy: args.upstreamProxy, upstreamCredential: secretForRedaction });
    // Only the owned parent proxy holds the live credential; session processes
    // receive a disposable localhost token, never the user's paid gateway key.
    const host = await createLiveHost({ paths, proxy, activeRef, credential: `local-eval-${randomUUID()}`, apiErrors: [] }); dsh = host;
    api = await createDesktopApi({ dataRoot: paths.dataRoot, runtimeHost: host, onError: error => { if (active) active.hostErrors.push({ code: error.code ?? null, name: error.name, message: safe(String(error.message ?? '')) }); } });
    ({ server, origin: activeRef.origin } = await createLocalServer(api));
    await prepareProject(activeRef.origin);
    const semantic = await waitForSemanticReady(activeRef.origin);
    const readySummary = { enabled: semantic.enabled, state: semantic.state, indexed: semantic.indexed, total: semantic.total, mode: semantic.mode ?? null };
    ledger.semantic = readySummary;
    ledger.phases.push({ phase: args.phase, startedAt: new Date().toISOString(), budgetUnit: 'effective-model-step', globalEffectiveStepCap: globalCap, globalCompletionCap: globalCap * (MAX_TRANSPORT_RETRIES + 1), semanticReady: true });
    await persist();

    const eligible = eligibleUnpaidQuestions(selected, ledger.questions, proxy.state);
    for (const question of eligible) {
      if (shuttingDown) break;
      const nonce = randomUUID().replaceAll('-', '');
      active = {
        id: question.id, category: question.category, query: question.query,
        chatId: `t10-${nonce}`, userMessageId: `t10-u-${nonce}`, assistantMessageId: `t10-a-${nonce}`,
        status: 'RUNNING', startedAt: new Date().toISOString(), sessions: [], events: [], toolSequence: [], toolCalls: [], researchModes: [],
        hostErrors: [], providerFailures: [], prohibitedTools: [],
      };
      ledger.questions.push(active);
      await persist(); // durable before POST /api/chat can cause a billable request.
      const questionDeadline = Date.now() + QUESTION_DEADLINE_MS;
      const timer = setTimeout(() => { void activeRef.stopQuestion('QUESTION_DEADLINE_180S'); }, QUESTION_DEADLINE_MS);
      let terminal;
      try {
        const response = await fetch(activeRef.origin + '/api/chat', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chatId: active.chatId, projectId, model, text: `${PREFIX}\n${question.query}`,
            userMessageId: active.userMessageId, assistantMessageId: active.assistantMessageId, executionMode: 'ask', workspaceChoice: { mode: 'new' },
            researchInput: { attachmentIds: [], messageQuotes: [], annotations: [], contextRefs: [] } }),
          signal: AbortSignal.timeout(QUESTION_DEADLINE_MS + 5000),
        });
        assert.equal(response.status, 200, 'chat API rejected the model turn');
        const decoder = new TextDecoder(); let pending = '';
        for await (const bytes of response.body) {
          pending += decoder.decode(bytes, { stream: true });
          let newline;
          while ((newline = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type !== 'text-delta' && event.type !== 'text-replace') active.events.push(safe({ type: event.type, code: event.code ?? null, callId: event.callId ?? null, name: event.name ?? null }));
            if (['completed', 'cancelled', 'failed'].includes(event.type)) terminal = event;
          }
        }
        pending += decoder.decode();
        assert.equal(pending.trim(), '', 'chat API ended with an incomplete NDJSON event');
        active.answer = safe(String(terminal?.text ?? ''));
        active.terminal = terminal?.type ?? 'NO_TERMINAL_EVENT';
        active.usage = await localJson(activeRef.origin, `/api/research/usage?chatId=${encodeURIComponent(active.chatId)}&messageId=${encodeURIComponent(active.assistantMessageId)}`);
        Object.assign(active, await resolveAnswerCitations(active.answer, label => localJson(activeRef.origin,
          `/api/research/cite?label=${encodeURIComponent(label)}&projectId=${encodeURIComponent(projectId)}`)));
        active.status = active.stopReason || active.prohibitedTools.length ? 'FAILED' : terminal?.type === 'completed' && active.answer.trim() ? 'COMPLETED_AUDIT_PENDING' : 'FAILED';
      } catch (error) {
        active.status = 'FAILED'; active.runnerError = { name: error.name, code: error.code ?? null, message: safe(error.message) };
        await activeRef.stopQuestion('RUNNER_FAILURE');
      } finally {
        clearTimeout(timer);
        // Persist first; a crash after this seal still cannot repeat a paid question.
        proxy.sealQuestion(active.id, active.stopReason ?? 'question-finished');
        active.requestCount = structuredClone(proxy.state.questions[active.id] ?? {});
        for (const failure of active.providerFailures) failure.recovered = active.terminal === 'completed';
        active.providerUsage = countUsageEvents(proxy, active.id);
        active.backgroundCompletionCount = active.providerUsage.filter(entry => entry.sessionKind === 'minutes').length;
        active.finishedAt = new Date().toISOString();
        if (!active.stopReason) active.deletedChat = await localJson(activeRef.origin, '/api/chats/delete', { chatId: active.chatId }).then(() => true, () => false);
        await Promise.allSettled(active.sessions.map(session => dsh.releaseSession(session.sessionId)));
        await persist();
        console.log(JSON.stringify({ phase: args.phase, questionId: active.id, status: active.status, researchModes: active.researchModes.map(({ mode, fallbackReason }) => ({ mode, fallbackReason })), completionRequests: active.requestCount.forwardedCompletions ?? 0, effectiveModelSteps: active.requestCount.effectiveModelSteps ?? 0, retryAttempts: active.requestCount.retryAttempts ?? 0 }));
        const fatal = shouldStopBatch({ singlePass: args.continueAfterQuestionFailure, question: active, proxyState: proxy.state });
        active = null;
        if (fatal) break;
      }
      if (!args.continueAfterQuestionFailure && Date.now() > questionDeadline) break;
    }
    const phaseQuestions = selected;
    const finished = phaseQuestions.every(question => ledger.questions.some(row => row.id === question.id && row.status !== 'RUNNING'));
    ledger.status = `${args.phase.toUpperCase()}_${finished ? 'FINISHED' : 'STOPPED'}_AUDIT_PENDING`;
    await persist();
  } finally {
    shuttingDown = true; activeRef.shuttingDown = true;
    const dshClose = await Promise.allSettled([dsh?.close()]);
    await api?.close().catch(() => {});
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await proxy?.close().catch(() => {});
    await rm(path.join(paths.home, '.credentials.yaml'), { force: true });
    ledger.cleanup = { at: new Date().toISOString(), ownedDshClosed: dshClose.every(item => item.status === 'fulfilled'), hostClosed: true, proxyClosed: true, ephemeralProviderCredentialRemoved: true, workspaceKeyPreserved: true };
    if (proxy) { ledger.totalForwardedCompletions = proxy.state.forwardedCompletions; ledger.totalEffectiveModelSteps = proxy.state.effectiveModelSteps; ledger.totalRetryAttempts = proxy.state.retryAttempts; ledger.requestAccountingSchema = proxy.state.schema; }
    await persist();
    if (lockOwned) await rm(lockPath, { force: true });
    await removeOwnedJunction(modelLink);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) { console.log(usage()); return; }
  const inputs = await readInputs();
  const selected = selectQuestions(inputs.questions, args.questionIds);
  const runDir = path.join(outputRoot, args.runName);
  if (!args.authorizedLive) {
    const result = await preflight(runDir, inputs);
    result.selectedQuestionIds = selected.map(question => question.id);
    await atomicWrite(path.join(runDir, 'preflight.json'), result);
    console.log(JSON.stringify(result));
    return result;
  }
  // The sole live credential input, read only after explicit invocation.
  secretForRedaction = (await readFile(LIVE_KEY_PATH, 'utf8')).trim();
  if (secretForRedaction.length < 8) throw new Error('configured live key is missing or invalid');
  await mkdir(runDir, { recursive: true });
  await runLive(args, runDir, inputs);
}

if (isDirect) main().catch(error => {
  console.error(JSON.stringify({ status: 'REFUSED_OR_FAILED', name: error.name, code: error.code ?? null, message: safe(error.message) }));
  process.exitCode = 1;
});
