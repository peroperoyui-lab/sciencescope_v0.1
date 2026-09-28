import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { openApplicationDatabaseSync } from '../application-database.mjs';
import { createResearchBase } from '../research-base/index.mjs';
import { createSemanticService } from '../research-base/semantic-service.mjs';
import { embeddingManifest, embeddingHardware } from '../research-base/model-assets.mjs';
import { createEmbedding } from '../research-base/embedding.mjs';

const SOURCE_DB = path.resolve('.sciencescope-local/temp/t10-validation/retrieval/run-2026-09-27-local-verified/runtime/.sciencescope-local/state/sciencescope.sqlite');
const VALIDATION_ROOT = path.resolve('.sciencescope-local/temp/t10-validation');
const MODEL_DIR = path.resolve('.sciencescope-local/models/multilingual-e5-small');
const SOURCE_COUNT = 500;
const RUN = process.argv.includes('--run');
const jsonLog = (event) => console.log(JSON.stringify(event));
const parse = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };

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
    mode: RUN ? 'run' : 'plan-only',
    runFlag: '--run',
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

let interrupted = false;
process.on('SIGINT', () => { interrupted = true; });
const planInfo = await plan();
if (!RUN) {
  jsonLog(planInfo);
} else {
  async function runLoad() {
  const runDir = await mkdtemp(path.join(VALIDATION_ROOT, 'index-load-'));
  const stateDir = path.join(runDir, 'state');
  await mkdir(stateDir, { recursive: true });
  const modelLink = path.join(stateDir, '.sciencescope-local', 'models', 'multilingual-e5-small');
  await mkdir(path.dirname(modelLink), { recursive: true });
  await symlink(MODEL_DIR, modelLink, 'junction');
  const targetReal = await realpath(MODEL_DIR);
  const linkReal = await realpath(modelLink);
  if (targetReal.toLowerCase() !== linkReal.toLowerCase()) throw new Error('MODEL_JUNCTION_TARGET_MISMATCH');

  const report = {
    ...planInfo,
    runDirectory: runDir,
    result: 'running',
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
  };
  let database;
  let service;
  let databaseClosed = false;
  let closePromise;
  const startedAt = performance.now();
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
      const source = research.store.addSource({
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
      if ((index + 1) % 10 === 0 || index + 1 === SOURCE_COUNT) {
        jsonLog({ phase: 'fixture-copy', sources: fixtureSources, totalSources: SOURCE_COUNT, chunks: fixtureChunks });
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
    // Remove only the junction itself; never recurse through its model-cache target.
    await rm(modelLink, { force: true });
    if (report.totalWallMs == null) report.totalWallMs = Math.round(performance.now() - startedAt);
    await writeReport();
    jsonLog({ phase: 'finished', result: report.result, runDirectory: runDir, sources: report.actualFixtureSourceCount ?? 0, chunks: report.actualFixtureChunkCount ?? 0, indexed: report.indexedDocuments, persisted: report.persistedVectorDocuments, totalWallMs: report.totalWallMs, rssPeakMiB: report.rssPeakMiB, providerRequests: 0, interruption: report.interruption });
  }
  }
  await runLoad();
}
