import path from 'node:path';
import os from 'node:os';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openApplicationDatabaseSync } from '../application-database.mjs';
import { createResearchBase } from '../research-base/index.mjs';
import { createSemanticService } from '../research-base/semantic-service.mjs';
import { embeddingManifest, embeddingHardware } from '../research-base/model-assets.mjs';
import { createEmbedding } from '../research-base/embedding.mjs';

const SOURCE_DB = path.resolve('.sciencescope-local/temp/t10-validation/retrieval/run-2026-09-27-local-verified/runtime/.sciencescope-local/state/sciencescope.sqlite');
const VALIDATION_ROOT = path.resolve('.sciencescope-local/temp/t10-validation');
const MODEL_DIR = path.resolve('.sciencescope-local/models/multilingual-e5-small');
const SOURCE_COUNT = 500;
const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const argv = invokedAsScript ? process.argv.slice(2) : [];
let RUN = false;
let resumeArgument = null;
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === '--run' && !RUN && resumeArgument == null) RUN = true;
  else if (argv[index] === '--resume' && !RUN && resumeArgument == null && argv[index + 1] && !argv[index + 1].startsWith('--')) {
    resumeArgument = argv[++index];
  } else throw new Error('USAGE:node scripts/evals/hybrid-index-load.mjs [--run | --resume <runDirectory>]');
}
const RESUME = resumeArgument != null;
const jsonLog = (event) => console.log(JSON.stringify(event));
const parse = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };

const normalizedPath = (value) => path.resolve(value).replace(/[\\/]+$/, '').toLowerCase();

export async function validateResumeDirectory(input, validationRoot = VALIDATION_ROOT) {
  const rootReal = await realpath(validationRoot);
  const runDir = path.resolve(input);
  if (!/^index-load-[^\\/]+$/i.test(path.basename(runDir))
    || normalizedPath(path.dirname(runDir)) !== normalizedPath(rootReal)) {
    throw new Error('RESUME_PATH_OUTSIDE_VALIDATION_ROOT');
  }
  const stat = await lstat(runDir).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new Error('RESUME_RUN_DIRECTORY_INVALID');
  const runReal = await realpath(runDir);
  if (normalizedPath(runReal) !== normalizedPath(runDir)
    || normalizedPath(path.dirname(runReal)) !== normalizedPath(rootReal)) {
    throw new Error('RESUME_PATH_OUTSIDE_VALIDATION_ROOT');
  }
  const stateDir = path.join(runDir, 'state');
  const stateStat = await lstat(stateDir).catch(() => null);
  if (!stateStat?.isDirectory() || stateStat.isSymbolicLink()) throw new Error('RESUME_STATE_DIRECTORY_INVALID');
  const dbPath = path.join(stateDir, 'sciencescope.sqlite');
  const dbStat = await lstat(dbPath).catch(() => null);
  if (!dbStat?.isFile() || dbStat.isSymbolicLink()) throw new Error('RESUME_DATABASE_INVALID');
  if (normalizedPath(await realpath(dbPath)) !== normalizedPath(dbPath)) throw new Error('RESUME_DATABASE_INVALID');
  return { runDir, stateDir, dbPath };
}

