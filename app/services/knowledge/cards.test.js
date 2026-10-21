import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createResearch } from '../research/index.js';
import { createKnowledgeStore } from './store.js';
import { createPaperCards } from './cards.js';
import { createKnowledgeJobs } from './jobs.js';
import { CARD_ACTOR_ID } from './card-writer.js';

const disabled = {
  status: () => ({ enabled: false, state: 'disabled' }),
  sourceNeighbors: async () => null,
};
const model = { provider: 'fixture', model: 'scripted' };
const usage = { requests: 1, inputTokens: 120, outputTokens: 30, totalTokens: 150 };
const passage =
  'We ask whether QCA explains outcomes. We use Qualitative Comparative Analysis (QCA) with 40 cases from Survey A. The consistency threshold is 0.8. The analysis identifies two configurations.';
const patch = (core, changes) =>
  core.workspace.edit({ resource: 'settings', key: 'app', op: 'patch', args: { changes } });
const entities = (core) => core.db.prepare("SELECT * FROM kb_entities WHERE status='active'").all();
const edges = (core) =>
  core.db.prepare("SELECT * FROM kb_edges WHERE status='active' AND layer<>'derived'").all();
const items = (core) =>
  core.db
    .prepare(
      "SELECT * FROM rb_items WHERE status='active' AND json_extract(payload_json,'$.card') IS NOT NULL",
    )
    .all();
const deferred = () => {
  /** @type {() => void} */
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = () => done(undefined);
  });
  return { promise, resolve };
};

/** @returns {any} */
function answer(input, abbreviation = false) {
  const packet = JSON.parse(input);
  const evidence = { chunkId: packet.paragraphs[0].chunkId, quote: packet.paragraphs[0].text };
  return {
    question: { text: 'Does QCA explain outcomes?', evidence: { ...evidence } },
    methods: [
      {
        name: abbreviation ? 'QCA' : 'Qualitative Comparative Analysis',
        aliases: abbreviation ? ['Qualitative Comparative Analysis'] : [],
        parameters: { consistency: 0.8 },
        evidence,
      },
    ],
    datasets: [{ name: 'Survey A', evidence }],
    findings: [{ text: 'Two configurations were identified.', evidence }],
  };
}

function source(core, research, title, options = {}) {
  const row = research.store.createSource({ title, kind: 'paper', ...options });
  research.store.addChunks(row.id, [{ section: 'Methods', page: 4, text: passage }]);
  return row;
}

async function fixture(core, script, options = {}) {
  const research = createResearch(core);
  const knowledge = createKnowledgeStore(core);
  const scripted = createScriptedRuntime({ script });
  // The receipt belongs to this fixture provider; production reports through the port.
  const runtime = {
    ...scripted,
    async send(sessionId, input, onEvent, images) {
      const result = await scripted.send(sessionId, input, onEvent, images);
      return { ...result, usage };
    },
  };
  const cards = createPaperCards({ core, research, semantic: disabled, runtime });
  const jobs = createKnowledgeJobs({ core, research, semantic: disabled, cards });
  if (options.model !== false) await patch(core, { models: { default: model } });
  await jobs.start();
  return { research, knowledge, runtime, cards, jobs };
}

test('a scan has no card charge estimate and manual organization skips it without a model call', () =>
  withCore('cards-scan-estimate', async (core) => {
    let calls = 0;
    const f = await fixture(core, async function* ({ input }) {
      calls++;
      yield JSON.stringify(answer(input));
    });
    try {
      source(core, f.research, 'Readable paper');
      const scan = f.research.store.createSource({ title: 'Scan', kind: 'paper' });
      assert.equal(f.jobs.estimateCards().count, 1);
      await f.jobs.requestCards([scan.id]);
      await f.jobs.idle();
      const skipped = f.jobs.summary().cards.jobs.find((job) => job.sourceId === scan.id);
      assert.equal(skipped.state, 'skipped');
      assert.equal(skipped.error, 'no-text');
      assert.equal(calls, 1);
      assert.equal(f.jobs.estimateCards().count, 0);
    } finally {
      await f.jobs.close();
    }
  }));

