import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../testing.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { createConductor } from './conductor.js';
import { createTurnRunner } from './turn-runner.js';
import { createContextAssembly } from './context-assembly.js';
import { createTools } from './tools.js';
import { createAppServer } from '../server/server.js';

function gate() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, open: () => resolve() };
}

test('queued input steers the next step, precedes the answer, survives retry and falls back after completion', () =>
  withCore('steering', async (core) => {
    const started = gate();
    const finish = gate();
    let calls = 0;
    const runtime = createScriptedRuntime({
      script: async function* ({ input, steered }) {
        calls++;
        if (calls === 1) {
          started.open();
          await finish.promise;
          assert.equal(steered.length, 1);
          assert.match(steered[0].input, /只看2020年以后/);
          yield '已按新条件分析';
        } else if (calls === 2 || calls === 3) {
          assert.match(input, /只看2020年以后/);
          assert.match(input, /请重新回答以下用户问题：[\s\S]*分析数据/);
          yield '重试也按新条件';
        } else yield '新的普通回答';
      },
    });
    const assembly = createContextAssembly({
      core,
      defaultModel: async () => ({ provider: 'test', model: 'test' }),
    });
    const runner = createTurnRunner({
      core,
      runtime,
      runtimeName: 'scripted',
      tools: createTools(core),
      contextAssembly: assembly,
    });
    const conductor = createConductor({ core, runner });
    const server = createAppServer({ core, conductor, token: 'test' });
    const url = await server.listen();
    conductor.start();
    const meeting = core.meetings.create({ members: [{ participantId: 'agent_main' }] });
    const insert = async (id) => {
      const response = await fetch(`${url}/api/meetings/${meeting.id}/outbox/${id}/steer`, {
        method: 'POST',
        headers: { authorization: 'Bearer test' },
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    try {
      conductor.submit({ meetingId: meeting.id, authorId: 'person_user', text: '分析数据' });
      await started.promise;
      const draft = conductor.submit({
        meetingId: meeting.id,
        authorId: 'person_user',
        text: '只看2020年以后',
      });
      assert.ok('item' in draft);
      const inserted = await insert(draft.item.id);
      assert.equal(inserted.refs.steered, true);
      assert.equal(core.outbox.list(meeting.id).items.length, 0);
      finish.open();
      await conductor.idle();
      const messages = core.messages.since(meeting.id, 0);
      assert.deepEqual(
        messages.map((m) => m.text),
        ['分析数据', '只看2020年以后', '已按新条件分析'],
      );
      assert.equal(inserted.refs.turnId, messages[2].turnId);
      assert.equal(calls, 1);
      const context = await assembly.describe({
        meetingId: meeting.id,
        participantId: 'agent_main',
        execution: { cancelled: false },
      });
      const rebuilt = await context.seedInput(null);
      assert.ok(rebuilt.input.indexOf('只看2020年以后') < rebuilt.input.indexOf('已按新条件分析'));
      await conductor.retry(messages[2].id);
      await conductor.idle();
      await conductor.retry(core.messages.since(meeting.id, 0).at(-1).id);
      await conductor.idle();
      const afterRetry = await (
        await assembly.describe({
          meetingId: meeting.id,
          participantId: 'agent_main',
          execution: { cancelled: false },
        })
      ).seedInput(null);
      assert.ok(
        afterRetry.input.indexOf('只看2020年以后') < afterRetry.input.indexOf('重试也按新条件'),
      );
      core.outbox.setPaused(meeting.id, true);
      const ordinary = core.outbox.enqueue({
        meetingId: meeting.id,
        authorId: 'person_user',
        text: '已结束后发送',
      });
      const posted = await insert(ordinary.item.id);
      assert.equal(posted.refs.steered, undefined);
      await conductor.idle();
      assert.equal(calls, 4);
    } finally {
      finish.open();
      conductor.stop();
      await conductor.idle();
      await server.close();
    }
  }));

test('an ordered round refuses steering and retains its queued input', () =>
  withCore('steering-round', async (core) => {
    const started = gate(),
      finish = gate();
    const runtime = createScriptedRuntime({
      script: async function* () {
        started.open();
        await finish.promise;
        yield '完成';
      },
    });
    const runner = createTurnRunner({
      core,
      runtime,
      runtimeName: 'scripted',
      tools: createTools(core),
      contextAssembly: createContextAssembly({
        core,
        defaultModel: async () => ({ provider: 'test', model: 'test' }),
      }),
    });
    const conductor = createConductor({ core, runner });
    const meeting = core.meetings.create({
      members: [{ participantId: 'agent_main' }],
      policy: { mode: 'round', order: ['agent_methodologist'] },
    });
    conductor.start();
    try {
      conductor.submit({ meetingId: meeting.id, authorId: 'person_user', text: '讨论' });
      await started.promise;
      const draft = conductor.submit({
        meetingId: meeting.id,
        authorId: 'person_user',
        text: '追加',
      });
      assert.ok('item' in draft);
      await assert.rejects(
        conductor.steer(meeting.id, draft.item.id),
        /有序讨论进行中不能插入，这条会在这一轮结束后发出/,
      );
      assert.equal(core.outbox.list(meeting.id).items[0].id, draft.item.id);
    } finally {
      conductor.stop();
      finish.open();
      await conductor.idle();
    }
  }));