export function validateFixtureRows({ sourceRows, chunkRows, corpus, sourceCount = SOURCE_COUNT }) {
  const expectedSource = (source, template, index) => (
    source.id === `src_t10load_${String(index + 1).padStart(4, '0')}`
    && source.project_id === 't10_load_fixture'
    && source.kind === template.kind
    && source.title === template.title
    && source.authors_json === JSON.stringify(parse(template.authors_json, []))
    && source.year === template.year
    && source.venue === template.venue
    && source.abstract === template.abstract
    && source.language === template.language
    && source.content_status === 'parsed'
  );
  if (sourceRows.length > sourceCount) throw new Error('RESUME_FIXTURE_SOURCE_COUNT_MISMATCH');
  const sourcesById = new Map(sourceRows.map((source) => [source.id, source]));
  if (sourcesById.size !== sourceRows.length) throw new Error('RESUME_FIXTURE_DUPLICATE_SOURCE');
  const chunksBySource = new Map();
  for (const chunk of chunkRows) {
    if (!sourcesById.has(chunk.source_id)) throw new Error('RESUME_FIXTURE_ORPHAN_CHUNK');
    const rows = chunksBySource.get(chunk.source_id) ?? [];
    rows.push(chunk);
    chunksBySource.set(chunk.source_id, rows);
  }
  let completeSourceCount = 0;
  let sourceOnlyIndex = null;
  let chunkCount = 0;
  for (let index = 0; index < sourceRows.length; index += 1) {
    const source = sourceRows[index];
    const template = corpus[index % corpus.length];
    if (!expectedSource(source, template, index)) throw new Error(`RESUME_FIXTURE_SOURCE_MISMATCH:${source.id}`);
    const expectedId = `src_t10load_${String(index + 1).padStart(4, '0')}`;
    if (source.id !== expectedId) throw new Error(`RESUME_FIXTURE_SOURCE_ORDER_MISMATCH:${source.id}`);
    const actualChunks = chunksBySource.get(source.id) ?? [];
    const expectedChunks = template.chunks;
    if (actualChunks.length === 0 && source.parser == null && index === sourceRows.length - 1) {
      sourceOnlyIndex = index;
      continue;
    }
    if (source.parser !== 't10-load-fixture' || actualChunks.length !== expectedChunks.length) {
      throw new Error(`RESUME_FIXTURE_CHUNK_COUNT_OR_PARSER_MISMATCH:${source.id}`);
    }
    for (let chunkIndex = 0; chunkIndex < expectedChunks.length; chunkIndex += 1) {
      const actual = actualChunks[chunkIndex];
      const expected = expectedChunks[chunkIndex];
      if (!actual || actual.ordinal !== chunkIndex || actual.id !== `${source.id}-c${chunkIndex}`
        || actual.page !== expected.page || actual.section !== expected.section || actual.kind !== expected.kind
        || actual.text !== expected.text || actual.char_start !== expected.char_start || actual.char_end !== expected.char_end
        || actual.anchor_json !== expected.anchor_json) {
        throw new Error(`RESUME_FIXTURE_CHUNK_MISMATCH:${source.id}:${chunkIndex}`);
      }
    }
    completeSourceCount += 1;
    chunkCount += actualChunks.length;
  }
  for (let index = 0; index < sourceRows.length; index += 1) {
    if (sourceRows[index].id !== `src_t10load_${String(index + 1).padStart(4, '0')}`) {
      throw new Error(`RESUME_FIXTURE_SOURCE_ORDER_MISMATCH:${sourceRows[index].id}`);
    }
  }
  if (sourceOnlyIndex != null && sourceOnlyIndex !== sourceRows.length - 1) throw new Error('RESUME_FIXTURE_NONTERMINAL_PARTIAL_SOURCE');
  return { completeSourceCount, sourceOnlyIndex, sourceCount: sourceRows.length, chunkCount };
}

export function fixtureDisposition(index, fixtureState, resume) {
  if (!resume) return 'add';
  if (index < fixtureState.sourceCount) return fixtureState.sourceOnlyIndex === index ? 'repair' : 'reuse';
  return 'add';
}

export function assertResumeMetadata(report, planInfo, runDir) {
  const equalFields = ['sourceDatabase', 'frozenSourceCount', 'frozenChunkCount', 'fixtureSourceCount', 'fixtureChunkCount',
    'expectedVectorCount', 'modelId', 'modelRevision', 'dimensions'];
  if (!report || !['running', 'partial-fixtures'].includes(report.result) || report.mode !== 'run'
    || normalizedPath(report.runDirectory ?? '') !== normalizedPath(runDir)
    || report.indexedDocuments !== 0
    || equalFields.some((field) => report[field] !== planInfo[field])) {
    throw new Error('RESUME_RUN_METADATA_MISMATCH');
  }
}

