// HTTP-only synthetic benchmark: no createApp, agent runtime, model or background jobs.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const messageCounts = [180, ...Array(10).fill(75), 70];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export async function seedExtrasFixture(core, research, countsByMeeting = messageCounts) {
  const project = await core.projects.create({ name: 'Synthetic extras benchmark' });
  const answers = [];
  const messages = countsByMeeting.reduce((total, count) => total + count, 0);
  const counts = {
    sources: 300,
    chunks: 5060,
    meetings: countsByMeeting.length,
    messages,
    toolCalls: messages,
  };
  core.db.transaction(() => {
    const sources = [];
    for (let index = 0; index < counts.sources; index++) {
      const source = research.store.createSource({
        id: `p4c-source-${index}`,
        projectId: project.id,
        kind: 'paper',
        title: `Synthetic source ${index + 1}: regional research evidence`,
        metadata: { synthetic: true, authors: ['Fixture Author'], year: 2026 },
      });
      research.store.addChunks(
        source.id,
        Array.from({ length: index < 40 ? 16 : 17 }, (_, ordinal) => ({
          page: ordinal + 1,
          section: `Section ${ordinal + 1}`,
          text: `Synthetic source ${index + 1}, passage ${ordinal + 1}. Regional research compares methods, evidence and interpretation. `.repeat(
            6,
          ),
        })),
        { parser: 'synthetic-metadata-only', pages: 17 },
      );
      sources.push(source);
    }
    for (const [chat, count] of countsByMeeting.entries()) {
      const meeting = core.meetings.create({
        projectId: project.id,
        title: `Synthetic chat ${chat + 1}`,
        members: [{ participantId: 'agent_main' }],
      });
      for (let index = 0; index < count; index++) {
        const source = sources[(chat * 31 + index) % sources.length];
        const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
        const callId = `read-${chat}-${index}`;
        core.turns.startToolCall({
          turnId: turn.id,
          callId,
          name: 'research_read',
          args: { id: source.id, limit: 2 },
          preamble: 'Read synthetic passages for this answer.',
        });
        core.turns.endToolCall(turn.id, callId, {
          result: research.read({ id: source.id, limit: 2 }),
          isError: false,
        });
        const answer = core.messages.post({
          meetingId: meeting.id,
          authorId: 'agent_main',
          turnId: turn.id,
          text: `Synthetic answer ${index + 1}: the source describes regional research evidence [${source.label} p.1].`,
        });
        core.turns.end(turn.id, { status: 'done' });
        if (chat === 0) answers.push(answer);
      }
    }
  });
  for (const [table, count] of [
    ['rb_sources', counts.sources],
    ['rb_chunks', counts.chunks],
    ['meetings', counts.meetings],
    ['messages', counts.messages],
    ['tool_calls', counts.toolCalls],
  ])
    assert.equal(Number(core.db.prepare(`SELECT count(*) n FROM ${table}`).get().n), count);
  return { counts, messages: answers, meetingId: answers[0].meetingId };
}

/** Assemble the documented batch shape exclusively through the existing HTTP endpoints. */
async function oldExtras(get, messages) {
  const items = {};
  for (const message of messages) {
    const turn = await get(`/api/turns/${message.turnId}`);
    const citations = await get(`/api/messages/${message.id}/citations`);
    const page = await get(`/api/knowledge/versions?turnId=${message.turnId}&limit=1`);
    let knowledge = null;
    if (page.rows[0]?.closedAt) {
      const detail = await get(`/api/knowledge/versions/${page.rows[0].id}`);
      let last = detail.version;
      let links = 0;
      while (last.restoredBy && links < 20) {
        last = (await get(`/api/knowledge/versions/${last.restoredBy}`)).version;
        links++;
      }
      knowledge = { ...detail, lastId: last.id, withdrawn: links % 2 === 1 };
    }
    items[message.id] = { turn, citations, knowledge };
  }
  return { items };
}

