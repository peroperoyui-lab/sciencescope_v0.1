// Stage 3 retrieval preparation/evaluation harness.
//
// This file is deliberately eval-only.  It imports the real corpus through
// the desktop API and delegates ranking to ResearchBase.search; it must not
// grow a second parser or retrieval implementation.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';
import { createEmbedding } from '../research-base/embedding.mjs';
import { createVectorStore } from '../research-base/vector-store.mjs';
import { embeddingManifest, verifyEmbeddingFiles } from '../research-base/model-assets.mjs';
import { fuseHybridRankings } from '../research-base/hybrid.mjs';
import { createDesktopApi } from '../desktop-api.mjs';
import { openApplicationDatabaseSync } from '../application-database.mjs';
import { createResearchBase } from '../research-base/index.mjs';

export const PAPER_DENOMINATOR = 52;
export const MEMORY_DENOMINATOR = 8;
export const MEMORY_POSITIVE = 5;
export const MEMORY_NEGATIVE = 3;
export const APPROVED_GOLD_SHA256 = '5f1de0c94f388b242286ecde082e3da86c843653533e301e1d6eea6c0f2aa506';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultOut = path.join(repo, '.sciencescope-local', 'temp', 'local-validation-r4', 'final-eval');
const defaultGold = path.join(repo, 'tests', 'fixtures', 'retrieval-eval', 'gold.json');
const defaultApproval = path.join(repo, '.sciencescope-local', 'temp', 'local-validation-r4', 'retrieval-draft', 'USER_APPROVAL.md');
const defaultManifest = path.join(repo, '.sciencescope-local', 'temp', 'local-validation-r4', 'corpus', 'manifest.json');
const defaultFrozenMapping = path.join(defaultOut, 'mapping-frozen.json');
const defaultPreparedDb = path.join(defaultOut, 'runtime', '.sciencescope-local', 'state', 'sciencescope.sqlite');
const defaultT10Out = path.join(repo, '.sciencescope-local', 'temp', 't10-validation', 'retrieval');
const defaultModelDir = path.join(repo, '.sciencescope-local', 'models', 'multilingual-e5-small');
const defaultFirstAnswerAudit = path.join(repo, '.sciencescope-local', 'temp', 'local-validation-r4', 'live-retrieval', 'audit-first26.json');
const defaultLastAnswerAudit = path.join(repo, '.sciencescope-local', 'temp', 'local-validation-r4', 'live-retrieval', 'audit-last26.json');

const json = (value) => JSON.stringify(value, null, 2) + '\n';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const compact = (value) => String(value ?? '').normalize('NFKC').replace(/[\u0000\u200b]/gu, '').replace(/\s+/gu, '');
const asAbsolute = (value, fallback) => path.resolve(repo, value ?? fallback);
const isDirect = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function saveJson(file, value) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, json(value), 'utf8'); }

function usage() {
  return `Usage:
  node scripts/evals/real-corpus-retrieval.mjs prepare [--out DIR] [--gold FILE] [--corpus FILE]
  node scripts/evals/real-corpus-retrieval.mjs keyword --mapping FILE [--out DIR] [--gold FILE]
  node scripts/evals/real-corpus-retrieval.mjs hybrid [--out DIR] [--run NAME] [--mapping FILE] [--database FILE]
  node scripts/evals/real-corpus-retrieval.mjs attach-baseline --results FILE [--mapping FILE]
  node scripts/evals/real-corpus-retrieval.mjs dense   # reserved; intentionally not implemented

prepare is mapping-only: it never reads paper query, answer, or rank fields.
keyword requires a manually reviewed mapping with freezeStatus=FROZEN and the
approved immutable gold SHA. It calls the production ResearchBase.search.
hybrid runs keyword, single-vector, bilingual-vector, and production weighted
hybrid against a backup clone of the prepared corpus DB. It uses local model
files only, writes only beneath .sciencescope-local/temp/t10-validation, and
does not modify gold, mapping, or the Stage 3 baseline.
`;
}

function options(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { out.help = true; continue; }
    if (arg.startsWith('--')) { const key = arg.slice(2); out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; continue; }
    out._.push(arg);
  }
  return out;
}

function httpCall(server, method, route, body) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const req = fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : raw,
    }).then(async (response) => {
      const text = await response.text();
      let value;
      try { value = text ? JSON.parse(text) : {}; } catch { value = { raw: text }; }
      if (!response.ok) throw new Error(`${method} ${route} failed (${response.status}): ${value.message ?? text}`);
      resolve(value);
    }).catch(reject);
    void req;
  });
}

