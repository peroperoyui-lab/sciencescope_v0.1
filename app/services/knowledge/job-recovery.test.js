import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createResearch } from '../research/index.js';
import { createKnowledgeJobs } from './jobs.js';
import { paragraphHash } from './card-input.js';

const semantic = { status: () => ({ state: 'disabled' }), sourceNeighbors: async () => null };
const derived = { reset() {}, run: async () => 'done', similar: async () => 'done' };
const row = (core, id) =>
  core.db
    .prepare("SELECT * FROM kb_jobs WHERE source_id=? AND layer='derived' AND topic=''")
    .get(id);

function seed(core, research, count) {
  return core.db.transaction(() =>
    Array.from({ length: count }, (_, index) => {
      const source = research.store.createSource({ title: `Recovery ${index}`, kind: 'paper' });
      research.store.addChunks(source.id, [{ text: `Paragraph ${index}` }]);
      core.db
        .prepare(
          `INSERT INTO kb_jobs(source_id,layer,topic,state,content_version,attempts,updated_at)
      VALUES(?,'derived','','done',?,0,'unchanged')`,
        )
        .run(source.id, paragraphHash(research.store.chunks(source.id)));
      return source.id;
    }),
  );
}

test('legacy checkpoints preserve retries and completed state, then restart without chunk hashing', () =>
  withCore('job-version-checkpoint', async (core) => {
    const research = createResearch(core),
      ids = seed(core, research, 30);
    core.db
      .prepare("UPDATE kb_jobs SET state='failed',attempts=3,error='kept' WHERE source_id=?")
      .run(ids[0]);
    core.db.prepare("UPDATE kb_jobs SET state='running' WHERE source_id=?").run(ids[1]);
    const meeting = core.meetings.create({ title: 'Hold recovery' });
    core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    const originalChunks = research.store.chunks;
    let reads = 0;
    research.store.chunks = (...args) => {
      reads++;
      return originalChunks(...args);
    };
    const cards = { start: async () => {}, close: async () => {}, model: async () => null };
    let jobs = createKnowledgeJobs({ core, research, semantic, derived, cards });
    try {
      await jobs.start();
      assert.equal(reads, 30);
      assert.equal(row(core, ids[0]).attempts, 3);
      assert.equal(row(core, ids[0]).state, 'failed');
      assert.equal(row(core, ids[0]).error, 'kept');
      assert.equal(row(core, ids[0]).updated_at, 'unchanged');
      assert.equal(row(core, ids[1]).state, 'queued');
      assert.equal(JSON.parse(row(core, ids[2]).result_json).schema, 1);
      await jobs.close();
      reads = 0;
      jobs = createKnowledgeJobs({ core, research, semantic, derived, cards });
      await jobs.start();
      assert.equal(reads, 0);
      // Same original bytes and wall-clock timestamp still produce a newer import.
      research.store.addChunks(ids[2], [{ text: 'Reparsed section', section: 'Methods' }]);
      assert.equal(row(core, ids[2]).state, 'queued');
      assert.equal(reads, 1);
      assert.equal(row(core, ids[2]).content_version, paragraphHash(originalChunks(ids[2])));
    } finally {
      await jobs.close();
    }
  }));

test('yielded recovery observes imports/deletions, blocks idle drain and waits on close', () =>
  withCore('job-recovery-yield', async (core) => {
    const research = createResearch(core),
      ids = seed(core, research, 60);
    let calls = 0,
      ticks = 0;
    const worker = {
      ...derived,
      run: async () => {
        calls++;
        return 'done';
      },
    };
    const jobs = createKnowledgeJobs({ core, research, semantic, derived: worker });
    const starting = jobs.start();
    // First card-lane await precedes hydration; the next immediate runs at its yield.
    await new Promise((resolve) => setImmediate(resolve));
    ticks++;
    research.store.addChunks(ids[0], [{ text: 'New current paragraphs' }]);
    research.store.deleteSource(ids[1]);
    const waiting = jobs.idle();
    assert.equal(calls, 0);
    await starting;
    await waiting;
    assert.equal(ticks, 1);
    assert.equal(row(core, ids[1]), undefined);
    assert.equal(row(core, ids[0]).content_version, paragraphHash(research.store.chunks(ids[0])));
    assert.equal(calls, 1);
    await jobs.close();

    const closing = createKnowledgeJobs({ core, research, semantic, derived: worker });
    const nextStart = closing.start();
    await new Promise((resolve) => setImmediate(resolve));
    await closing.close();
    await nextStart;
    const before = calls;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, before);
  }));