async function loadFrozenCorpus() {
  const db = new DatabaseSync(SOURCE_DB, { readOnly: true });
  try {
    const sources = db.prepare(`SELECT id,kind,title,authors_json,year,venue,abstract,language
      FROM rb_sources ORDER BY id`).all();
    const chunks = db.prepare(`SELECT source_id,ordinal,page,section,kind,text,char_start,char_end,anchor_json
      FROM rb_chunks ORDER BY source_id,ordinal`).all();
    if (sources.length !== 8 || chunks.length !== 1412) {
      throw new Error(`FROZEN_CORPUS_MISMATCH:sources=${sources.length}:chunks=${chunks.length}`);
    }
    const bySource = new Map(sources.map((source) => [source.id, []]));
    for (const chunk of chunks) {
      const rows = bySource.get(chunk.source_id);
      if (!rows) throw new Error('FROZEN_CORPUS_ORPHAN_CHUNK');
      rows.push(chunk);
    }
    if ([...bySource.values()].some((rows) => rows.length === 0)) throw new Error('FROZEN_CORPUS_EMPTY_SOURCE');
    return sources.map((source) => ({ ...source, chunks: bySource.get(source.id) }));
  } finally { db.close(); }
}

async function plan() {
  const corpus = await loadFrozenCorpus();
  const chunksPerSource = corpus.map((source) => source.chunks.length);
  const totalChunks = Array.from({ length: SOURCE_COUNT }, (_, index) => chunksPerSource[index % corpus.length]).reduce((sum, count) => sum + count, 0);
  const manifest = await embeddingManifest();
  return {
    mode: RUN || RESUME ? (RESUME ? 'resume' : 'run') : 'plan-only',
    runFlag: RESUME ? '--resume <runDirectory>' : '--run',
    sourceDatabase: SOURCE_DB,
    sourceDatabaseMode: 'read-only',
    frozenSourceCount: corpus.length,
    frozenChunkCount: chunksPerSource.reduce((sum, count) => sum + count, 0),
    fixtureSourceCount: SOURCE_COUNT,
    fixtureChunkCount: totalChunks,
    expectedVectorCount: SOURCE_COUNT + totalChunks,
    fixtureCaveat: 'This is an indexing-load run made by repeating text from 8 papers across 500 independent fixture sources; it is not 500 different real papers.',
    modelId: manifest.modelId,
    modelRevision: manifest.revision,
    dimensions: manifest.dimensions,
    providerRequests: 0,
    environment: { node: process.version, platform: process.platform, arch: process.arch, logicalCpus: os.availableParallelism(), cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem(), embeddingThreads: 2 },
    rssSampleIntervalMs: 1000,
    estimatedDuration: 'about 30 minutes; actual timing is measured during --run',
  };
}

