// A 1,000-answer conversation; the old path is an in-memory diagnostic, not a UI endpoint.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { seedExtrasFixture } from './p4c-extras.mjs';

const median = (samples) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];

function projectOld(core, usedSources, messages) {
  const items = new Map();
  const latest = [...messages].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.seq - a.seq,
  );
  for (const message of latest) {
    if (!message.turnId || message.status === 'streaming') continue;
    for (const used of usedSources(core.turns.toolCalls(message.turnId), message.text)) {
      const item = items.get(used.id) ?? {
        sourceId: used.id,
        title: null,
        label: null,
        folderPath: null,
        projectId: null,
        pages: new Set(),
        uses: [],
      };
      for (const key of ['title', 'label', 'folderPath', 'projectId'])
        if (item[key] == null && used[key] != null) item[key] = used[key];
      for (const page of used.pages) item.pages.add(Number(page));
      item.uses.push({
        messageId: message.id,
        turnId: message.turnId,
        authorId: message.authorId,
        createdAt: message.createdAt,
        label: used.label ?? null,
      });
      items.set(used.id, item);
    }
  }
  return {
    items: [...items.values()].map((item) => ({
      ...item,
      pages: [...item.pages].sort((a, b) => a - b),
    })),
  };
}

async function sample(core, work) {
  const prepare = core.db.prepare;
  let sqlStatements = 0;
  core.db.prepare = (sql) => {
    sqlStatements++;
    return prepare(sql);
  };
  const start = performance.now();
  try {
    const result = await work();
    return { ...result, wallMs: performance.now() - start, sqlStatements };
  } finally {
    core.db.prepare = prepare;
  }
}

function summarize(samples) {
  return {
    wallMsMedian: median(samples.map((entry) => entry.wallMs)),
    sqlStatements: samples[0].sqlStatements,
    requests: samples[0].requests,
    responseBodyBytes: samples[0].responseBodyBytes,
    samples: samples.map(({ value, ...entry }) => entry),
  };
}

async function measure({ sourceRoot, dataRoot, phase }) {
  const load = (file) => import(pathToFileURL(path.resolve(sourceRoot, file)).href);
  const [
    { createCore },
    { createResearch },
    { createKnowledgeStore },
    { createAppServer },
    { usedSources },
  ] = await Promise.all([
    load('app/core/index.js'),
    load('app/services/research/index.js'),
    load('app/services/knowledge/store.js'),
    load('app/server/server.js'),
    load('app/ui/turn-sources.js'),
  ]);
  const core = await createCore({ dataRoot });
  let server;
  try {
    const research = createResearch(core);
    const fixture = await seedExtrasFixture(core, research, [1000]);
    server = createAppServer({
      core,
      research,
      knowledge: createKnowledgeStore(core),
      token: 'synthetic-sources',
    });
    const url = await server.listen();
    const route = `/api/meetings/${fixture.meetingId}/sources`;
    const old = () =>
      sample(core, () => ({ value: projectOld(core, usedSources, fixture.messages), requests: 0 }));
    const current = () =>
      sample(core, async () => {
        const response = await fetch(url + route, {
          headers: { authorization: 'Bearer synthetic-sources' },
        });
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(response.status, 200, bytes.toString());
        return {
          value: JSON.parse(bytes.toString()),
          requests: 1,
          responseBodyBytes: bytes.length,
        };
      });
    let beforeStatus;
    if (phase === 'before') {
      const response = await fetch(url + route, {
        headers: { authorization: 'Bearer synthetic-sources' },
      });
      beforeStatus = response.status;
      assert.equal(beforeStatus, 404);
      assert.equal((await response.json()).code, 'NOT_FOUND');
    }
    await old();
    if (phase === 'after') await current();
    const oldSamples = [];
    const currentSamples = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      oldSamples.push(await old());
      if (phase === 'after') {
        const result = await current();
        assert.deepEqual(result.value, oldSamples.at(-1).value);
        currentSamples.push(result);
      }
    }
    assert.equal(oldSamples[0].sqlStatements, 1000);
    assert.equal(oldSamples[0].value.items.length, 300);
    assert.equal(
      oldSamples[0].value.items.reduce((total, item) => total + item.uses.length, 0),
      1000,
    );
    return {
      schema: 1,
      kind: 'meeting-sources',
      phase,
      generatedAt: new Date().toISOString(),
      node: process.version,
      fixture: {
        ...fixture.counts,
        distinctUsedSources: 300,
        sourceUses: 1000,
        description:
          'Synthetic metadata-only catalog and seeded chunks; completed research_read records from research.read, no document parsing.',
      },
      protocol: {
        warmups: 1,
        measuredRuns: 3,
        old: 'Diagnostic only: in-memory messages + one tool-call SQL per turn + unchanged usedSources rules. No pre-existing whole-conversation UI endpoint.',
        current:
          'One loopback HTTP GET, response body bytes excluding headers; no UI/runtime/models/background jobs; fixture seeding excluded.',
      },
      old: summarize(oldSamples),
      current:
        phase === 'after'
          ? { ...summarize(currentSamples), matchesOldRules: true }
          : { available: false, status: beforeStatus },
    };
  } finally {
    if (server) await server.close();
    core.close();
  }
}

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    out: { type: 'string' },
    phase: { type: 'string', default: 'after' },
  },
});
if (!values.out || !['before', 'after'].includes(values.phase))
  throw new Error('Use --phase before|after --out <ignored receipt.json> [--source checkout].');
const output = path.resolve(values.out);
const allowed = path.resolve('.sciencescope-local/temp/p4c');
if (!output.startsWith(allowed + path.sep))
  throw new Error('Receipts belong under .sciencescope-local/temp/p4c.');
await mkdir(path.dirname(output), { recursive: true });
const handle = await open(output, 'wx');
try {
  const dataRoot = await mkdtemp(path.join(allowed, 'sources-fixture-'));
  const result = await measure({
    sourceRoot: values.source ?? fileURLToPath(new URL('../../', import.meta.url)),
    dataRoot,
    phase: values.phase,
  });
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