test('missing import history and invalid checkpoints fall back; empty new sources stay without jobs', () =>
  withCore('job-recovery-fallback', async (core) => {
    const research = createResearch(core),
      ids = seed(core, research, 3);
    core.db
      .prepare(
        "DELETE FROM events WHERE type='research.changed' AND json_extract(payload_json,'$.sourceId')=?",
      )
      .run(ids[0]);
    core.db.prepare("UPDATE kb_jobs SET result_json='not json' WHERE source_id=?").run(ids[1]);
    const empty = research.store.createSource({ title: 'Empty', kind: 'paper' });
    const jobs = createKnowledgeJobs({ core, research, semantic, derived });
    try {
      await jobs.start();
      assert.equal(JSON.parse(row(core, ids[0]).result_json).sourceEventSeq, null);
      assert.equal(JSON.parse(row(core, ids[1]).result_json).schema, 1);
      assert.equal(row(core, empty.id), undefined);
    } finally {
      await jobs.close();
    }
  }));

test('close releases the card worker when a pending recovery model lookup fails', () =>
  withCore('job-recovery-close-failed', async (core) => {
    const research = createResearch(core);
    /** @type {(error:Error)=>void} */
    let rejectModel = () => assert.fail('Model lookup did not start');
    let enteredModel,
      closes = 0;
    const entered = new Promise((resolve) => {
      enteredModel = resolve;
    });
    const cards = {
      start: async () => {},
      close: async () => {
        closes++;
      },
      model() {
        enteredModel();
        return new Promise((resolve, reject) => {
          rejectModel = reject;
        });
      },
    };
    const jobs = createKnowledgeJobs({ core, research, semantic, derived, cards });
    const starting = jobs.start();
    await entered;
    const closing = jobs.close();
    const expectedStart = assert.rejects(starting, /lookup failed/);
    const expectedClose = assert.rejects(closing, /lookup failed/);
    rejectModel(new Error('lookup failed'));
    await Promise.all([expectedStart, expectedClose]);
    assert.equal(closes, 1);
  }));

test('settings backfill during a recovery yield retains all legacy checkpoints and changed versions', () =>
  withCore('job-recovery-settings-yield', async (core) => {
    const research = createResearch(core),
      ids = seed(core, research, 60);
    // A source changed while the app was closed, so its settled job is stale.
    research.store.addChunks(ids[59], [{ text: 'Changed while closed' }]);
    const meeting = core.meetings.create({ title: 'Hold recovery' });
    core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    const cards = { start: async () => {}, close: async () => {}, model: async () => null };
    const jobs = createKnowledgeJobs({ core, research, semantic, derived, cards });
    try {
      const starting = jobs.start();
      await new Promise((resolve) => setImmediate(resolve));
      // Force the real event consumer to configure cards before hydration finishes.
      core.events.transient('resource.changed', { resource: 'agent', key: 'agent_secretary' });
      await starting;
      await jobs.idle();
      assert.equal(row(core, ids[59]).state, 'queued');
      assert.equal(
        row(core, ids[59]).content_version,
        paragraphHash(research.store.chunks(ids[59])),
      );
      assert.ok(ids.every((id) => JSON.parse(row(core, id).result_json).schema === 1));
    } finally {
      await jobs.close();
    }
  }));