test('a malformed parent method drops that item without retrying or losing the rest of the card', () =>
  withCore('cards-parent-shape', async (core) => {
    const f = await fixture(core, async function* ({ input }) {
      const card = answer(input);
      card.methods.push({
        name: 'Combined analysis',
        variantOf: ['QCA', 'Regression'],
        evidence: card.methods[0].evidence,
      });
      yield JSON.stringify(card);
    });
    try {
      source(core, f.research, 'Malformed parent');
      await f.jobs.idle();
      const job = f.jobs.summary().cards.jobs[0];
      assert.equal(job.state, 'done');
      assert.equal(job.result.usage.requests, 1);
      assert.equal(job.result.droppedCount, 1);
      assert.equal(job.result.dropped[0].reason, 'invalid-variant-of');
      const card = JSON.parse(items(core)[0].payload_json).card;
      assert.equal(card.methods.length, 1);
      assert.equal(card.datasets[0].name, 'Survey A');
      assert.equal(entities(core).length, 2);
      assert.equal(f.knowledge.versions.list().total, 1);
    } finally {
      await f.jobs.close();
    }
  }));

test('a project paper produces one evidenced global card/build; invalid items are dropped and the build can be withdrawn', () =>
  withCore('cards-build', async (core) => {
    const events = [];
    const unsubscribe = core.events.subscribe((event) => events.push(event));
    const f = await fixture(core, async function* ({ input, call }) {
      await assert.rejects(call('shell', {}), { code: 'NO_SUMMARY_TOOLS' });
      const card = answer(input);
      card.methods.push({
        name: 'Invented',
        aliases: [],
        parameters: {},
        evidence: { chunkId: JSON.parse(input).paragraphs[0].chunkId, quote: 'Not in this paper' },
      });
      card.question.evidence.quote = 'Also invented';
      yield JSON.stringify(card);
    });
    try {
      const project = await core.projects.create({ name: '论文项目' });
      const paper = source(core, f.research, '第一篇', { projectId: project.id });
      await f.jobs.idle();
      const job = f.jobs.summary().cards.jobs[0];
      assert.equal(job.state, 'done', JSON.stringify(job));
      assert.equal(job.result.droppedCount, 2);
      assert.equal(job.result.usage.requests, 1);
      assert.equal(job.result.usage.inputTokens, 120);
      assert.equal(job.result.usage.outputTokens, 30);
      const [item] = items(core);
      assert.equal(item.project_id, null);
      assert.equal(item.type, 'note');
      assert.equal(item.subtype, 'summary');
      const card = JSON.parse(item.payload_json).card;
      assert.equal(card.question, null);
      assert.equal(card.methods[0].evidence[0].page, 4);
      assert.equal(card.methods[0].evidence[0].chunkId, paper.id + '-c0');
      assert.equal(entities(core).length, 2);
      assert.equal(edges(core).length, 2);
      assert.ok(
        entities(core).every(
          (row) =>
            row.layer === 'extracted' &&
            row.origin === 'ai' &&
            row.created_by === CARD_ACTOR_ID &&
            row.produced_from === 'source:' + paper.id,
        ),
      );
      assert.deepEqual(
        new Set(
          core.db
            .prepare('SELECT project_id FROM kb_memberships')
            .all()
            .map((row) => row.project_id),
        ),
        new Set([project.id]),
      );
      assert.equal(core.db.prepare('SELECT count(*) AS n FROM kb_memberships').get().n, 3);
      const builds = f.knowledge.versions.list().rows;
      assert.equal(builds.length, 1);
      assert.equal(builds[0].source, 'build');
      assert.equal(builds[0].description, paper.title);
      assert.equal(builds[0].meetingId, job.result.meetingId);
      assert.equal(core.turns.get(job.result.turnId).participantId, CARD_ACTOR_ID);
      assert.ok(events.some((event) => event.type === 'knowledge.changed'));
      assert.ok(
        events.some(
          (event) =>
            event.type === 'research.changed' && event.payload.action === 'knowledge.changed',
        ),
      );
      assert.ok(
        events.some(
          (event) =>
            event.type === 'knowledge.jobs.changed' && event.payload.cards.counts.done === 1,
        ),
      );
      const restored = f.knowledge.versions.restore(builds[0].id);
      assert.deepEqual(restored.skipped, []);
      assert.equal(items(core).length, 0);
      assert.equal(entities(core).length, 0);
      assert.equal(edges(core).length, 0);
      assert.equal(core.db.prepare('SELECT count(*) AS n FROM kb_memberships').get().n, 0);
      assert.equal(
        core.db.prepare("SELECT count(*) AS n FROM rb_fts WHERE doc_type='item'").get().n,
        0,
      );
      f.knowledge.versions.restore(restored.version.id);
      assert.equal(items(core).length, 1);
      assert.equal(
        core.db.prepare("SELECT count(*) AS n FROM rb_fts WHERE doc_type='item'").get().n,
        1,
      );
    } finally {
      unsubscribe();
      await f.jobs.close();
    }
  }));

