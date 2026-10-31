// Synthetic startup probes. Models are scripted, Python execution is stubbed,
// and jobs remain paused behind a foreground turn throughout recovery timing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { seedExtrasFixture } from './p4c-extras.mjs';

const script = fileURLToPath(import.meta.url);
const allowed = fileURLToPath(
  new URL('../../.sciencescope-local/temp/p4c/part5-backend/', import.meta.url),
);
const defaultSource = fileURLToPath(new URL('../../', import.meta.url));
const median = (values) =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
const latestImportsSql = `SELECT json_extract(payload_json,'$.sourceId') AS source_id,max(seq) AS seq
  FROM events WHERE type='research.changed' AND json_extract(payload_json,'$.action')='source.imported'
  GROUP BY json_extract(payload_json,'$.sourceId')`;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function sourceImport(source, file) {
  return import(pathToFileURL(path.join(source, file)).href);
}

async function measureIndexUpgrade(source, fixtureRoot) {
  const [
    { dataPaths },
    { openDatabase },
    { migrations },
    migration,
    { DatabaseSync },
    { constants },
  ] = await Promise.all([
    sourceImport(source, 'app/core/paths.js'),
    sourceImport(source, 'app/core/db/database.js'),
    sourceImport(source, 'app/core/db/migrations/index.js'),
    sourceImport(source, 'app/core/db/migrations/031-source-import-events-index.js'),
    import('node:sqlite'),
    import('node:fs'),
  ]);
  const original = dataPaths(path.join(fixtureRoot, 'completed')).database;
  const baseline = path.join(fixtureRoot, 'baseline-v30.sqlite');
  try {
    await access(baseline);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      await access(original);
    } catch (missing) {
      if (missing.code === 'ENOENT')
        return { available: false, reason: 'No preserved before recovery fixture.' };
      throw missing;
    }
    const raw = new DatabaseSync(original, { readOnly: true });
    const version = Number(raw.prepare('PRAGMA user_version').get().user_version);
    raw.close();
    if (version !== 30)
      return {
        available: false,
        reason: 'The preserved fixture is already upgraded; a v30 copy is required.',
      };
    await copyFile(original, baseline, constants.COPYFILE_EXCL);
  }
  const folder = await mkdtemp(path.join(fixtureRoot, 'index-031-'));
  const file = path.join(folder, 'index.sqlite');
  await copyFile(baseline, file);
  const db = await openDatabase(file, {
    migrations: migrations.filter((item) => item.version <= 30),
    backupDir: path.join(folder, 'backups'),
  });
  try {
    const counts = () =>
      Object.fromEntries(
        ['events', 'rb_sources', 'rb_chunks', 'kb_jobs'].map((table) => [
          table,
          Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n),
        ]),
      );
    const records = counts();
    const lookup = () => {
      const samples = [];
      for (let run = 0; run < 3; run++) {
        const began = performance.now();
        assert.equal(db.prepare(latestImportsSql).all().length, 300);
        samples.push(performance.now() - began);
      }
      return {
        medianMs: median(samples),
        samplesMs: samples,
        queryPlan: db
          .prepare('EXPLAIN QUERY PLAN ' + latestImportsSql)
          .all()
          .map((row) => row.detail),
      };
    };
    const before = lookup();
    const began = performance.now();
    db.transaction(() => migration.up(db));
    const indexBuildAndCommitMs = performance.now() - began;
    const after = lookup();
    assert.deepEqual(counts(), records);
    return {
      migration: migration.version,
      fromVersion: 30,
      indexBuildAndCommitMs,
      recordsUnchanged: true,
      records,
      before,
      after,
      protocol:
        'Index DDL and commit on a private copy of the v30 dataset; backup and database-open costs excluded. Separate from steady-state startup samples.',
    };
  } finally {
    db.close();
  }
}

async function childStartup(source, dataRoot) {
  const began = performance.now();
  const { createApp } = await sourceImport(source, 'app/app.js');
  const importMs = performance.now() - began;
  const [{ createScriptedRuntime }, { fakeUv }] = await Promise.all([
    sourceImport(source, 'app/runtime/scripted.js'),
    sourceImport(source, 'app/services/python/testing.js'),
  ]);
  let runtimeRequests = 0;
  const runtime = createScriptedRuntime({
    script: async function* () {
      runtimeRequests++;
      yield assert.fail('No startup task may invoke a model in this fixture.');
    },
  });
  const uv = fakeUv();
  const createStarted = performance.now();
  const app = await createApp({
    dataRoot,
    token: 'synthetic-startup-perf',
    runtime,
    pythonOptions: { uvPath: 'synthetic-uv', runner: uv.runner },
  });
  const createAppMs = performance.now() - createStarted;
  try {
    const listenStarted = performance.now();
    await app.listen();
    const listenMs = performance.now() - listenStarted;
    assert.equal(runtimeRequests, 0);
    return {
      importMs,
      createAppMs,
      listenMs,
      toHttpReadyMs: importMs + createAppMs + listenMs,
      runtimeRequests,
      pythonCommands: uv.calls.length,
      node: process.version,
    };
  } finally {
    await app.close();
  }
}

