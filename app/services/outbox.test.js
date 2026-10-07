import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore, tempDir } from '../testing.js';
import { createCore } from '../core/index.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { createConductor } from './conductor.js';
import { createTurnRunner } from './turn-runner.js';
import { createTools } from './tools.js';

function conductorFor(core, script) {
  const runtime = createScriptedRuntime({ script });
  const runner = createTurnRunner({
    core,
    runtime,
    runtimeName: 'scripted',
    tools: createTools(core),
    defaultModel: async () => ({ provider: 'test', model: 'test' }),
  });
  return createConductor({ core, runner });
}

function inputFor(meeting, text) {
  return { meetingId: meeting.id, authorId: 'person_user', text };
}

test('two submitted inputs queue during an answer; cancel and edit apply before stop lets the remaining input send', () =>
  withCore('outbox-answering', async (core) => {
    let began = () => {};
    const started = new Promise((resolve) => {
      began = () => resolve(undefined);
    });
    let calls = 0;
    const conductor = conductorFor(core, async function* ({ signal, input }) {
      calls++;
      if (calls === 1) {
        yield '正在回答';
        began();
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      } else {
        assert.match(input, /保留修改后的问题/);
        yield '队列回答';
      }
    });
    conductor.start();
    try {
      const meeting = core.meetings.create({
        members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
      });
      const first = conductor.submit(inputFor(meeting, '初始问题'));
      assert.ok('id' in first);
      await started;
      const second = conductor.submit(inputFor(meeting, '应被取消'));
      const third = conductor.submit(inputFor(meeting, '保留问题'));
      assert.ok('queued' in second && second.queued);
      assert.ok('queued' in third && third.queued);
      assert.deepEqual(
        core.messages
          .since(meeting.id, 0)
          .filter((message) => message.authorId === 'person_user')
          .map((message) => message.id),
        [first.id],
      );
      core.outbox.cancel(meeting.id, second.item.id);
      core.outbox.edit(meeting.id, third.item.id, { text: '保留修改后的问题' });
      await conductor.interrupt(meeting.id);
      await conductor.idle();
      const messages = core.messages.since(meeting.id, 0);
      assert.deepEqual(
        messages
          .filter((message) => message.authorId === 'person_user')
          .map((message) => message.text),
        ['初始问题', '保留修改后的问题'],
      );
      assert.deepEqual(
        messages
          .filter((message) => message.authorId === 'agent_main')
          .map((message) => message.status),
        ['cancelled', 'done'],
      );
      assert.equal(core.outbox.list(meeting.id).items.length, 0);
      assert.equal(calls, 2);
    } finally {
      conductor.stop();
      await conductor.idle();
    }
  }));

test('back-to-back submissions serialize naturally and cancel all leaves the active answer running', () =>
  withCore('outbox-cancel-all', async (core) => {
    let began = () => {};
    let finish = () => {};
    const started = new Promise((resolve) => {
      began = () => resolve(undefined);
    });
    const held = new Promise((resolve) => {
      finish = () => resolve(undefined);
    });
    const conductor = conductorFor(core, async function* () {
      began();
      await held;
      yield '当前回答完成';
    });
    conductor.start();
    try {
      const meeting = core.meetings.create({ members: [{ participantId: 'agent_main' }] });
      conductor.submit(inputFor(meeting, '当前问题'));
      const second = conductor.submit(inputFor(meeting, '待发1'));
      const third = conductor.submit(inputFor(meeting, '待发2'));
      assert.ok('queued' in second && second.queued);
      assert.ok('queued' in third && third.queued);
      await started;
      core.outbox.cancel(meeting.id);
      finish();
      await conductor.idle();
      assert.deepEqual(
        core.messages.since(meeting.id, 0).map((message) => message.text),
        ['当前问题', '当前回答完成'],
      );
    } finally {
      finish();
      conductor.stop();
      await conductor.idle();
    }
  }));

test('a restarted conductor does not send retained drafts until the user resumes the queue', async () => {
  const { dir, cleanup } = await tempDir('outbox-conductor-restart');
  let core;
  let conductor;
  try {
    core = await createCore({ dataRoot: dir });
    const meeting = core.meetings.create({ members: [{ participantId: 'agent_main' }] });
    core.outbox.enqueue(inputFor(meeting, '等待明确继续'));
    core.close();
    core = await createCore({ dataRoot: dir });
    let calls = 0;
    conductor = conductorFor(core, async function* () {
      calls++;
      yield '继续后回答';
    });
    conductor.start();
    await conductor.idle();
    assert.equal(calls, 0);
    assert.equal(core.messages.since(meeting.id, 0).length, 0);
    const state = core.outbox.setPaused(meeting.id, false);
    assert.equal(state.paused, false);
    await conductor.idle();
    assert.equal(calls, 1);
    assert.equal(core.outbox.list(meeting.id).items.length, 0);
  } finally {
    conductor?.stop();
    await conductor?.idle();
    core?.close();
    await cleanup();
  }
});