test('full name and abbreviation share an entity; earlier withdrawal preserves another paper and user edits', () =>
  withCore('cards-alias', async (core) => {
    let calls = 0;
    const f = await fixture(core, async function* ({ input }) {
      yield JSON.stringify(answer(input, calls++ > 0));
    });
    try {
      source(core, f.research, 'First');
      await f.jobs.idle();
      const first = f.knowledge.versions.list().rows[0];
      const method = entities(core).find((row) => row.kind === 'method');
      f.knowledge.updateEntity(method.id, {
        name: 'My QCA',
        description: 'User explanation',
        aliases: ['Qualitative Comparative Analysis'],
      });
      source(core, f.research, 'Second');
      await f.jobs.idle();
      const methods = entities(core).filter((row) => row.kind === 'method');
      assert.equal(methods.length, 1);
      assert.equal(methods[0].name, 'My QCA');
      assert.equal(methods[0].description, 'User explanation');
      assert.ok(JSON.parse(methods[0].aliases_json).includes('QCA'));
      const outcome = f.knowledge.versions.restore(first.id);
      assert.ok(outcome.skipped.includes('entity:' + method.id));
      assert.equal(items(core).length, 1);
      assert.equal(edges(core).length, 2);
      const remaining = items(core)[0];
      f.research.store.updateItem(String(remaining.id), { body: 'User card correction' });
      const second = f.jobs.summary().cards.jobs.find((job) => job.result.cardId === remaining.id);
      const undo = f.knowledge.versions.restore(second.result.versionId);
      assert.ok(undo.skipped.includes('item:' + remaining.id));
      assert.equal(items(core)[0].body, 'User card correction');
    } finally {
      await f.jobs.close();
    }
  }));

test('reparse replaces extracted records together, retains curated links, and rollback restores the previous card', () =>
  withCore('cards-reparse', async (core) => {
    const f = await fixture(core, async function* ({ input }) {
      yield JSON.stringify(answer(input));
    });
    try {
      const paper = source(core, f.research, 'Reparse');
      await f.jobs.idle();
      const old = items(core)[0];
      const retained = edges(core)[0];
      f.knowledge.updateEdge(retained.id, { description: 'Checked by user' });
      const unchanged = edges(core).find((row) => row.id === retained.id);
      f.research.store.addChunks(paper.id, [
        { section: 'Methods', page: 5, text: passage + ' Updated experiment.' },
      ]);
      await f.jobs.idle();
      const [current] = items(core);
      assert.notEqual(current.id, old.id);
      assert.equal(f.research.store.getItem(String(old.id)).status, 'archived');
      assert.equal(JSON.parse(current.payload_json).card.methods[0].evidence[0].page, 5);
      assert.deepEqual(
        edges(core).find((row) => row.id === retained.id),
        unchanged,
      );
      const latest = f.jobs.summary().cards.jobs[0].result.versionId;
      assert.deepEqual(f.knowledge.versions.restore(latest).skipped, []);
      assert.equal(items(core)[0].id, old.id);
      assert.deepEqual(
        edges(core).find((row) => row.id === retained.id),
        unchanged,
      );
    } finally {
      await f.jobs.close();
    }
  }));

test('missing model waits, settings resume, disabled automation still permits manual cards and model fallback', () =>
  withCore('cards-model', async (core) => {
    const selected = [];
    const f = await fixture(
      core,
      async function* ({ input, model: selectedModel }) {
        selected.push(selectedModel);
        yield JSON.stringify(answer(input));
      },
      { model: false },
    );
    try {
      source(core, f.research, 'Waiting');
      await f.jobs.idle();
      assert.equal(f.jobs.summary().cards.jobs[0].error, 'no-model');
      assert.equal(f.jobs.summary().cards.counts.skipped, 1);
      assert.equal(selected.length, 0);
      await patch(core, { memory: { model } });
      await f.jobs.idle();
      assert.equal(f.jobs.summary().cards.counts.done, 1);
      await patch(core, { knowledge: { cards: { enabled: false } } });
      await f.jobs.idle();
      const manual = source(core, f.research, 'Dataset', { kind: 'dataset' });
      source(core, f.research, 'Disabled');
      await f.jobs.idle();
      assert.equal(selected.length, 1);
      assert.equal(f.jobs.estimateCards().count, 1);
      await f.jobs.requestCards([manual.id]);
      await f.jobs.idle();
      assert.equal(selected.length, 2);
      const settings = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
      settings.knowledge.cards.model = { ...model, model: 'cards' };
      assert.equal((await f.cards.model(settings)).model, 'cards');
      settings.knowledge.cards.model = null;
      assert.deepEqual(await f.cards.model(settings), model);
      settings.memory.model = null;
      await core.participants.updateDefinition('agent_secretary', {
        model: { ...model, model: 'secretary' },
      });
      assert.equal((await f.cards.model(settings)).model, 'secretary');
    } finally {
      await f.jobs.close();
    }
  }));

