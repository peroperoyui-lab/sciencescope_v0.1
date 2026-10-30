// Settings HTTP and real consumers; synthetic durable history, no model or asset downloads.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { channel } from 'node:diagnostics_channel';
import { mkdir, mkdtemp, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { seedExtrasFixture } from './p4c-extras.mjs';

const observations = channel('sciencescope.settings.performance');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const barrierStages = [
  'workspace.queue',
  'workspace.read',
  'workspace.prepare',
  'workspace.revision',
  'workspace.afterEdit',
  'provider.prepare',
  'provider.afterEdit',
];

function excludeBarrier(events) {
  const excluded = new Set();
  for (const stage of barrierStages) {
    const index = events.findLastIndex((event) => event.stage === stage);
    assert.ok(index >= 0, `Missing queue-barrier observation: ${stage}`);
    excluded.add(index);
  }
  return events.filter((_, index) => !excluded.has(index));
}

function phases(events) {
  const result = {};
  for (const { stage, durationMs, count } of events) {
    result[stage] ??= { calls: 0, count: 0, durationMs: 0 };
    result[stage].calls++;
    result[stage].count += count;
    result[stage].durationMs += durationMs;
  }
  return result;
}

function summarize(samples) {
  const stageNames = [...new Set(samples.flatMap((sample) => Object.keys(sample.phases)))];
  return {
    httpResponseMsMedian: median(samples.map((sample) => sample.httpResponseMs)),
    consumersSettledMsMedian: median(samples.map((sample) => sample.consumersSettledMs)),
    responseBodyBytes: samples.map((sample) => sample.responseBodyBytes),
    phases: Object.fromEntries(
      stageNames.map((stage) => [
        stage,
        {
          callsMedian: median(samples.map((sample) => sample.phases[stage]?.calls ?? 0)),
          countMedian: median(samples.map((sample) => sample.phases[stage]?.count ?? 0)),
          durationMsMedian: median(samples.map((sample) => sample.phases[stage]?.durationMs ?? 0)),
        },
      ]),
    ),
    samples,
  };
}

async function measure({ sourceRoot, dataRoot, phase, baseline }) {
  const load = (file) => import(pathToFileURL(path.resolve(sourceRoot, file)).href);
  const [
    { createCore },
    { providerSettings },
    { createResearch },
    { createSemantic },
    { createKnowledgeJobs },
    { createPaperCards },
    { paragraphHash },
    { createAppServer },
    { createScriptedRuntime },
    { mergeSettings },
    { createMemoryService },
    { createBackgroundRunner },
    { createMinutesService },
  ] = await Promise.all([
    load('app/core/index.js'),
    load('app/services/provider-settings.js'),
    load('app/services/research/index.js'),
    load('app/services/research/semantic/index.js'),
    load('app/services/knowledge/jobs.js'),
    load('app/services/knowledge/cards.js'),
    load('app/services/knowledge/card-input.js'),
    load('app/server/server.js'),
    load('app/runtime/scripted.js'),
    load('app/core/workspace/resources/settings.js'),
    load('app/services/memory/index.js'),
    load('app/services/secretary/background.js'),
    load('app/services/secretary/minutes.js'),
  ]);
  const core = await createCore({ dataRoot, settingsResource: providerSettings(dataRoot) });
  let server, jobs, semantic, memory, minutes, cards, runtime;
  let runtimeRequests = 0;
  let captured = null;
  let sampleStart = 0;
  const observe = (message) => {
    if (!captured) return;
    assert.deepEqual(Object.keys(message).sort(), ['count', 'durationMs', 'stage']);
    captured.push({ ...message, completedMs: performance.now() - sampleStart });
  };
  observations.subscribe(observe);
  try {
    const research = createResearch(core);
    const fixture = await seedExtrasFixture(core, research);
    const initial = await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          appearance: { knowledgeView: 'table' },
          profile: { bio: '' },
          providers: [
            {
              id: 'synthetic-provider',
              name: 'Synthetic fixture provider',
              baseUrl: 'http://127.0.0.1:9',
              api: 'openai-completions',
              models: [],
              headers: { 'X-Fixture-Header': 'SYNTHETIC_BENCHMARK_HEADER' },
            },
          ],
        },
      },
    });
    let expected = initial.value;
    assert.equal(expected.semantic.enabled, false);
    assert.equal(expected.memory.enabled, true);
    assert.equal(expected.memory.idleMinutes, 10);
    assert.deepEqual(expected.providers[0].headers['X-Fixture-Header'], {
      keyRef: 'provider.synthetic-provider.headers.X-Fixture-Header',
    });
    core.db.transaction(() => {
      const insert = core.db.prepare(`INSERT INTO kb_jobs
        (source_id,layer,topic,state,content_version,updated_at,result_json)
        VALUES(?,?,?,'done',?,?,?)`);
      const sources = research.store.listSources();
      for (const source of sources) {
        const version = paragraphHash(research.store.chunks(source.id));
        insert.run(source.id, 'derived', '', version, '2026-01-01T00:00:00Z', null);
        insert.run(
          source.id,
          'card',
          '',
          version,
          '2026-01-01T00:00:00Z',
          JSON.stringify({ synthetic: true, usage: { requests: 0, totalTokens: 0 } }),
        );
      }
      insert.run(
        sources[0].id,
        'derived',
        'similar',
        digest(JSON.stringify(expected.knowledge.similarity)),
        '2026-01-01T00:00:00Z',
        null,
      );
    });
    const embed = {
      warmup: async () => {},
      close: async () => {},
      embedQuery: async () => new Float32Array(384),
      embedPassages: async (texts) => texts.map(() => new Float32Array(384)),
    };
    semantic = createSemantic(core, {
      embed,
      manifest: { modelId: 'synthetic-local-fixture', revision: 'fixture-v1', dimensions: 384 },
      hardware: async () => ({ supported: true, avx2: true }),
      downloadFiles: async () => {
        throw new Error('Benchmark must not download assets.');
      },
    });
    await semantic.start();
    runtime = createScriptedRuntime({
      script: async function* () {
        runtimeRequests++;
        throw new Error('Benchmark must not invoke a model.');
      },
    });
    cards = createPaperCards({ core, research, semantic, runtime });
    jobs = createKnowledgeJobs({ core, research, semantic, cards });
    await jobs.start();
    minutes = createMinutesService({ core, runtime, defaultModel: async () => null });
    memory = createMemoryService({
      core,
      minutes,
      research,
      runner: createBackgroundRunner({ core, runtime, defaultModel: async () => null }),
    });
    memory.start();
    await jobs.idle();
    await semantic.idle();
    await core.workspace.read({ resource: 'settings', key: 'app' });
    await new Promise((resolve) => setImmediate(resolve));
    const summary = jobs.summary();
    assert.equal(summary.counts.done, 300);
    assert.equal(summary.cards.counts.done, 300);
    assert.equal(summary.similarity.state, 'done');
    assert.equal(summary.counts.queued + summary.cards.counts.queued, 0);
    server = createAppServer({
      core,
      research,
      semantic,
      knowledgeJobs: jobs,
      memory,
      token: 'synthetic-settings',
    });
    const url = await server.listen();
    async function run(changes) {
      const next = mergeSettings(expected, changes);
      captured = [];
      sampleStart = performance.now();
      const response = await fetch(url + '/api/settings', {
        method: 'PATCH',
        headers: { authorization: 'Bearer synthetic-settings', 'content-type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const httpResponseMs = performance.now() - sampleStart;
      assert.equal(response.status, 200, bytes.toString());
      const value = JSON.parse(bytes.toString());
      assert.deepEqual(value, next);
      expected = next;
      await jobs.idle();
      await semantic.idle();
      await memory.idle();
      // This read enters behind consumer reads already queued by the settings event.
      // Its own seven stages are removed; completion proves all scheduler reads settled.
      await core.workspace.read({ resource: 'settings', key: 'app' });
      await new Promise((resolve) => setImmediate(resolve));
      const events = excludeBarrier(captured);
      captured = null;
      assert.equal(runtimeRequests, 0);
      assert.equal(runtime.sessions.size, 0);
      const consumersSettledMs = Math.max(
        httpResponseMs,
        ...events.map((event) => event.completedMs),
      );
      return {
        httpResponseMs,
        consumersSettledMs,
        requests: 1,
        responseBodyBytes: bytes.length,
        responseSha256: digest(bytes),
        correctSettings: true,
        phases: phases(events),
        events,
      };
    }
    const cases = {};
    for (const kind of ['graph-preference', 'profile-bio']) {
      const changes = (index) =>
        kind === 'graph-preference'
          ? { appearance: { knowledgeView: index % 2 ? 'table' : 'graph' } }
          : { profile: { bio: `Synthetic profile ${index}` } };
      await run(changes(0));
      const samples = [];
      for (let index = 1; index <= 3; index++) samples.push(await run(changes(index)));
      cases[kind] = summarize(samples);
      if (baseline)
        assert.deepEqual(
          samples.map((entry) => entry.responseSha256),
          baseline.cases[kind].samples.map((entry) => entry.responseSha256),
          `${kind} response bodies differ from the before receipt`,
        );
    }
    assert.equal(runtimeRequests, 0);
    return {
      schema: 1,
      kind: 'settings-save-real-consumers',
      phase,
      generatedAt: new Date().toISOString(),
      node: process.version,
      fixture: {
        ...fixture.counts,
        sourceKinds: '300 synthetic papers',
        derivedDone: 300,
        cardDone: 300,
        similarityDone: 1,
        history:
          'Seeded durable completed checkpoints with real paragraph hashes; no generated paper cards.',
        semanticEnabled: false,
        memoryEnabled: true,
        memoryIdleMinutes: 10,
        configuredModels: 0,
        runtimeRequests,
        downloads: 0,
        credentials:
          'One generated non-secret fixture header stored by the real providerSettings wrapper before timing.',
      },
      protocol: {
        warmupsPerCase: 1,
        measuredRunsPerCase: 3,
        paths:
          'Both real UI save actions send one PATCH /api/settings. No pre-GET or frontend queue latency is claimed.',
        sourceEvidence: [
          'app/ui/components/research-base.js changeView',
          'app/ui/actions.js updateSettings',
          'app/ui/components/settings.js GeneralPage',
          'app/ui/components/settings-kit.js useSetting',
        ],
        consumers: [
          'real knowledge jobs + card queue + paperCards.model',
          'real semantic settings subscriber with fake embedding/assets',
          'real memory scheduler across all twelve meetings',
        ],
        settle:
          'One diagnostic settings queue-barrier read follows jobs/semantic/memory idle. Its seven observations are excluded; settled time is the latest production observation or HTTP completion.',
        stages:
          'Durations are nested and may overlap; stage sums are not an additive wall-time breakdown.',
        responseParity: baseline
          ? 'All measured response byte hashes match the immutable before receipt.'
          : 'Every response exactly matches the expected merged settings.',
        excludes: ['fixture seeding', 'startup', 'UI/WebView', 'model calls', 'asset downloads'],
      },
      cases,
    };
  } finally {
    captured = null;
    observations.unsubscribe(observe);
    if (server) await server.close();
    if (memory) await memory.close();
    if (minutes) await minutes.close();
    if (jobs) await jobs.close();
    else if (cards) await cards.close();
    if (semantic) await semantic.close();
    if (runtime) await runtime.close();
    core.close();
  }
}

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    out: { type: 'string' },
    phase: { type: 'string', default: 'after' },
    baseline: { type: 'string' },
  },
});
if (!values.out || !['before', 'after'].includes(values.phase))
  throw new Error(
    'Use --phase before|after --out <ignored receipt.json> [--source checkout] [--baseline before.json].',
  );
