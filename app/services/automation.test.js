import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore, tempDir } from '../testing.js';
import { createCore } from '../core/index.js';
import { openDatabase } from '../core/db/database.js';
import { migrations } from '../core/db/migrations/index.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { createConductor } from './conductor.js';
import { createTurnRunner } from './turn-runner.js';
import { createTools } from './tools.js';
import { createContextAssembly } from './context-assembly.js';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { createAppServer } from '../server/server.js';

function deferred() {
  let resolve = () => {};
  const promise = new Promise((done) => (resolve = () => done(undefined)));
  return { promise, resolve };
}

/**
 * @param {import('../runtime/scripted.js').Script} script
 * @param {(context:any)=>Promise<void>} work
 */
function withAutomation(script, work) {
  return withCore('automation', async (core) => {
    const runtime = createScriptedRuntime({ script });
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
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    conductor.start();
    try {
      await work({
        core,
        runtime,
        conductor,
        meeting,
        goal: () => core.goals.get(meeting.id),
        start: (maxRounds = 30) =>
          conductor.startGoal(meeting.id, { text: '分析数据并写日志', maxRounds }),
      });
    } finally {
      conductor.stop();
      await conductor.idle();
    }
  });
}

test('a goal continues through turns and completes through the shared tool', () =>
  withAutomation(
    async function* ({ inputs, call, input }) {
      assert.match(input, /自动化目标：分析数据并写日志/);
      if (inputs.length === 3)
        await call('goal_update', { status: 'complete', summary: '已经分析并记录。' });
      yield `完成第 ${inputs.length} 步`;
    },
    async ({ core, conductor, meeting, goal, start }) => {
      const events = [];
      const unsubscribe = core.events.subscribe((event) => events.push(event));
      start();
      await conductor.idle();
      unsubscribe();
      assert.equal(goal().status, 'completed');
      assert.equal(goal().rounds, 3);
      assert.equal(core.messages.since(meeting.id, 0).length, 4);
      assert.equal(events.filter((event) => event.type === 'turn.ended').length, 3);
      assert.equal(
        events.filter((event) => event.type === 'goal.changed').at(-1).payload.reason,
        '已经分析并记录。',
      );
    },
  ));

test('blocked waits for the user and their answer continues the goal', () =>
  withAutomation(
    async function* ({ inputs, call, input }) {
      if (inputs.length === 1)
        await call('goal_update', { status: 'blocked', summary: '请确认变量。' });
      else {
        assert.match(input, /使用收入变量/);
        await call('goal_update', { status: 'complete', summary: '已完成。' });
      }
      yield '已记录';
    },
    async ({ conductor, meeting, goal, start }) => {
      start();
      await conductor.idle();
      assert.equal(goal().status, 'blocked');
      conductor.submit({ meetingId: meeting.id, authorId: 'person_user', text: '使用收入变量' });
      await conductor.idle();
      assert.equal(goal().status, 'completed');
      assert.equal(goal().rounds, 2);
    },
  ));

test('pause finishes the current turn, resume starts the next, and queued input reaches it', async () => {
  const entered = deferred();
  const release = deferred();
  await withAutomation(
    async function* ({ inputs, call, input }) {
      if (inputs.length === 1) {
        entered.resolve();
        await release.promise;
      } else {
        assert.match(input, /请同时保存图表/);
        await call('goal_update', { status: 'complete', summary: '已保存图表。' });
      }
      yield '进展';
    },
    async ({ core, conductor, meeting, goal, start }) => {
      start();
      await entered.promise;
      assert.equal(
        conductor.submit({ meetingId: meeting.id, authorId: 'person_user', text: '请同时保存图表' })
          .queued,
        true,
      );
      await conductor.controlGoal(meeting.id, { action: 'pause' });
      release.resolve();
      await conductor.idle();
      assert.equal(goal().status, 'paused');
      assert.equal(goal().rounds, 1);
      assert.equal(core.outbox.list(meeting.id).items.length, 1);
      await conductor.controlGoal(meeting.id, { action: 'resume' });
      await conductor.idle();
      assert.equal(goal().status, 'completed');
      assert.equal(core.outbox.list(meeting.id).items.length, 0);
      assert.equal(
        core.messages.since(meeting.id, 0).filter((message) => message.turnId).length,
        2,
      );
    },
  );
});

test('ending interrupts the current goal turn and retains its partial answer', async () => {
  const entered = deferred();
  await withAutomation(
    async function* ({ signal }) {
      yield '已开始';
      await new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true });
        entered.resolve();
      });
    },
    async ({ core, conductor, meeting, goal, start }) => {
      start();
      await entered.promise;
      await conductor.controlGoal(meeting.id, { action: 'end' });
      await conductor.idle();
      assert.equal(goal().status, 'ended');
      const answer = core.messages.since(meeting.id, 0).at(-1);
      assert.equal(answer.status, 'cancelled');
      assert.equal(answer.text, '已开始');
    },
  );
});

test('closing after the model reports completion preserves the completed goal', async () => {
  const reported = deferred();
  await withAutomation(
    async function* ({ call, signal }) {
      await call('goal_update', { status: 'complete', summary: '工作已完成。' });
      yield '最后汇报仍在输出。';
      await new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true });
        reported.resolve();
      });
    },
    async ({ conductor, goal, start }) => {
      start();
      await reported.promise;
      conductor.stop();
      await conductor.idle();
      assert.equal(goal().status, 'completed');
      assert.equal(goal().reason, '工作已完成。');
    },
  );
});