function freshStartup(source, dataRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [script, '--child', '--source', source, '--data', dataRoot],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let errors = '';
    child.stdout.on('data', (bytes) => {
      output += bytes;
    });
    child.stderr.on('data', (bytes) => {
      errors += bytes;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) return reject(new Error(`Startup child failed (${code}): ${errors}`));
      try {
        const result = JSON.parse(output.trim().split('\n').at(-1));
        assert.equal(result.node, process.version);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function measureImports(source, fixtureRoot) {
  const dataRoot = path.join(fixtureRoot, 'imports');
  const initial = await freshStartup(source, dataRoot);
  const samples = [];
  for (let run = 0; run < 3; run++) samples.push(await freshStartup(source, dataRoot));
  return {
    firstProcess: initial,
    warmFreshProcesses: samples,
    medians: Object.fromEntries(
      ['importMs', 'createAppMs', 'listenMs', 'toHttpReadyMs'].map((key) => [
        key,
        median(samples.map((value) => value[key])),
      ]),
    ),
  };
}

async function measureRecovery(source, fixtureRoot, mixed) {
  const [
    { createCore },
    { createResearch },
    { createKnowledgeJobs },
    { createPaperCards },
    { createScriptedRuntime },
    { paragraphHash },
    { settings },
  ] = await Promise.all([
    sourceImport(source, 'app/core/index.js'),
    sourceImport(source, 'app/services/research/index.js'),
    sourceImport(source, 'app/services/knowledge/jobs.js'),
    sourceImport(source, 'app/services/knowledge/cards.js'),
    sourceImport(source, 'app/runtime/scripted.js'),
    sourceImport(source, 'app/services/knowledge/card-input.js'),
    sourceImport(source, 'app/core/workspace/resources/settings.js'),
  ]);
  const core = await createCore({
    dataRoot: path.join(fixtureRoot, mixed ? 'mixed' : 'completed'),
  });
  try {
    const research = createResearch(core);
    if (research.store.countSources() === 0) {
      await seedExtrasFixture(core, research);
      const sources = research.store.listSources();
      core.db.transaction(() => {
        const insert = core.db
          .prepare(`INSERT INTO kb_jobs(source_id,layer,topic,state,content_version,updated_at)
          VALUES(?,?,?,'done',?,'2026-01-01')`);
        for (const item of sources) {
          const version = paragraphHash(research.store.chunks(item.id));
          insert.run(item.id, 'derived', '', version);
          insert.run(item.id, 'card', '', version);
        }
        insert.run(
          sources[0].id,
          'derived',
          'similar',
          digest(settings.parse(null).knowledge.similarity),
        );
      });
    }
    const sources = research.store.listSources();
    assert.equal(sources.length, 300);
    assert.equal(Number(core.db.prepare('SELECT count(*) AS n FROM rb_chunks').get().n), 5060);
    const holding = core.meetings.create({ title: 'Synthetic foreground holds jobs' });
    core.turns.start({ meetingId: holding.id, participantId: 'agent_main' });
    const originalChanged = research.store.chunks(sources[4].id);
    const semantic = { status: () => ({ state: 'disabled' }), sourceNeighbors: async () => null };
    const importPlan = core.db
      .prepare('EXPLAIN QUERY PLAN ' + latestImportsSql)
      .all()
      .map((row) => row.detail);
    const lookupSamples = [];
    for (let run = 0; run < 3; run++) {
      const began = performance.now();
      assert.equal(core.db.prepare(latestImportsSql).all().length, 300);
      lookupSamples.push(performance.now() - began);
    }
    let captured = null;
    const chunks = research.store.chunks;
    research.store.chunks = (id) => {
      const rows = chunks(id);
      if (captured) {
        captured.chunkReadCalls++;
        captured.chunksRead += rows.length;
      }
      return rows;
    };
    const samples = [];
    let initial;
    for (let run = 0; run < 4; run++) {
      if (mixed)
        core.db.transaction(() => {
          const reset = core.db.prepare(
            "UPDATE kb_jobs SET state=?,attempts=? WHERE source_id=? AND layer='derived' AND topic=''",
          );
          reset.run('running', 0, sources[0].id);
          reset.run('queued', 0, sources[1].id);
          reset.run('failed', 1, sources[2].id);
          reset.run('failed', 3, sources[3].id);
          reset.run('done', 0, sources[4].id);
          research.store.addChunks(
            sources[4].id,
            originalChanged.map((chunk, index) => ({
              ...chunk,
              text: index === 0 ? `Reparsed generation ${run}. ${chunk.text}` : chunk.text,
            })),
          );
          core.db.prepare('DELETE FROM kb_jobs WHERE source_id=?').run(sources[5].id);
        });
      let runtimeRequests = 0;
      const runtime = createScriptedRuntime({
        script: async function* () {
          runtimeRequests++;
          yield assert.fail('Recovery must remain paused, without model requests.');
        },
      });
      const cards = createPaperCards({ core, research, semantic, runtime });
      const jobs = createKnowledgeJobs({ core, research, semantic, cards });
      let maximumGapMs = 0;
      let lastBeat = performance.now();
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maximumGapMs = Math.max(maximumGapMs, now - lastBeat);
        lastBeat = now;
      }, 1);
      await delay(5);
      captured = { chunkReadCalls: 0, chunksRead: 0 };
      maximumGapMs = 0;
      lastBeat = performance.now();
      const began = performance.now();
      let sample;
      try {
        await jobs.start();
        const startMs = performance.now() - began;
        await delay(2);
        sample = { startMs, ...captured, maxEventLoopGapMs: maximumGapMs, runtimeRequests };
        captured = null;
        const states = core.db
          .prepare(
            "SELECT state,count(*) AS n FROM kb_jobs WHERE layer='derived' AND topic='' GROUP BY state",
          )
          .all();
        sample.states = Object.fromEntries(states.map((row) => [row.state, Number(row.n)]));
        if (mixed) {
          assert.deepEqual(sample.states, { done: 294, failed: 2, queued: 4 });
          const attempts = core.db.prepare(
            "SELECT attempts FROM kb_jobs WHERE source_id=? AND layer='derived' AND topic=''",
          );
          assert.equal(attempts.get(sources[2].id).attempts, 1);
          assert.equal(attempts.get(sources[3].id).attempts, 3);
        } else assert.deepEqual(sample.states, { done: 300 });
        assert.equal(runtimeRequests, 0);
      } finally {
        captured = null;
        clearInterval(heartbeat);
        await jobs.close();
        await runtime.close();
      }
      if (run === 0) initial = sample;
      else samples.push(sample);
    }
    return {
      firstStart: initial,
      samples,
      medians: Object.fromEntries(
        ['startMs', 'chunkReadCalls', 'chunksRead', 'maxEventLoopGapMs'].map((key) => [
          key,
          median(samples.map((value) => value[key])),
        ]),
      ),
      candidateImportCheckpointLookup: {
        medianMs: median(lookupSamples),
        samplesMs: lookupSamples,
        rows: 300,
        queryPlan: importPlan,
      },
      fixture: {
        sources: 300,
        chunks: 5060,
        models: 0,
        heldForeground: true,
        scenario: mixed
          ? '294 completed; running, queued, retryable failure, exhausted failure, reparsed source, missing job checkpoint'
          : '300 completed derived and card jobs with current paragraph hashes',
      },
    };
  } finally {
    core.close();
  }
}

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    data: { type: 'string' },
    source: { type: 'string' },
    phase: { type: 'string', default: 'before' },
    mode: { type: 'string', default: 'all' },
    child: { type: 'boolean', default: false },
  },
});
if (values.child) {
  console.log(JSON.stringify(await childStartup(values.source ?? defaultSource, values.data)));
} else {
  if (
    !values.out ||
    !['before', 'after'].includes(values.phase) ||
    !['all', 'import', 'jobs'].includes(values.mode)
  )
    throw new Error(
      'Use --phase before|after --mode all|import|jobs --out <receipt.json> [--data fixture] [--source checkout].',
    );
  const output = path.resolve(values.out);
  if (!output.startsWith(allowed))
    throw new Error('Receipts belong under .sciencescope-local/temp/p4c/part5-backend.');
  await mkdir(allowed, { recursive: true });
  const handle = await open(output, 'wx');
  try {
    const fixtureRoot = values.data
      ? path.resolve(values.data)
      : await mkdtemp(path.join(allowed, 'fixture-'));
    if (!fixtureRoot.startsWith(allowed))
      throw new Error('Fixture must stay in the ignored backend startup directory.');
    const source = values.source ? path.resolve(values.source) : defaultSource;
    const result = {
      schema: 1,
      kind: 'backend-startup',
      phase: values.phase,
      node: process.version,
      generatedAt: new Date().toISOString(),
      fixtureDirectory: path.relative(allowed, fixtureRoot),
      protocol: {
        measuredRuns: 3,
        warmupRuns: 1,
        osCaches: 'not cleared',
        modelRequests: 0,
        downloads: 0,
        import:
          'Fresh child process using this exact Node executable; real app import, scripted runtime, fake uv; empty owned data root reused after first initialization.',
        recovery:
          'Real knowledge jobs and card model/configure; foreground turn holds execution. One warmup start then three service restarts. Mixed case reparses one source and removes one job before every start; fixture work and close excluded.',
        eventLoop:
          '1 ms heartbeat; maximum observed scheduling gap through start plus a 2 ms settling interval.',
      },
    };
    if (values.phase === 'after' && values.mode !== 'import')
      result.indexUpgrade = await measureIndexUpgrade(source, fixtureRoot);
    if (values.mode !== 'jobs') result.imports = await measureImports(source, fixtureRoot);
    if (values.mode !== 'import') {
      result.completed = await measureRecovery(source, fixtureRoot, false);
      result.mixed = await measureRecovery(source, fixtureRoot, true);
    }
    await handle.writeFile(JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    await handle.writeFile(
      JSON.stringify({ phase: values.phase, failed: true, error: error.stack }, null, 2),
    );
    throw error;
  } finally {
    await handle.close();
  }
}