async function runSample(baseUrl, read) {
  let requests = 0;
  let responseBodyBytes = 0;
  const start = performance.now();
  const value = await read(async (route) => {
    requests++;
    const response = await fetch(baseUrl + route, {
      headers: { authorization: 'Bearer synthetic-benchmark' },
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    responseBodyBytes += bytes.length;
    assert.equal(response.status, 200, `${route}: ${bytes.toString()}`);
    return JSON.parse(bytes.toString());
  });
  return { value, wallMs: performance.now() - start, requests, responseBodyBytes };
}

function summary(samples) {
  return {
    wallMsMedian: median(samples.map((sample) => sample.wallMs)),
    requests: samples[0].requests,
    responseBodyBytes: samples[0].responseBodyBytes,
    samples: samples.map(({ value: _, ...sample }) => sample),
  };
}

function seedKnowledge(knowledge, messages) {
  for (const [index, message] of messages.slice(0, 6).entries()) {
    const actor = { actorId: 'agent_main', meetingId: message.meetingId, turnId: message.turnId };
    knowledge.createEntity({ kind: 'concept', name: `Synthetic concept ${index}` }, actor);
    const version = knowledge.closeTurn(message.turnId);
    if (index === 0) knowledge.versions.restore(version.id);
    if (index === 1) {
      const inverse = knowledge.versions.restore(version.id);
      knowledge.versions.restore(inverse.version.id);
    }
  }
}

export async function measureExtras({
  sourceRoot,
  fixtureRoot,
  phase = 'after',
  knowledgeChanges = false,
}) {
  const load = (file) => import(pathToFileURL(path.resolve(sourceRoot, file)).href);
  const [{ createCore }, { createResearch }, { createKnowledgeStore }, { createAppServer }] =
    await Promise.all([
      load('app/core/index.js'),
      load('app/services/research/index.js'),
      load('app/services/knowledge/store.js'),
      load('app/server/server.js'),
    ]);
  const core = await createCore({ dataRoot: fixtureRoot });
  const research = createResearch(core);
  const knowledge = createKnowledgeStore(core);
  let server;
  try {
    const fixture = await seedExtrasFixture(core, research);
    fixture.messages = fixture.messages.slice(-30);
    if (knowledgeChanges) seedKnowledge(knowledge, fixture.messages);
    server = createAppServer({ core, research, knowledge, token: 'synthetic-benchmark' });
    const baseUrl = await server.listen();
    const old = (get) => oldExtras(get, fixture.messages);
    const batch = (get) =>
      get(
        `/api/meetings/${fixture.meetingId}/message-extras?ids=${fixture.messages.map((message) => message.id).join(',')}`,
      );
    await runSample(baseUrl, old);
    if (phase === 'after') await runSample(baseUrl, batch);
    const oldSamples = [];
    const batchSamples = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      oldSamples.push(await runSample(baseUrl, old));
      if (phase === 'after') {
        const sample = await runSample(baseUrl, batch);
        assert.deepEqual(sample.value, oldSamples.at(-1).value);
        batchSamples.push(sample);
      }
    }
    assert.equal(oldSamples[0].requests, knowledgeChanges ? 99 : 90);
    return {
      schema: 1,
      kind: 'backend-http-message-extras',
      phase,
      generatedAt: new Date().toISOString(),
      node: process.version,
      fixture: {
        ...fixture.counts,
        longestChatMessages: 180,
        sampledAnswers: 30,
        description:
          'Synthetic catalog metadata and manually seeded chunks; no original PDFs or document parsing. Every answer has a completed research_read record from research.read.',
        knowledgeVersions: knowledgeChanges ? 9 : 0,
        changedTurns: knowledgeChanges ? 6 : 0,
        restoreChainLengths: knowledgeChanges ? [1, 2] : [],
      },
      protocol: {
        warmups: 1,
        measuredRuns: 3,
        requests: 'Sequential HTTP GETs on loopback with fetch connection reuse',
        bytes: 'Uncompressed response body UTF-8 bytes, excluding headers',
        excludes: [
          'UI/WebView',
          'runtime',
          'models',
          'background jobs',
          'startup',
          'fixture seeding',
        ],
      },
      old: summary(oldSamples),
      batch:
        phase === 'after'
          ? { ...summary(batchSamples), matchesOldEndpoints: true }
          : {
              available: false,
              reason: 'Pre-change baseline; new endpoint intentionally not requested.',
            },
    };
  } finally {
    if (server) await server.close();
    core.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      source: { type: 'string' },
      phase: { type: 'string', default: 'after' },
      'knowledge-changes': { type: 'boolean', default: false },
    },
  });
  if (!values.out || !['before', 'after'].includes(values.phase))
    throw new Error('Use --phase before|after --out <ignored receipt.json> [--source checkout].');
  const output = path.resolve(values.out);
  const allowed = path.resolve('.sciencescope-local/temp/p4c');
  if (!output.startsWith(allowed + path.sep))
    throw new Error('Receipts belong under .sciencescope-local/temp/p4c.');
  await mkdir(path.dirname(output), { recursive: true });
  // Reserve an immutable receipt before expensive work, preserving failures too.
  const handle = await open(output, 'wx');
  try {
    const fixtureRoot = await mkdtemp(path.join(allowed, 'extras-fixture-'));
    const result = await measureExtras({
      sourceRoot: values.source ?? fileURLToPath(new URL('../../', import.meta.url)),
      fixtureRoot,
      phase: values.phase,
      knowledgeChanges: values['knowledge-changes'],
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
}