test('the user round setting pauses the goal and can be increased for continuation', () =>
  withAutomation(
    async function* ({ inputs, call }) {
      if (inputs.length === 3)
        await call('goal_update', { status: 'complete', summary: '三步完成。' });
      yield '一步';
    },
    async ({ conductor, meeting, goal, start }) => {
      start(2);
      await conductor.idle();
      assert.equal(goal().status, 'paused');
      assert.equal(goal().rounds, 2);
      assert.match(goal().reason, /最多轮数/);
      await conductor.controlGoal(meeting.id, { action: 'resume', maxRounds: 4 });
      await conductor.idle();
      assert.equal(goal().status, 'completed');
      assert.equal(goal().rounds, 3);
    },
  ));

test('a failed turn pauses the goal with its error and can be continued', () =>
  withAutomation(
    async function* ({ inputs, call }) {
      if (inputs.length === 1) yield { stop: 'failed', error: '测试服务暂时不可用' };
      else await call('goal_update', { status: 'complete', summary: '恢复完成。' });
    },
    async ({ conductor, meeting, goal, start }) => {
      start();
      await conductor.idle();
      assert.equal(goal().status, 'paused');
      assert.match(goal().reason, /测试服务暂时不可用/);
      await conductor.controlGoal(meeting.id, { action: 'resume' });
      await conductor.idle();
      assert.equal(goal().status, 'completed');
    },
  ));

test('inputs sent while running join the next turn without an extra direct answer', async () => {
  const entered = deferred();
  const release = deferred();
  await withAutomation(
    async function* ({ inputs, call, input }) {
      if (inputs.length === 1) {
        entered.resolve();
        await release.promise;
      } else {
        assert.match(input, /先检查缺失值/);
        await call('goal_update', { status: 'complete', summary: '已检查。' });
      }
      yield '进展';
    },
    async ({ conductor, meeting, goal, start }) => {
      start();
      await entered.promise;
      conductor.submit({ meetingId: meeting.id, authorId: 'person_user', text: '先检查缺失值' });
      release.resolve();
      await conductor.idle();
      assert.equal(goal().status, 'completed');
      assert.equal(goal().rounds, 2);
    },
  );
});

test('v13 upgrade retains messages and a reopened goal pauses without starting work', async () => {
  const { dir, cleanup } = await tempDir('automation-upgrade');
  let core;
  try {
    const db = await openDatabase(path.join(dir, 'sciencescope.sqlite'), {
      migrations: migrations.slice(0, 13),
      backupDir: path.join(dir, 'backups'),
    });
    db.close();
    core = await createCore({ dataRoot: dir });
    const meeting = core.meetings.create({ title: '保留的会议' });
    core.messages.post({ meetingId: meeting.id, authorId: 'person_user', text: '原文' });
    core.goals.start(meeting.id, '待继续的目标');
    core.goals.update(meeting.id, { rounds: 2 });
    core.close();
    core = await createCore({ dataRoot: dir });
    assert.equal(core.goals.get(meeting.id).status, 'paused');
    assert.equal(core.goals.get(meeting.id).rounds, 2);
    assert.equal(core.messages.since(meeting.id, 0)[0].text, '原文');
    assert.equal(core.turns.running().length, 0);
    assert.equal(
      core.db.prepare('PRAGMA user_version').get().user_version,
      migrations.at(-1).version,
    );
    assert.equal((await readdir(path.join(dir, 'backups'))).length, 1);
  } finally {
    core?.close();
    await cleanup();
  }
});

test('the meeting API starts and controls a goal with persistent events', () =>
  withAutomation(
    async function* () {
      yield '一轮进展';
    },
    async ({ core, conductor, meeting }) => {
      const server = createAppServer({ core, conductor, token: 'goal-test' });
      const url = await server.listen();
      const call = async (method, suffix, body) => {
        const response = await fetch(`${url}/api/meetings/${meeting.id}/goal${suffix}`, {
          method,
          headers: { authorization: 'Bearer goal-test', 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      try {
        await call('POST', '', { text: '接口目标', maxRounds: 1 });
        await conductor.idle();
        assert.equal((await call('GET', '')).rounds, 1);
        await call('PATCH', '', { action: 'resume', maxRounds: 2 });
        await conductor.idle();
        assert.equal((await call('GET', '')).rounds, 2);
        assert.equal((await call('PATCH', '', { action: 'end' })).status, 'ended');
      } finally {
        await server.close();
      }
    },
  ));

test('automation and ordered discussion remain mutually exclusive; utility meetings keep direct answers', () =>
  withCore('goal-meeting-modes', async (core) => {
    const meeting = core.meetings.create({ policy: { mode: 'round' } });
    assert.throws(() => core.goals.start(meeting.id, '目标'), { code: 'GOAL_DISCUSSION_CONFLICT' });
    core.meetings.update(meeting.id, { policy: { mode: 'direct' } });
    core.goals.start(meeting.id, '目标');
    assert.throws(() => core.meetings.update(meeting.id, { policy: { mode: 'round' } }), {
      code: 'GOAL_DISCUSSION_CONFLICT',
    });
    const secretary = core.meetings.create({ attachedTo: meeting.id });
    assert.throws(() => core.goals.start(secretary.id, '目标'), { code: 'GOAL_NOT_AVAILABLE' });
    const assistant = core.meetings.create({ policy: { respondent: 'agent_assistant' } });
    core.db
      .prepare('INSERT INTO assistant_state(singleton,meeting_id) VALUES(1,?)')
      .run(assistant.id);
    assert.throws(() => core.goals.start(assistant.id, '目标'), { code: 'GOAL_NOT_AVAILABLE' });
  }));