async function createApiServer(dataRoot) {
  const runtimeHost = { listProviders: async () => [], close: async () => {} };
  const api = await createDesktopApi({ dataRoot, runtimeHost });
  const server = createServer((request, response) => { void api.handle(request, response); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { api, server };
}

async function closeApiServer({ api, server }) {
  try { await api.close(); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function openResearch(out) {
  const root = path.join(out, 'runtime');
  const stateDir = path.join(root, '.sciencescope-local', 'state');
  mkdirSync(stateDir, {recursive:true});
  const database = openApplicationDatabaseSync({ stateDir });
  const research = createResearchBase({ database, resolveResourcePath: async (resource) => path.resolve(root, resource.path) });
  return { root, database, research };
}

async function loadInputs({ gold = defaultGold, corpus = defaultManifest, approval = defaultApproval } = {}) {
  const goldBytes = await readFile(gold);
  const goldSha256 = sha256(goldBytes);
  if (goldSha256 !== APPROVED_GOLD_SHA256) throw new Error(`Immutable gold SHA mismatch: ${goldSha256}`);
  await readFile(approval); // approval is a required input, but its prose is not eval data.
  const [goldValue, manifest] = await Promise.all([readJson(gold), readJson(corpus)]);
  const papers = (goldValue.questions ?? []).filter((question) => question.category !== 'memory_synthetic');
  const memories = (goldValue.questions ?? []).filter((question) => question.category === 'memory_synthetic');
  if (papers.length !== PAPER_DENOMINATOR) throw new Error(`Expected ${PAPER_DENOMINATOR} paper questions, got ${papers.length}`);
  if (memories.length !== MEMORY_DENOMINATOR) throw new Error(`Expected ${MEMORY_DENOMINATOR} memory questions, got ${memories.length}`);
  if ((manifest.records ?? []).length !== 8) throw new Error('Expected eight corpus records');
  return { goldValue, goldSha256, manifest, papers, memories };
}

async function importCorpus({ out, manifest, parserVersion }) {
  const mapPath = path.join(out, 'import-map.json');
  try { return await readJson(mapPath); } catch {}
  const { api, server } = await createApiServer(path.join(out, 'runtime'));
  const imported = [];
  const importedAt = new Date().toISOString();
  try {
    for (const record of manifest.records) {
      const startedAt = Date.now();
      const bytes = await readFile(record.corpus_copy_path);
      const resource = await httpCall(server, 'POST', '/api/library/import', {
        name: record.copy,
        projectId: null,
        base64: bytes.toString('base64'),
      });
      imported.push({ documentId: record.id, copy: record.copy, sha256: record.sha256, resourceId: resource.id, importDurationMs: Date.now() - startedAt });
    }
    const syncStartedAt = Date.now();
    await httpCall(server, 'POST', '/api/research/sync', { projectId: null, wait: false });
    const pending = new Set(imported.map((item) => item.resourceId));
    const completedAt = new Map();
    const deadline = syncStartedAt + 120_000;
    while (pending.size && Date.now() < deadline) {
      const result = await httpCall(server, 'GET', '/api/research/sources?limit=1000');
      for (const source of result.sources ?? []) {
        const item = imported.find((candidate) => candidate.resourceId === source.resourceId);
        if (!item || !pending.has(item.resourceId)) continue;
        if (['parsed', 'partial', 'failed', 'unsupported'].includes(source.contentStatus)) {
          item.status = source.contentStatus;
          item.parser = source.parser ?? null;
          item.parseError = source.parseError ?? null;
          item.pages = source.pages ?? null;
          item.durationMs = Date.now() - syncStartedAt;
          completedAt.set(item.resourceId, new Date().toISOString());
          pending.delete(item.resourceId);
        }
      }
      if (pending.size) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const item of imported) {
      if (pending.has(item.resourceId)) {
        item.status = 'failed';
        item.parser = null;
        item.parseError = 'Timed out waiting for /api/research/sync completion';
        item.durationMs = Date.now() - syncStartedAt;
      }
      item.syncStartedAt = new Date(syncStartedAt).toISOString();
      item.completedAt = completedAt.get(item.resourceId) ?? new Date().toISOString();
    }
  } finally { await closeApiServer({ api, server }); }
  const { database, research } = openResearch(out);
  try {
    for (const item of imported) {
      const source = research.store.sourceByResource(item.resourceId);
      if (!source) throw new Error(`No source created for ${item.documentId}`);
      item.sourceId = source.id;
      item.status ??= source.contentStatus;
      item.parser ??= source.parser ?? null;
      item.parseError ??= source.parseError ?? null;
      item.pages ??= source.pages ?? null;
    }
  } finally { database.close(); }
  await saveJson(mapPath, { schema: 2, corpusCount: imported.length, importedAt, parserVersion, documents: imported });
  return { documents: imported };
}

function scoreEvidence(evidence, chunkText) {
  const needle = compact(evidence);
  const haystack = compact(chunkText);
  if (needle && haystack.includes(needle)) return 1;
  if (!needle || !haystack) return 0;
  const windows = [needle.slice(0, 100), needle.slice(-100)].filter((value) => value.length >= 24);
  return windows.reduce((score, window) => score + (haystack.includes(window) ? 0.45 : 0), 0);
}

async function prepare(args) {
  const out = asAbsolute(args.out, defaultOut);
  const gold = asAbsolute(args.gold, defaultGold);
  const corpus = asAbsolute(args.corpus, defaultManifest);
  await mkdir(out, { recursive: true });
  const { goldSha256, manifest, papers, memories } = await loadInputs({ gold, corpus });
  const parserPath = path.join(repo, 'scripts', 'research-base', 'parsers', 'pdf.mjs');
  const parserVersion = { path: 'scripts/research-base/parsers/pdf.mjs', sha256: sha256(await readFile(parserPath)) };
  const imports = await importCorpus({ out, manifest, parserVersion });
  const { database, research } = openResearch(out);
  try {
    const documents = imports.documents.map((item) => ({ ...item, source: research.store.getSource(item.sourceId) }));
    const documentById = new Map(documents.map((item) => [item.documentId, item]));
    const exportedChunks = [];
    for (const document of documents) {
      for (const chunk of research.store.chunksOf(document.sourceId, { limit: 50000 })) {
        exportedChunks.push({ documentId: document.documentId, sourceId: document.sourceId, chunkId: chunk.id, page: chunk.page, section: chunk.section, kind: chunk.kind, text: chunk.text, anchor: chunk.anchor });
      }
    }
    const chunksByDocumentPage = new Map();
    for (const chunk of exportedChunks) {
      const key = `${chunk.documentId}:${chunk.page}`;
      const list = chunksByDocumentPage.get(key) ?? [];
      list.push(chunk); chunksByDocumentPage.set(key, list);
    }
    const mapping = papers.map((question) => {
      const group = chunksByDocumentPage.get(`${question.documentId}:${question.page}`) ?? [];
      const scored = group.map((chunk) => ({ chunk, score: scoreEvidence(question.evidence, chunk.text) }))
        .filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
      const exact = scored.filter((item) => item.score === 1).map((item) => item.chunk.chunkId);
      const candidates = scored.map((item) => item.chunk.chunkId);
      return {
        questionId: question.id,
        documentId: question.documentId,
        sourceId: documentById.get(question.documentId)?.sourceId ?? null,
        page: question.page,
        evidenceSha256: sha256(Buffer.from(String(question.evidence ?? ''), 'utf8')),
        mappingStatus: exact.length === 1 ? 'EXACT' : exact.length > 1 ? 'AMBIGUOUS' : candidates.length ? 'FUZZY_REVIEW' : 'UNMAPPED',
        candidateChunkIds: candidates,
        goldChunkIds: exact,
        method: 'page-and-evidence-containment',
        ambiguity: exact.length > 1 ? 'multiple exact chunks' : null,
        manualReview: { status: 'PENDING', reviewer: null, note: null },
      };
    });
    await saveJson(path.join(out, 'chunks.json'), { schema: 1, source: 'ResearchBase.store.chunksOf', count: exportedChunks.length, chunks: exportedChunks });
    await saveJson(path.join(out, 'mapping-draft.json'), {
      schema: 1,
      freezeStatus: 'DRAFT',
      immutableGoldSha256: goldSha256,
      generatedBy: 'real-corpus-retrieval.mjs prepare',
      paperDenominator: PAPER_DENOMINATOR,
      mapping,
    });
    await saveJson(path.join(out, 'memory-fixtures.json'), {
      schema: 1,
      note: 'Synthetic memory fixtures are separate from paper mapping and paper denominator.',
      records: memories.flatMap((question) => (question.fixtureRecords ?? []).map((record) => ({ ...record, questionId: question.id }))),
    });
    await saveJson(path.join(out, 'prepare-manifest.json'), {
      schema: 1,
      mode: 'PREPARATION_ONLY_NO_SCORING',
      goldSha256,
      parserVersion,
      corpus: manifest.records.map(({ id, copy, sha256: fileSha256, pages, language }) => ({ id, copy, sha256: fileSha256, pages, language })),
      documents: documents.map(({ documentId, copy, source, durationMs, status, parser, parseError, pages }) => ({ documentId, copy, status: status ?? source?.contentStatus ?? 'failed', durationMs: durationMs ?? null, parser: parser ?? source?.parser ?? null, parseError: parseError ?? source?.parseError ?? null, pages: pages ?? source?.pages ?? null })),
      documentCount: documents.length,
      chunkCount: exportedChunks.length,
      paperQuestionCount: papers.length,
      memoryQuestionCount: memories.length,
      mappingStatusCounts: mapping.reduce((counts, row) => ({ ...counts, [row.mappingStatus]: (counts[row.mappingStatus] ?? 0) + 1 }), {}),
    });
    return { out, chunkCount: exportedChunks.length, mappingStatusCounts: mapping.reduce((counts, row) => ({ ...counts, [row.mappingStatus]: (counts[row.mappingStatus] ?? 0) + 1 }), {}) };
  } finally { database.close(); }
}

export function validateFrozenMapping(mapping, { goldSha256, questionIds } = {}) {
  if (mapping.freezeStatus !== 'FROZEN') throw new Error('keyword requires mapping.freezeStatus=FROZEN after manual review');
  if (mapping.immutableGoldSha256 !== goldSha256) throw new Error('Mapping was not created for the immutable approved gold');
  if (!Array.isArray(mapping.mapping) || mapping.mapping.length !== PAPER_DENOMINATOR) throw new Error(`Frozen mapping must contain ${PAPER_DENOMINATOR} paper rows`);
  const expected = [...new Set(questionIds ?? [])];
  if (expected.length !== PAPER_DENOMINATOR) throw new Error(`Approved paper IDs must contain ${PAPER_DENOMINATOR} unique IDs`);
  const actual = mapping.mapping.map((row) => row?.questionId);
  if (actual.some((id) => typeof id !== 'string' || !id)) throw new Error('Frozen mapping contains a missing questionId');
  if (new Set(actual).size !== PAPER_DENOMINATOR) throw new Error('Frozen mapping contains duplicate questionId rows');
  if (actual.some((id) => !expected.includes(id)) || expected.some((id) => !actual.includes(id))) throw new Error('Frozen mapping question IDs do not exactly match approved gold IDs');
  return true;
}

export function recallAt(results, expected, k) { return expected.length > 0 && results.slice(0, k).some((id) => expected.includes(id)); }

export const RETRIEVAL_EVAL_MODES = Object.freeze(['keyword', 'single-vector', 'bilingual-vector', 'weighted-hybrid']);

export function recallMetrics(rows, { ranked = 'topIds', expected = 'expectedIds', denominator = rows.length } = {}) {
  return Object.fromEntries([1, 5, 10].map((k) => [`r${k}`, rows.filter((row) => recallAt(row[ranked] ?? [], row[expected] ?? [], k)).length / denominator]));
}

export function summarizeMemory(rows) {
  const positive = rows.filter((row) => (row.expectedIds ?? []).length > 0);
  const negative = rows.filter((row) => (row.expectedIds ?? []).length === 0);
  return {
    denominator: rows.length,
    positiveDenominator: positive.length,
    negativeDenominator: negative.length,
    positive: recallMetrics(positive),
    negativeNoMatchAccuracy: negative.length ? negative.filter((row) => row.noMatch).length / negative.length : null,
  };
}

export function combinePriorAnswerAudit(first, last, { goldSha256, mappingSha256, questionIds } = {}) {
  for (const [label, audit] of [['first26', first], ['last26', last]]) {
    if (audit.goldSha256 !== goldSha256 || audit.mappingSha256 !== mappingSha256) throw new Error(`Prior ${label} answer audit does not match the approved gold/mapping`);
  }
  const firstRows = (first.questions ?? []).map((row) => ({
    questionId: row.id,
    grade: row.assessment,
    runStatus: row.state ?? null,
    citationsSupported: row.coreCitationSupported ?? null,
  }));
  const lastRows = (last.rows ?? []).map((row) => ({
    questionId: row.id,
    grade: row.coreGrade,
    runStatus: row.rawStatus ?? null,
    citationsSupported: row.coreCitationSupport ?? null,
  }));
  const combined = [...firstRows, ...lastRows];
  const actualIds = combined.map((row) => row.questionId);
  const expectedIds = [...new Set(questionIds ?? [])];
  if (firstRows.length !== 26 || lastRows.length !== 26 || combined.some((row) => !row.questionId || !row.grade) || new Set(actualIds).size !== PAPER_DENOMINATOR) {
    throw new Error('Prior answer audit must contain 52 uniquely graded question rows');
  }
  if (expectedIds.length !== PAPER_DENOMINATOR || actualIds.some((id) => !expectedIds.includes(id)) || expectedIds.some((id) => !actualIds.includes(id))) {
    throw new Error('Prior answer audit IDs do not exactly match the approved paper questions');
  }
  const counts = Object.fromEntries([...new Set(combined.map((row) => row.grade))].sort().map((grade) => [grade, combined.filter((row) => row.grade === grade).length]));
  const full = combined.filter((row) => row.grade === 'full').length;
  if (full !== 43) throw new Error(`Prior audited full-answer baseline is not 43/52 (got ${full}/52)`);
  return { denominator: PAPER_DENOMINATOR, full, fullRate: full / PAPER_DENOMINATOR, counts, rows: combined.sort((a, b) => expectedIds.indexOf(a.questionId) - expectedIds.indexOf(b.questionId)) };
}

export function attachPriorAnswerAudit(result, baselineAnswerAudit, questionIds, sources = []) {
  const expected = [...new Set(questionIds ?? [])];
  const byId = new Map(baselineAnswerAudit.rows.map((row) => [row.questionId, row]));
  if (expected.length !== PAPER_DENOMINATOR || byId.size !== PAPER_DENOMINATOR || expected.some((id) => !byId.has(id))) {
    throw new Error('Historical answer audit cannot be joined to this 52-question retrieval report');
  }
  const paper = Object.fromEntries(Object.entries(result.paper ?? {}).map(([mode, report]) => {
    const rows = report.rows.map((row) => {
      const prior = byId.get(row.questionId);
      if (!prior || !expected.includes(row.questionId)) throw new Error(`Historical audit has no approved question row for ${row.questionId}`);
      return { ...row, priorAnswerGrade: prior.grade };
    });
    if (rows.length !== PAPER_DENOMINATOR || expected.some((id) => !rows.some((row) => row.questionId === id))) throw new Error(`Retrieval mode ${mode} does not contain all 52 approved questions`);
    return [mode, { ...report, rows }];
  }));
  return {
    ...result, paper, noModelAnswersAudited: true,
    baselineAnswerAudit: {
      meaning: 'Historical live-model answer judgments; informational side-by-side only, not generated or re-audited by this offline retrieval run.',
      sources, ...baselineAnswerAudit,
    },
  };
}

export async function cloneDatabaseWithBackup(sourcePath, destinationPath) {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try { await backup(source, destinationPath); }
  finally { source.close(); }
}

export function memoryRecordOptions(record) {
  const status = { confirmed: 'active', candidate: 'proposed', superseded: 'superseded' }[record.status] ?? 'proposed';
  return {
    status,
    // The fixture's project field is the service-level visibility boundary.
    // `memory-private-other-project` additionally uses private visibility;
    // there is no separate private metadata field in Research Base.
    visibility: record.id === 'memory-private-other-project' ? 'private' : 'shared',
    projectId: record.project,
    scope: 'project',
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function rankedIds(rankings) {
  return (rankings ?? []).map((entry) => entry?.ref?.id).filter((id) => typeof id === 'string');
}

async function loadHybridInputs({ gold = defaultGold, mapping = defaultFrozenMapping, corpus = defaultManifest, chunks = path.join(defaultOut, 'chunks.json'), database = defaultPreparedDb } = {}) {
  const [loaded, mappingValue, chunksBytes, corpusValue, dbStat] = await Promise.all([
    loadInputs({ gold, corpus }), readJson(mapping), readFile(chunks), readJson(corpus), stat(database),
  ]);
  validateFrozenMapping(mappingValue, { goldSha256: loaded.goldSha256, questionIds: loaded.papers.map((question) => question.id) });
  const chunksSha256 = sha256(chunksBytes);
  if (mappingValue.inputChunksSha256 !== chunksSha256) throw new Error('Frozen mapping no longer matches the approved prepared chunk projection');
  if (mappingValue.mapping.some((row) => !Array.isArray(row.goldChunkIds) || row.goldChunkIds.length === 0)) throw new Error('Frozen mapping contains an empty gold chunk set');
  if (corpusValue.records.length !== 8 || dbStat.size === 0) throw new Error('Prepared corpus database or manifest is invalid');
  return { ...loaded, mapping: mappingValue, chunks: JSON.parse(chunksBytes.toString('utf8')).chunks, database };
}

async function hybridEval(args) {
  const parentOut = asAbsolute(args.out, defaultT10Out);
  const runId = new Date().toISOString().replace(/[:.]/gu, '-');
  const out = path.join(parentOut, args.run ?? `run-${runId}`);
  const gold = asAbsolute(args.gold, defaultGold);
  const mapping = asAbsolute(args.mapping, defaultFrozenMapping);
  const corpus = asAbsolute(args.corpus, defaultManifest);
  const chunks = asAbsolute(args.chunks, path.join(defaultOut, 'chunks.json'));
  const sourceDb = asAbsolute(args.database, defaultPreparedDb);
  const modelDir = asAbsolute(args['model-dir'], defaultModelDir);
  const firstAuditPath = asAbsolute(args['audit-first'], defaultFirstAnswerAudit);
  const lastAuditPath = asAbsolute(args['audit-last'], defaultLastAnswerAudit);
  const databasePath = path.join(out, 'runtime', '.sciencescope-local', 'state', 'sciencescope.sqlite');
  await mkdir(parentOut, { recursive: true });
  try { await stat(databasePath); throw new Error(`Output run already exists: ${out}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const input = await loadHybridInputs({ gold, mapping, corpus, chunks, database: sourceDb });
  const [firstAudit, lastAudit, mappingBytes] = await Promise.all([readJson(firstAuditPath), readJson(lastAuditPath), readFile(mapping)]);
  const baselineAnswerAudit = combinePriorAnswerAudit(firstAudit, lastAudit, {
    goldSha256: input.goldSha256,
    mappingSha256: sha256(mappingBytes),
    questionIds: input.papers.map((question) => question.id),
  });
  const manifest = await embeddingManifest();
  if (!(await verifyEmbeddingFiles(modelDir, manifest))) throw new Error(`Pinned local embedding model is missing or failed checksum validation: ${modelDir}`);

  await cloneDatabaseWithBackup(sourceDb, databasePath);
  const { database, research } = openResearch(out);
  const embedding = createEmbedding({ modelDir, modelId: manifest.modelId, modelVersion: manifest.revision });
  let vector = null;
  try {
    const modelWarmupStartedAt = performance.now();
    await embedding.warmup();
    const modelWarmupMs = Number((performance.now() - modelWarmupStartedAt).toFixed(3));
    vector = await createVectorStore({ dbPath: database.dbPath, embedding, modelId: manifest.modelId, modelVersion: manifest.revision, dimensions: manifest.dimensions ?? 384 });

    const chunkRows = database.db.prepare(`SELECT c.id,c.text,s.updated_at FROM rb_chunks c JOIN rb_sources s ON s.id=c.source_id ORDER BY s.id,c.ordinal`).all();
    const preparedChunkIds = new Set(input.chunks.map((chunk) => chunk.chunkId));
    const clonedChunkIds = new Set(chunkRows.map((chunk) => chunk.id));
    if (preparedChunkIds.size !== input.chunks.length || clonedChunkIds.size !== chunkRows.length || preparedChunkIds.size !== clonedChunkIds.size || [...preparedChunkIds].some((id) => !clonedChunkIds.has(id))) {
      throw new Error('Prepared chunk projection and cloned production database do not match exactly');
    }
    if (input.mapping.mapping.some((row) => row.goldChunkIds.some((id) => !clonedChunkIds.has(id)))) throw new Error('Frozen gold mapping references a chunk absent from the cloned database');
    const indexStartedAt = performance.now();
    const indexReceipt = await vector.upsertDocuments(chunkRows.map((row) => ({ ref: { type: 'chunk', id: row.id }, version: row.updated_at, text: row.text })));
    const passageEmbeddingMs = Number((performance.now() - indexStartedAt).toFixed(3));
    const paperCandidates = research.retrieval.listCandidates({ projectId: null, docTypes: ['chunk'], audience: 'user', includePersonal: false });
    const candidateKeys = new Set(paperCandidates.map(({ ref }) => `${ref.type}:${ref.id}`));
    research.retrieval.setVectorRetriever(vector);
    const frozenByQuestion = new Map(input.mapping.mapping.map((row) => [row.questionId, row]));
    const timings = Object.fromEntries(RETRIEVAL_EVAL_MODES.map((mode) => [mode, []]));
    const paperByMode = Object.fromEntries(RETRIEVAL_EVAL_MODES.map((mode) => [mode, []]));

    for (const question of input.papers) {
      const frozen = frozenByQuestion.get(question.id);
      if (!frozen) throw new Error(`Frozen mapping is missing ${question.id}`);
      const querySet = [question.query.zh, question.query.en];
      const results = {};
      let startedAt = performance.now();
      const keywordHits = research.retrieval.search({ query: question.query.zh, docTypes: ['chunk'], projectId: null, includePersonal: false, k: 10 });
      results.keyword = { ids: keywordHits.map((hit) => hit.ref.id), fallbackReason: null };
      timings.keyword.push(performance.now() - startedAt);

      startedAt = performance.now();
      const single = await vector.search({ queries: [question.query.zh], candidates: paperCandidates, limit: 10 });
      results['single-vector'] = { ids: single.fallbackReason ? [] : rankedIds(single.rankings?.[0]), fallbackReason: single.fallbackReason ?? null };
      timings['single-vector'].push(performance.now() - startedAt);

      startedAt = performance.now();
      const bilingual = await vector.search({ queries: querySet, candidates: paperCandidates, limit: 10 });
      const bilingualRows = bilingual.fallbackReason ? [] : fuseHybridRankings({ vectorRankings: bilingual.rankings, keywordRankings: [], allowedRefs: candidateKeys, limit: 10, vectorWeight: 1, keywordWeight: 0 });
      results['bilingual-vector'] = { ids: bilingualRows.map(({ ref }) => ref.id), fallbackReason: bilingual.fallbackReason ?? null };
      timings['bilingual-vector'].push(performance.now() - startedAt);

      startedAt = performance.now();
      const hybrid = await research.retrieval.searchHybrid({ query: querySet[0], queries: [querySet[1]], docTypes: ['chunk'], projectId: null, includePersonal: false, audience: 'user', k: 10 });
      results['weighted-hybrid'] = { ids: hybrid.hits.map((hit) => hit.ref.id), fallbackReason: hybrid.fallbackReason ?? null, mode: hybrid.mode };
      timings['weighted-hybrid'].push(performance.now() - startedAt);

      for (const mode of RETRIEVAL_EVAL_MODES) {
        const result = results[mode];
        paperByMode[mode].push({
          questionId: question.id, category: question.category, mappingStatus: frozen.mappingStatus,
          expectedIds: frozen.goldChunkIds, topIds: result.ids, mode: result.mode ?? (result.fallbackReason ? 'keyword' : mode), fallbackReason: result.fallbackReason,
          durationMs: Number(timings[mode].at(-1).toFixed(3)), priorAnswerGrade: baselineAnswerAudit.rows.find((row) => row.questionId === question.id)?.grade ?? null,
        });
      }
    }

    const paper = Object.fromEntries(RETRIEVAL_EVAL_MODES.map((mode) => {
      const rows = paperByMode[mode];
      const values = timings[mode].map((value) => Number(value.toFixed(3)));
      return [mode, { denominator: PAPER_DENOMINATOR, metrics: recallMetrics(rows), timingsMs: { values, p50: percentile(values, 0.5), p95: percentile(values, 0.95) }, rows }];
    }));

    const memoryRowsByMode = Object.fromEntries(RETRIEVAL_EVAL_MODES.map((mode) => [mode, []]));
    for (const question of input.memories) {
      const caseOut = path.join(out, 'memory-cases', question.id);
      const caseDb = openResearch(caseOut);
      let caseVector = null;
      try {
        for (const record of question.fixtureRecords ?? []) {
          if (!caseDb.research.store.getItem(record.id)) {
            const options = memoryRecordOptions(record);
            caseDb.research.store.createItem({ id: record.id, type: 'memory', subtype: 'decision', projectId: options.projectId, scope: options.scope, title: record.id, body: record.content, visibility: options.visibility }, { status: options.status });
          }
        }
        caseVector = await createVectorStore({ dbPath: caseDb.database.dbPath, embedding, modelId: manifest.modelId, modelVersion: manifest.revision, dimensions: manifest.dimensions ?? 384 });
        const memoryDocs = caseDb.database.db.prepare("SELECT id,title,body,body_json,revision FROM rb_items WHERE status NOT IN ('proposed','rejected') ORDER BY id").all();
        await caseVector.upsertDocuments(memoryDocs.map((row) => ({ ref: { type: 'item', id: row.id }, version: String(row.revision), text: [row.title, row.body, row.body_json === '{}' ? '' : row.body_json].filter(Boolean).join('\n') })));
        const scoped = { projectId: 'local-validation-r4', audience: 'agent', includePersonal: true, docTypes: ['item'], itemTypes: ['memory'] };
        const candidates = caseDb.research.retrieval.listCandidates(scoped);
        const allowed = new Set(candidates.map(({ ref }) => `${ref.type}:${ref.id}`));
        caseDb.research.retrieval.setVectorRetriever(caseVector);
        const perMode = {};
        let startedAt = performance.now();
        perMode.keyword = { ids: caseDb.research.retrieval.search({ query: question.query.zh, ...scoped, k: 10 }).map((hit) => hit.ref.id), fallbackReason: null };
        perMode.keyword.durationMs = Number((performance.now() - startedAt).toFixed(3));
        startedAt = performance.now();
        const single = await caseVector.search({ queries: [question.query.zh], candidates, limit: 10 });
        perMode['single-vector'] = { ids: single.fallbackReason ? [] : rankedIds(single.rankings?.[0]), fallbackReason: single.fallbackReason ?? null, durationMs: Number((performance.now() - startedAt).toFixed(3)) };
        startedAt = performance.now();
        const bilingual = await caseVector.search({ queries: [question.query.zh, question.query.en], candidates, limit: 10 });
        const bilingualRows = bilingual.fallbackReason ? [] : fuseHybridRankings({ vectorRankings: bilingual.rankings, keywordRankings: [], allowedRefs: allowed, limit: 10, vectorWeight: 1, keywordWeight: 0 });
        perMode['bilingual-vector'] = { ids: bilingualRows.map(({ ref }) => ref.id), fallbackReason: bilingual.fallbackReason ?? null, durationMs: Number((performance.now() - startedAt).toFixed(3)) };
        startedAt = performance.now();
        const hybrid = await caseDb.research.retrieval.searchHybrid({ query: question.query.zh, queries: [question.query.en], ...scoped, k: 10 });
        perMode['weighted-hybrid'] = { ids: hybrid.hits.map((hit) => hit.ref.id), fallbackReason: hybrid.fallbackReason ?? null, mode: hybrid.mode, durationMs: Number((performance.now() - startedAt).toFixed(3)) };
        const expectedIds = question.expectedMemoryIds ?? [];
        for (const mode of RETRIEVAL_EVAL_MODES) {
          const result = perMode[mode];
          memoryRowsByMode[mode].push({ questionId: question.id, expectedIds, topIds: result.ids, noMatch: result.ids.length === 0, fallbackReason: result.fallbackReason, mode: result.mode ?? (result.fallbackReason ? 'keyword' : mode), durationMs: result.durationMs });
        }
      } finally { await caseVector?.close(); caseDb.database.close(); }
    }

    const memory = Object.fromEntries(RETRIEVAL_EVAL_MODES.map((mode) => {
      const rows = memoryRowsByMode[mode];
      const values = rows.map((row) => row.durationMs);
      return [mode, {
        ...summarizeMemory(rows), timingsMs: { values, p50: percentile(values, 0.5), p95: percentile(values, 0.95) }, rows,
      }];
    }));
    const result = {
      schema: 2, mode: 'offline-production-hybrid-eval', goldSha256: input.goldSha256, noModelAnswersAudited: true,
      mapping: { path: mapping, sha256: sha256(await readFile(mapping)), chunksSha256: sha256(await readFile(chunks)), frozenAt: input.mapping.frozenAt },
      corpus: { papers: PAPER_DENOMINATOR, memoryCases: MEMORY_DENOMINATOR, chunks: chunkRows.length, sourceDatabase: sourceDb, clonedDatabase: databasePath },
      baselineAnswerAudit: {
        meaning: 'Historical live-model answer judgments; informational side-by-side only, not generated or re-audited by this offline retrieval run.',
        sources: [firstAuditPath, lastAuditPath], ...baselineAnswerAudit,
      },
      model: { id: manifest.modelId, revision: manifest.revision, directory: modelDir, localOnly: true, warmupMs: modelWarmupMs },
      indexing: { passageEmbeddingMs, vectorsIndexed: indexReceipt.indexed, vectorsSkipped: indexReceipt.skipped },
      policy: { keyword: 'gold.query.zh', singleVector: 'gold.query.zh', bilingualVector: ['gold.query.zh', 'gold.query.en'], weightedHybrid: ['gold.query.zh', 'gold.query.en'], vectorQueriesFusedWith: 'ResearchBase shared weighted RRF; no custom ranking implementation' },
      paper, memory,
    };
    await saveJson(path.join(out, 'hybrid-results.json'), result);
    const summary = {
      out, results: path.join(out, 'hybrid-results.json'), database: databasePath,
      goldSha256: input.goldSha256, noModelAnswersAudited: true, model: result.model, indexing: result.indexing,
      historicalBaselineFull: `${baselineAnswerAudit.full}/${baselineAnswerAudit.denominator}`,
      paper: Object.fromEntries(RETRIEVAL_EVAL_MODES.map((mode) => [mode, {
        metrics: paper[mode].metrics, p50Ms: paper[mode].timingsMs.p50, p95Ms: paper[mode].timingsMs.p95,
        fallbackRows: paper[mode].rows.filter((row) => row.fallbackReason).length,
      }])),
      memory: Object.fromEntries(RETRIEVAL_EVAL_MODES.map((mode) => [mode, {
        positive: memory[mode].positive, negativeNoMatchAccuracy: memory[mode].negativeNoMatchAccuracy,
        p50Ms: memory[mode].timingsMs.p50, p95Ms: memory[mode].timingsMs.p95,
      }])),
      fallbackReasons: Object.fromEntries(RETRIEVAL_EVAL_MODES.map((mode) => [mode,
        [...new Set([...paper[mode].rows, ...memory[mode].rows].map((row) => row.fallbackReason).filter(Boolean))],
      ])),
    };
    await saveJson(path.join(out, 'hybrid-summary.json'), summary);
    return summary;
  } finally {
    await vector?.close();
    await embedding.close();
    database.close();
  }
}

async function attachBaseline(args) {
  if (!args.results) throw new Error('attach-baseline requires --results FILE');
  const resultPath = asAbsolute(args.results, null);
  const [result, goldBytes, mappingBytes] = await Promise.all([readJson(resultPath), readFile(asAbsolute(args.gold, defaultGold)), readFile(asAbsolute(args.mapping, defaultFrozenMapping))]);
  const goldSha256 = sha256(goldBytes);
  if (goldSha256 !== APPROVED_GOLD_SHA256 || result.goldSha256 !== goldSha256) throw new Error('Retrieval report does not use the approved immutable gold');
  const goldValue = JSON.parse(goldBytes);
  const papers = (goldValue.questions ?? []).filter((question) => question.category !== 'memory_synthetic');
  const mappingValue = JSON.parse(mappingBytes);
  validateFrozenMapping(mappingValue, { goldSha256, questionIds: papers.map((question) => question.id) });
  const mappingSha256 = sha256(mappingBytes);
  const [firstPath, lastPath] = [asAbsolute(args['audit-first'], defaultFirstAnswerAudit), asAbsolute(args['audit-last'], defaultLastAnswerAudit)];
  const [first, last] = await Promise.all([readJson(firstPath), readJson(lastPath)]);
  const baseline = combinePriorAnswerAudit(first, last, { goldSha256, mappingSha256, questionIds: papers.map((question) => question.id) });
  const enriched = attachPriorAnswerAudit(result, baseline, papers.map((question) => question.id), [firstPath, lastPath]);
  await saveJson(resultPath, enriched);
  const summaryPath = path.join(path.dirname(resultPath), 'hybrid-summary.json');
  try {
    const summary = await readJson(summaryPath);
    summary.historicalBaselineFull = `${baseline.full}/${baseline.denominator}`;
    summary.noModelAnswersAudited = true;
    await saveJson(summaryPath, summary);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { results: resultPath, historicalBaselineFull: `${baseline.full}/${baseline.denominator}`, gradeCounts: baseline.counts, perQuestionRows: baseline.rows.length, noModelAnswersAudited: true };
}

async function keyword(args) {
  const out = asAbsolute(args.out, defaultOut);
  const gold = asAbsolute(args.gold, defaultGold);
  const mappingPath = asAbsolute(args.mapping, path.join(out, 'mapping-frozen.json'));
  const { goldSha256, papers, memories } = await loadInputs({ gold });
  const mapping = await readJson(mappingPath);
  validateFrozenMapping(mapping, { goldSha256, questionIds: papers.map((question) => question.id) });
  const byQuestion = new Map(mapping.mapping.map((row) => [row.questionId, row]));
  const { database, research } = openResearch(out);
  try {
    const paperRows = papers.map((question) => {
      const frozen = byQuestion.get(question.id);
      const startedAt = performance.now();
      const hits = research.retrieval.search({ query: question.query.zh, docTypes: ['chunk'], projectId: null, k: 10 });
      const ids = hits.map((hit) => hit.ref.id);
      return { questionId: question.id, category: question.category, mappingStatus: frozen.mappingStatus, expectedChunkIds: frozen.goldChunkIds, topChunkIds: ids, durationMs: Number((performance.now() - startedAt).toFixed(3)), recall: { r1: recallAt(ids, frozen.goldChunkIds, 1), r5: recallAt(ids, frozen.goldChunkIds, 5), r10: recallAt(ids, frozen.goldChunkIds, 10) } };
    });
    const metrics = Object.fromEntries(['r1', 'r5', 'r10'].map((key) => [key, paperRows.filter((row) => row.recall[key]).length / PAPER_DENOMINATOR]));
    const paperTimings = paperRows.map((row) => row.durationMs);
    const positive = memories.filter((question) => (question.expectedMemoryIds ?? []).length > 0);
    const negative = memories.filter((question) => (question.expectedMemoryIds ?? []).length === 0);
    const memoryRows = [];
    for (const question of memories) {
      const caseOut = path.join(out, 'memory-cases', question.id);
      const caseDb = openResearch(caseOut);
      for (const record of question.fixtureRecords ?? []) {
        if (!caseDb.research.store.getItem(record.id)) {
          const options = memoryRecordOptions(record);
          caseDb.research.store.createItem({ id: record.id, type: 'memory', subtype: 'decision', projectId: options.projectId, scope: options.scope, title: record.id, body: record.content, visibility: options.visibility }, { status: options.status });
        }
      }
      try {
        const hits = caseDb.research.retrieval.search({ query: question.query.zh, docTypes: ['item'], itemTypes: ['memory'], projectId: 'local-validation-r4', audience: 'agent', k: 10 });
        const ids = hits.map((hit) => hit.ref.id);
        const expected = question.expectedMemoryIds ?? [];
        memoryRows.push({ questionId: question.id, expectedMemoryIds: expected, topMemoryIds: ids, recall: { r1: recallAt(ids, expected, 1), r5: recallAt(ids, expected, 5), r10: recallAt(ids, expected, 10) }, noMatch: ids.length === 0 });
      } finally { caseDb.database.close(); }
    }
    const memoryPositiveRows = memoryRows.filter((row) => positive.some((question) => question.id === row.questionId));
    const memoryNegativeRows = memoryRows.filter((row) => negative.some((question) => question.id === row.questionId));
    const result = {
      schema: 1,
      mode: 'keyword',
      goldSha256,
      queryPolicy: 'gold.query.zh (immutable)',
      paper: { denominator: PAPER_DENOMINATOR, metrics, timingsMs: { values: paperTimings, p50: percentile(paperTimings, 0.5), p95: percentile(paperTimings, 0.95) }, rows: paperRows },
      memory: {
        denominator: MEMORY_DENOMINATOR,
        positiveDenominator: MEMORY_POSITIVE,
        negativeDenominator: MEMORY_NEGATIVE,
        positiveR1: memoryPositiveRows.filter((row) => row.recall.r1).length / MEMORY_POSITIVE,
        positiveR5: memoryPositiveRows.filter((row) => row.recall.r5).length / MEMORY_POSITIVE,
        positiveR10: memoryPositiveRows.filter((row) => row.recall.r10).length / MEMORY_POSITIVE,
        negativeNoMatchAccuracy: memoryNegativeRows.filter((row) => row.noMatch).length / MEMORY_NEGATIVE,
        rows: memoryRows,
      },
    };
    await saveJson(path.join(out, 'keyword-results.json'), result);
    return result;
  } finally { database.close(); }
}

export async function main(argv = process.argv.slice(2)) {
  const args = options(argv);
  if (args.help || !args._[0]) { console.log(usage()); return; }
  if (args._[0] === 'prepare') { console.log(JSON.stringify(await prepare(args))); return; }
  if (args._[0] === 'keyword') { console.log(JSON.stringify(await keyword(args))); return; }
  if (args._[0] === 'hybrid') { console.log(JSON.stringify(await hybridEval(args))); return; }
  if (args._[0] === 'attach-baseline') { console.log(JSON.stringify(await attachBaseline(args))); return; }
  if (args._[0] === 'dense') throw new Error('dense mode is reserved for the later local-model benchmark; no network or formal scoring is performed here');
  throw new Error(`Unknown mode: ${args._[0]}\n${usage()}`);
}

if (isDirect) main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