const output = path.resolve(values.out);
const allowed = path.resolve('.sciencescope-local/temp/p4c/part3');
if (!output.startsWith(allowed + path.sep))
  throw new Error('Receipts belong under .sciencescope-local/temp/p4c/part3.');
await mkdir(path.dirname(output), { recursive: true });
const handle = await open(output, 'wx');
try {
  const dataRoot = await mkdtemp(path.join(allowed, 'settings-fixture-'));
  const baseline = values.baseline ? JSON.parse(await readFile(values.baseline, 'utf8')) : null;
  const result = await measure({
    sourceRoot: values.source ?? fileURLToPath(new URL('../../', import.meta.url)),
    dataRoot,
    phase: values.phase,
    baseline,
  });
  await handle.writeFile(JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      phase: result.phase,
      fixture: result.fixture,
      cases: Object.fromEntries(
        Object.entries(result.cases).map(([kind, value]) => [
          kind,
          {
            httpResponseMsMedian: value.httpResponseMsMedian,
            consumersSettledMsMedian: value.consumersSettledMsMedian,
            phases: value.phases,
            responseBodyBytes: value.responseBodyBytes,
          },
        ]),
      ),
    }),
  );
} catch (error) {
  await handle.writeFile(
    JSON.stringify(
      { phase: values.phase, failed: true, node: process.version, error: error.stack },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await handle.close();
}