if (invokedAsScript) {
let interrupted = false;
process.on('SIGINT', () => { interrupted = true; });
const planInfo = await plan();
if (!RUN && !RESUME) {
  jsonLog(planInfo);
} else {
  async function runLoad() {
  const startedAt = performance.now();
  const resumeValidationStarted = startedAt;
  const resumePaths = RESUME ? await validateResumeDirectory(resumeArgument) : null;
  const runDir = resumePaths?.runDir ?? await mkdtemp(path.join(VALIDATION_ROOT, 'index-load-'));
  const stateDir = resumePaths?.stateDir ?? path.join(runDir, 'state');
  if (!RESUME) await mkdir(stateDir, { recursive: true });
  let preservedReportPath = null;
  let priorReport = null;
  let resumeFixtureState = null;
  if (RESUME) {
    priorReport = JSON.parse(await readFile(path.join(runDir, 'index-load-result.json'), 'utf8'));
    assertResumeMetadata(priorReport, planInfo, runDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    preservedReportPath = path.join(runDir, `index-load-result-preserved-${timestamp}.json`);
    await copyFile(path.join(runDir, 'index-load-result.json'), preservedReportPath, 1);
    const inspectDb = new DatabaseSync(resumePaths.dbPath, { readOnly: true });
    try {
      const tables = new Set(inspectDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
      const vectorDocs = tables.has('rb_vec_docs') ? inspectDb.prepare('SELECT count(*) AS n FROM rb_vec_docs').get().n : 0;
      const vectorRows = tables.has('rb_vec') ? inspectDb.prepare('SELECT count(*) AS n FROM rb_vec').get().n : 0;
      const enabled = tables.has('rb_embedding_settings')
        ? inspectDb.prepare('SELECT enabled FROM rb_embedding_settings WHERE id=1').get()?.enabled ?? 0 : 0;
      if (vectorDocs !== 0 || vectorRows !== 0 || enabled !== 0) throw new Error('RESUME_SEMANTIC_STAGE_ALREADY_STARTED');
      const sourceRows = inspectDb.prepare(`SELECT id,project_id,kind,title,authors_json,year,venue,abstract,language,content_status,parser
        FROM rb_sources ORDER BY id`).all();
      const chunkRows = inspectDb.prepare(`SELECT id,source_id,ordinal,page,section,kind,text,char_start,char_end,anchor_json
        FROM rb_chunks ORDER BY source_id,ordinal`).all();
      const corpus = await loadFrozenCorpus();
      resumeFixtureState = validateFixtureRows({ sourceRows, chunkRows, corpus });
      priorReport.resumeFixtureState = resumeFixtureState;
      priorReport.resumeDatabaseIntegrity = inspectDb.prepare('PRAGMA integrity_check').get().integrity_check;
      if (priorReport.resumeDatabaseIntegrity !== 'ok') throw new Error('RESUME_DATABASE_INTEGRITY_FAILURE');
    } finally { inspectDb.close(); }
  }
  const modelLink = path.join(stateDir, '.sciencescope-local', 'models', 'multilingual-e5-small');
  const modelDirectory = path.dirname(modelLink);
  const modelBase = path.dirname(modelDirectory);
  for (const directory of [modelBase, modelDirectory]) {
    let directoryStat = await lstat(directory).catch(() => null);
    if (!directoryStat) {
      await mkdir(directory);
      directoryStat = await lstat(directory);
    }
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
      || normalizedPath(await realpath(directory)) !== normalizedPath(directory)) {
      throw new Error('MODEL_JUNCTION_PARENT_INVALID');
    }
  }
  let ownsModelLink = false;
  const existingModelLink = await lstat(modelLink).catch(() => null);
  if (existingModelLink) {
    if (!existingModelLink.isSymbolicLink()) throw new Error('MODEL_JUNCTION_PATH_OCCUPIED');
  } else {
    await symlink(MODEL_DIR, modelLink, 'junction');
    ownsModelLink = true;
  }
  const targetReal = await realpath(MODEL_DIR);
  const linkReal = await realpath(modelLink);
  if (normalizedPath(targetReal) !== normalizedPath(linkReal)) throw new Error('MODEL_JUNCTION_TARGET_MISMATCH');

  const report = {
    ...planInfo,
    mode: 'run',
    runFlag: '--run',
    runDirectory: runDir,
    ...(RESUME ? { resumed: true, preservedPriorReport: preservedReportPath,
      invocation: '--resume <runDirectory>',
      timingScope: 'this resume process only; original process duration and offline time are unknown',
      originalProcessWallMs: null, endToEndWallMs: null } : {}),
    result: 'running',
    ...(RESUME ? { resumedFrom: priorReport.result, resumeFixtureState } : {}),
    fixturePreparationMs: null,
    modelWarmupMs: null,
    setupBeforeWarmupMs: null,
    vectorPreparationMs: null,
    indexingAndVectorWriteMs: null,
    totalWallMs: null,
    indexedDocuments: 0,
    totalDocuments: planInfo.expectedVectorCount,
    persistedVectorDocuments: null,
    rssPeakMiB: Math.round(process.memoryUsage.rss() / 1048576),
    providerRequests: 0,
    interruption: false,
    phases: [],
    sourcesReused: 0,
    sourcesRepaired: 0,
    sourcesAdded: 0,
  };
  let database;
  let service;
  let databaseClosed = false;
  let closePromise;
  report.resumeValidationMs = RESUME ? Math.round(performance.now() - resumeValidationStarted) : 0;
  let phaseStart = startedAt;
  let lastProgress = -1;
  const rssTimer = setInterval(() => {
    report.rssPeakMiB = Math.max(report.rssPeakMiB, Math.round(process.memoryUsage.rss() / 1048576));
  }, 1000);
  rssTimer.unref?.();
  const writeReport = async () => writeFile(path.join(runDir, 'index-load-result.json'), `${JSON.stringify(report, null, 2)}\n`);

  try {
    const corpus = await loadFrozenCorpus();
    const fixtureStarted = performance.now();
    database = openApplicationDatabaseSync({ stateDir });
    const research = createResearchBase({ database, resolveResourcePath: async () => null });
    let fixtureChunks = 0, fixtureSources = 0;
    const fixtureProjectId = 't10_load_fixture';
    for (let index = 0; index < SOURCE_COUNT; index += 1) {
      if (interrupted) break;
      const template = corpus[index % corpus.length];
      const sourceId = `src_t10load_${String(index + 1).padStart(4, '0')}`;
      const disposition = fixtureDisposition(index, resumeFixtureState ?? { sourceCount: 0, sourceOnlyIndex: null }, RESUME);
      if (disposition === 'reuse') {
        fixtureSources += 1;
        fixtureChunks += template.chunks.length;
        report.sourcesReused += 1;
      } else {
        const source = disposition === 'repair' ? { id: sourceId } : research.store.addSource({
          id: sourceId,
          projectId: fixtureProjectId,
          kind: template.kind,
          title: template.title,
          authors: parse(template.authors_json, []),
          year: template.year,
          venue: template.venue,
          abstract: template.abstract,
          language: template.language,
          contentStatus: 'parsed',
        });
        const copy = template.chunks.map((chunk) => ({
          kind: chunk.kind,
          text: chunk.text,
          page: chunk.page,
          section: chunk.section,
          charStart: chunk.char_start,
          charEnd: chunk.char_end,
          anchor: parse(chunk.anchor_json, null),
        }));
        fixtureChunks += research.store.replaceChunks(source.id, copy, { parser: 't10-load-fixture', contentStatus: 'parsed' });
        fixtureSources += 1;
        if (disposition === 'repair') report.sourcesRepaired += 1;
        else report.sourcesAdded += 1;
      }
      if ((index + 1) % 10 === 0 || index + 1 === SOURCE_COUNT) {
        jsonLog({ phase: 'fixture-copy', sources: fixtureSources, totalSources: SOURCE_COUNT, chunks: fixtureChunks,
          reused: report.sourcesReused, repaired: report.sourcesRepaired, added: report.sourcesAdded });
        report.sourcesCopied = fixtureSources;
        report.chunksCopied = fixtureChunks;
        await writeReport();
      }
    }
    report.fixturePreparationMs = Math.round(performance.now() - fixtureStarted);
    report.actualFixtureSourceCount = fixtureSources;
    report.actualFixtureChunkCount = fixtureChunks;
    report.sourcesCopied = fixtureSources;
    report.chunksCopied = fixtureChunks;
    report.totalDocuments = report.actualFixtureSourceCount + fixtureChunks;
    report.phases.push({ phase: 'fixture-preparation', elapsedMs: report.fixturePreparationMs, sources: report.actualFixtureSourceCount, chunks: fixtureChunks });
    if (interrupted || report.actualFixtureSourceCount !== SOURCE_COUNT || fixtureChunks !== planInfo.fixtureChunkCount) {
      report.result = 'partial-fixtures';
      report.interruption = interrupted;
      return;
    }

    const modelConfig = JSON.parse(await readFile(path.join(modelLink, 'config.json'), 'utf8'));
    if (modelConfig.hidden_size !== planInfo.dimensions) throw new Error('MODEL_DIMENSION_MISMATCH');
    let warmupStarted;
    let warmupEnded;
    const embeddingFactory = (options) => {
      const engine = createEmbedding(options);
      return {
        ...engine,
        async warmup() {
          warmupStarted = performance.now();
          const result = await engine.warmup();
          warmupEnded = performance.now();
          report.modelWarmupMs = Math.round(warmupEnded - warmupStarted);
          await writeReport();
          return result;
        },
      };
    };
    service = createSemanticService({
      database,
      store: research.store,
      dataRoot: stateDir,
      hardware: embeddingHardware,
      embeddingFactory,
      onError: (error) => { report.errorCode = error?.code ?? error?.message ?? 'unknown'; },
    });
    await service.start();
    phaseStart = performance.now();
    await service.configure('enable');
    await service.start();
    const setupEnded = performance.now();
    report.setupBeforeWarmupMs = warmupStarted == null ? null : Math.round(warmupStarted - phaseStart);
    report.vectorPreparationMs = warmupEnded == null ? null : Math.round(setupEnded - warmupEnded);
    report.phases.push({ phase: 'model-and-vector-setup', setupBeforeWarmupMs: report.setupBeforeWarmupMs, modelWarmupMs: report.modelWarmupMs, vectorPreparationMs: report.vectorPreparationMs });
    if (interrupted) {
      closePromise = service.close();
      await closePromise;
      report.indexedDocuments = service.status().indexed;
      report.totalDocuments = service.status().total;
      report.persistedVectorDocuments = database.db.prepare('SELECT count(*) AS count FROM rb_vec_docs').get().count;
      report.totalWallMs = Math.round(performance.now() - startedAt);
      report.result = 'interrupted-after-setup';
      report.interruption = true;
      return;
    }

    const indexingStarted = performance.now();
    let done = false;
    let jobError;
    const job = service.idle().then(() => { done = true; }, (error) => { done = true; jobError = error; });
    while (!done) {
      if (interrupted && !closePromise) closePromise = service.close();
      await Promise.race([job, new Promise((resolve) => setTimeout(resolve, 5000))]);
      const state = service.status();
      report.indexedDocuments = state.indexed;
      report.rssPeakMiB = Math.max(report.rssPeakMiB, Math.round(process.memoryUsage.rss() / 1048576));
      if (state.indexed >= lastProgress + 1000 || done || interrupted) {
        lastProgress = state.indexed;
        jsonLog({ phase: 'semantic-index', state: state.state, indexed: state.indexed, total: state.total, rssPeakMiB: report.rssPeakMiB, interrupted });
        await writeReport();
      }
    }
    await job;
    report.indexingAndVectorWriteMs = Math.round(performance.now() - indexingStarted);
    if (jobError) throw jobError;
    if (!closePromise) closePromise = service.close();
    await closePromise;
    report.indexedDocuments = service.status().indexed;
    report.finalSemanticState = service.status().state;
    report.persistedVectorDocuments = database.db.prepare('SELECT count(*) AS count FROM rb_vec_docs').get().count;
    report.aligned = report.indexedDocuments === report.totalDocuments && report.persistedVectorDocuments === report.totalDocuments;
    report.totalWallMs = Math.round(performance.now() - startedAt);
    report.result = interrupted ? 'partial-interrupted' : report.aligned && report.finalSemanticState === 'ready' ? 'pass' : 'count-or-state-mismatch';
    report.interruption = interrupted;
    report.phases.push({ phase: 'indexing-vector-writes', elapsedMs: report.indexingAndVectorWriteMs, indexed: report.indexedDocuments, persisted: report.persistedVectorDocuments });
    await writeReport();
    if (!interrupted && report.result !== 'pass') throw new Error(`LOAD_INDEX_MISMATCH:${report.indexedDocuments}:${report.totalDocuments}:${report.persistedVectorDocuments}`);
  } catch (error) {
    report.result = interrupted ? 'partial-interrupted' : 'failed';
    report.interruption = interrupted;
    report.error = { code: error?.code ?? null, message: String(error?.message ?? error) };
    report.totalWallMs = Math.round(performance.now() - startedAt);
    await writeReport();
    throw error;
  } finally {
    clearInterval(rssTimer);
    if (service && !closePromise) await service.close();
    if (database && !databaseClosed) {
      try { database.close(); databaseClosed = true; } catch { /* keep partial database for inspection */ }
    }
    // Remove only a junction created by this process; never recurse through its model-cache target.
    if (ownsModelLink) await rm(modelLink, { force: true });
    if (report.totalWallMs == null) report.totalWallMs = Math.round(performance.now() - startedAt);
    await writeReport();
    jsonLog({ phase: 'finished', result: report.result, runDirectory: runDir, sources: report.actualFixtureSourceCount ?? 0, chunks: report.actualFixtureChunkCount ?? 0, indexed: report.indexedDocuments, persisted: report.persistedVectorDocuments, totalWallMs: report.totalWallMs, rssPeakMiB: report.rssPeakMiB, providerRequests: 0, interruption: report.interruption });
  }
  }
  await runLoad();
}
}