test('card failures stop after three attempts; explicit retry retains total request usage', () =>
  withCore('cards-retry', async (core) => {
    let fail = true,
      calls = 0;
    const f = await fixture(core, async function* ({ input }) {
      calls++;
      yield fail ? 'invalid json' : JSON.stringify(answer(input));
    });
    try {
      source(core, f.research, 'Retry');
      await f.jobs.idle();
      let job = f.jobs.summary().cards.jobs[0];
      assert.equal(calls, 3);
      assert.equal(job.state, 'failed');
      assert.equal(job.attempts, 3);
      assert.equal(job.result.usage.requests, 3);
      await f.jobs.idle();
      assert.equal(calls, 3);
      fail = false;
      f.jobs.retryFailed();
      await f.jobs.idle();
      job = f.jobs.summary().cards.jobs[0];
      assert.equal(job.state, 'done', JSON.stringify(job));
      assert.equal(calls, 4);
      assert.equal(job.result.usage.requests, 4);
      assert.equal(job.result.usage.totalTokens, 600);
    } finally {
      await f.jobs.close();
    }
  }));

test('foreground turns block new card requests; at most two start and later imports wait', () =>
  withCore('cards-concurrency', async (core) => {
    const twoStarted = deferred(),
      release = deferred();
    let calls = 0,
      active = 0,
      peak = 0;
    const f = await fixture(core, async function* ({ input }) {
      calls++;
      active++;
      peak = Math.max(peak, active);
      if (calls === 2) twoStarted.resolve();
      await release.promise;
      active--;
      yield JSON.stringify(answer(input));
    });
    const meeting = core.meetings.create({ title: 'Foreground' });
    let turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    try {
      for (let n = 0; n < 3; n++) source(core, f.research, 'Queued ' + n);
      await f.jobs.idle();
      assert.equal(calls, 0);
      core.turns.end(turn.id, { status: 'done' });
      const draining = f.jobs.idle();
      await twoStarted.promise;
      assert.equal(calls, 2);
      turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
      release.resolve();
      await draining;
      assert.equal(calls, 2);
      core.turns.end(turn.id, { status: 'done' });
      await f.jobs.idle();
      assert.equal(calls, 3);
      assert.equal(peak, 2);
      assert.equal(f.jobs.summary().cards.counts.done, 3);
    } finally {
      release.resolve();
      core.turns.end(turn.id, { status: 'done' });
      await f.jobs.close();
    }
  }));

test('reparse during a model response discards stale output, and shutdown interrupts the card session', () =>
  withCore('cards-stale', async (core) => {
    const started = deferred(),
      release = deferred();
    let calls = 0;
    const f = await fixture(core, async function* ({ input }) {
      if (++calls === 1) {
        started.resolve();
        await release.promise;
      }
      yield JSON.stringify(answer(input));
    });
    try {
      const paper = source(core, f.research, 'Changing');
      const draining = f.jobs.idle();
      await started.promise;
      f.research.store.addChunks(paper.id, [{ text: passage + ' New text.', page: 9 }]);
      release.resolve();
      await draining;
      assert.equal(calls, 2);
      assert.equal(f.knowledge.versions.list().total, 1);
      assert.equal(JSON.parse(items(core)[0].payload_json).card.methods[0].evidence[0].page, 9);
    } finally {
      release.resolve();
      await f.jobs.close();
    }
    const entered = deferred();
    const closing = await fixture(core, async function* ({ signal }) {
      entered.resolve();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      yield '{}';
    });
    source(core, closing.research, 'Close');
    const draining = closing.jobs.idle();
    await entered.promise;
    await closing.jobs.close();
    await draining;
    assert.equal(core.turns.running().length, 0);
    assert.equal(closing.jobs.summary().cards.counts.running, 0);
  }));
