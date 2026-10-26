import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { withCore } from '../../testing.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createVersions } from './index.js';
import { createVersionOrganizer } from './organizer.js';

function deferred() {
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = () => done(undefined);
  });
  return { promise, resolve };
}

async function fixture(
  core,
  defaultModel = async () => ({ provider: 'test', model: 'fake' }),
  beforeReply = async () => {},
) {
  const project = await core.projects.create({ name: 'Synthetic queued versions' });
  const versions = createVersions(core);
  let calls = 0;
  const runtime = createScriptedRuntime({
    script: async function* () {
      calls++;
      await beforeReply();
      yield JSON.stringify({ markdown: 'Synthetic notes', references: [] });
    },
  });
  const notes = createVersionOrganizer({ core, versions, runtime, defaultModel, tools: undefined });
  notes.configure(project.id, false);
  const imported = await versions.importFiles({
    projectId: project.id,
    files: [
      { name: 'synthetic.md', base64: Buffer.from('Synthetic manuscript.').toString('base64') },
    ],
  });
  notes.start();
  const meeting = core.meetings.create({ title: 'Foreground in another project' });
  return { notes, versions, id: imported.versions[0].id, meeting, calls: () => calls };
}

test('version notes wait for foreground completion and keep queued jobs pending', () =>
  withCore('notes-foreground', async (core) => {
    const f = await fixture(core);
    const turn = core.turns.start({ meetingId: f.meeting.id, participantId: 'agent_main' });
    try {
      const work = f.notes.refresh(f.id);
      assert.equal(f.notes.refresh(f.id), work);
      await setImmediate();
      assert.equal(f.calls(), 0);
      assert.equal(f.versions.get(f.id).notesStatus, 'pending');
      core.turns.end(turn.id, { status: 'done' });
      await work;
      assert.equal(f.calls(), 1);
      assert.equal(f.versions.get(f.id).notesStatus, 'completed');
    } finally {
      await f.notes.close();
    }
  }));

test('version note jobs in different projects remain concurrent in their own background lane', () =>
  withCore('notes-project-lanes', async (core) => {
    const bothStarted = deferred(),
      release = deferred();
    let calls = 0;
    const f = await fixture(core, undefined, async () => {
      if (++calls === 2) bothStarted.resolve();
      await release.promise;
    });
    const project = await core.projects.create({ name: 'Second synthetic project' });
    f.notes.configure(project.id, false);
    const second = await f.versions.importFiles({
      projectId: project.id,
      files: [
        {
          name: 'second.md',
          base64: Buffer.from('Second synthetic manuscript.').toString('base64'),
        },
      ],
    });
    try {
      const jobs = [f.notes.refresh(f.id), f.notes.refresh(second.versions[0].id)];
      await bothStarted.promise;
      assert.equal(calls, 2);
      release.resolve();
      await Promise.all(jobs);
      assert.equal(f.versions.get(f.id).notesStatus, 'completed');
      assert.equal(f.versions.get(second.versions[0].id).notesStatus, 'completed');
    } finally {
      release.resolve();
      await f.notes.close();
    }
  }));

test('foreground starting during async model preparation defers the same version job', () =>
  withCore('notes-prepare-foreground', async (core) => {
    const entered = deferred(),
      release = deferred();
    const f = await fixture(core, async () => {
      entered.resolve();
      await release.promise;
      return { provider: 'test', model: 'fake' };
    });
    try {
      const work = f.notes.refresh(f.id);
      await entered.promise;
      const turn = core.turns.start({ meetingId: f.meeting.id, participantId: 'agent_main' });
      release.resolve();
      await setImmediate();
      assert.equal(f.calls(), 0);
      assert.equal(f.versions.get(f.id).notesStatus, 'pending');
      core.turns.end(turn.id, { status: 'done' });
      await work;
      assert.equal(f.calls(), 1);
      assert.equal(f.versions.get(f.id).notesStatus, 'completed');
    } finally {
      release.resolve();
      await f.notes.close();
    }
  }));

test('closing version notes releases foreground waiters without dispatching or failing pending jobs', () =>
  withCore('notes-close-waiting', async (core) => {
    const f = await fixture(core);
    const turn = core.turns.start({ meetingId: f.meeting.id, participantId: 'agent_main' });
    const work = f.notes.refresh(f.id);
    await setImmediate();
    await f.notes.close();
    await work;
    assert.equal(f.calls(), 0);
    assert.equal(f.versions.get(f.id).notesStatus, 'pending');
    core.turns.end(turn.id, { status: 'done' });
    await setImmediate();
    assert.equal(f.calls(), 0);
  }));
