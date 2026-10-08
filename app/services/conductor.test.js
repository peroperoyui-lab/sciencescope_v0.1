import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../testing.js';
import { LOCAL_USER_ID } from '../core/defaults.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { createConductor } from './conductor.js';
import { createTools } from './tools.js';
import { createTurnRunner } from './turn-runner.js';
import { createContextAssembly } from './context-assembly.js';

/**
 * Core + scripted runtime + conductor; `say` posts as the user and waits for answers.
 * @param {import('../runtime/scripted.js').Script} script
 * @param {(context: any) => Promise<void>} work
 * @param {{ members?: Array<{ participantId: string }> }} [options]
 */
function withMeeting(script, work, { members } = {}) {
  return withCore('conductor', async (core) => {
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
    conductor.start();
    const project = await core.projects.create({ name: '气候政策' });
    const meeting = core.meetings.create({
      projectId: project.id,
      title: '方法讨论',
      members: members ?? [{ participantId: LOCAL_USER_ID }, { participantId: 'agent_main' }],
    });
    const say = async (text) => {
      core.messages.post({ meetingId: meeting.id, authorId: LOCAL_USER_ID, text });
      await conductor.idle();
      return core.messages.list(meeting.id).messages;
    };
    try {
      return await work({ core, runtime, project, meeting, say, conductor });
    } finally {
      conductor.stop();
    }
  });
}

test('the default respondent answers; later turns receive only new messages', () =>
  withMeeting(
    async function* ({ inputs }) {
      yield `第 ${inputs.length} 次回答`;
    },
    async ({ core, runtime, meeting, say }) => {
      const first = await say('先看数据');
      const answer = first.at(-1);
      assert.equal(answer.authorId, 'agent_main');
      assert.equal(answer.text, '第 1 次回答');
      assert.equal(answer.status, 'done');

      await say('再看方法');
      const [session] = runtime.sessions.values();
      assert.match(session.inputs[0], /全部发言[\s\S]*【我】\n先看数据/);
      assert.equal(session.inputs[1], '【我】\n再看方法');
      assert.match(session.instructions, /你是：主专家/);
      assert.equal(core.turns.session(meeting.id, 'agent_main').lastSeq, 3);
    },
  ));

test('text before a tool call goes to the tool card; edits are made as the AI', () =>
  withMeeting(
    async function* ({ call }) {
      yield '我先把计划记下来。';
      const project = (await call('workspace_read', { target: 'overview' })).projects[0];
      await call('workspace_edit', {
        resource: 'plans',
        key: project.id,
        op: 'append',
        args: { text: '- [ ] 清洗面板数据' },
      });
      yield '已加入计划。';
    },
    async ({ core, project, say }) => {
      const answer = (await say('帮我记个计划')).at(-1);
      assert.equal(answer.text, '已加入计划。');
      const [read, edit] = core.turns.toolCalls(answer.turnId);
      assert.equal(read.preamble, '我先把计划记下来。');
      assert.equal(edit.name, 'workspace_edit');
      assert.equal(edit.status, 'done');

      const plans = await core.workspace.read({ resource: 'plans', key: project.id });
      assert.equal(plans.text, '- [ ] 清洗面板数据');
      const [revision] = core.workspace.history({ resource: 'plans', key: project.id });
      assert.equal(revision.actorId, 'agent_main');
      assert.equal(revision.turnId, answer.turnId);
    },
  ));

test('@mentions choose who answers, in the order mentioned', () =>
  withMeeting(
    async function* ({ instructions }) {
      yield instructions.includes('你是：任务秘书') ? '秘书在' : '主专家在';
    },
    async ({ say }) => {
      const messages = await say('@任务秘书 记一下，@主专家 你也看看');
      assert.deepEqual(
        messages.slice(-2).map((message) => message.text),
        ['秘书在', '主专家在'],
      );
    },
    {
      members: [
        { participantId: LOCAL_USER_ID },
        { participantId: 'agent_main' },
        { participantId: 'agent_secretary' },
      ],
    },
  ));

test('lost working memory is rebuilt from minutes and the full record', () =>
  withMeeting(
    async function* () {
      yield '好';
    },
    async ({ core, runtime, meeting, say }) => {
      await say('第一件事');
      await core.workspace.edit({
        resource: 'minutes',
        key: meeting.id,
        op: 'write',
        args: { text: '目标：评估政策效果' },
      });
      core.turns.dropSession(meeting.id, 'agent_main');
      await say('第二件事');
      const latest = [...runtime.sessions.values()].at(-1);
      assert.match(latest.inputs[0], /纪要：\n\n目标：评估政策效果/);
      assert.match(
        latest.inputs[0],
        /【我】\n第一件事[\s\S]*【主专家】\n好[\s\S]*【我】\n第二件事/,
      );
    },
  ));

test('an answer cut by the output limit keeps its text and says so', () =>
  withMeeting(
    async function* () {
      yield '很长的分析……';
      yield { stop: 'max_tokens' };
    },
    async ({ say }) => {
      const answer = (await say('写完整的文献综述')).at(-1);
      assert.equal(answer.status, 'max_tokens');
      assert.equal(answer.text, '很长的分析……');
    },
  ));

test('interrupting stops the answer and keeps what was written', async () => {
  let started;
  const answering = new Promise((resolve) => (started = resolve));
  await withMeeting(
    async function* ({ signal }) {
      yield '开始';
      await new Promise((resolve) => {
        signal.addEventListener('abort', resolve, { once: true });
        started();
      });
      yield '不应出现';
    },
    async ({ core, meeting, conductor }) => {
      core.messages.post({ meetingId: meeting.id, authorId: LOCAL_USER_ID, text: '写吧' });
      await answering;
      await conductor.interrupt(meeting.id);
      await conductor.idle();
      const answer = core.messages.list(meeting.id).messages.at(-1);
      assert.equal(answer.status, 'cancelled');
      assert.equal(answer.text, '开始');
    },
  );
});

test('a failed answer can be retried and the same AI answers again', () => {
  let attempts = 0;
  return withMeeting(
    async function* () {
      attempts += 1;
      if (attempts === 1) yield { stop: 'failed', error: 'HTTP 502' };
      else yield '这次成功了';
    },
    async ({ meeting, say, conductor, core }) => {
      const failed = (await say('先看数据')).at(-1);
      assert.equal(failed.status, 'failed');
      await conductor.retry(failed.id);
      const answer = core.messages.list(meeting.id).messages.at(-1);
      assert.equal(answer.text, '这次成功了');
      assert.equal(answer.authorId, 'agent_main');
    },
  );
});

test('every modified workspace resource receives one history version at AI turn end and tools can restore it', () =>
  withMeeting(
    async function* ({ call }) {
      const project = (await call('workspace_read', { target: 'overview' })).projects[0];
      await call('workspace_edit', {
        resource: 'plans',
        key: project.id,
        op: 'write',
        args: { text: 'AI 第一稿' },
      });
      await call('workspace_edit', {
        resource: 'plans',
        key: project.id,
        op: 'write',
        args: { text: 'AI 最终稿' },
      });
      await call('workspace_edit', {
        resource: 'log',
        key: project.id,
        op: 'write',
        args: { text: 'AI 日志' },
      });
      yield '已保存';
    },
    async ({ core, project, meeting, say }) => {
      const answer = (await say('更新计划和日志')).at(-1);
      const tools = createTools(core);
      const context = {
        participantId: 'agent_secretary',
        meetingId: meeting.id,
        turnId: answer.turnId,
      };
      const saved = await tools.run('workspace_versions', { action: 'list' }, context);
      assert.equal(saved.length, 2);
      assert.ok(
        saved.every((item) => item.source === 'ai-turn-end' && item.turnId === answer.turnId),
      );
      const plans = saved.find((item) => item.resource === 'plans');
      assert.equal(
        (await tools.run('workspace_versions', { action: 'read', id: plans.id }, context)).text,
        'AI 最终稿',
      );
      await core.workspace.edit({
        resource: 'plans',
        key: project.id,
        op: 'write',
        args: { text: '新计划' },
      });
      const restored = await tools.run(
        'workspace_versions',
        { action: 'restore', id: plans.id },
        context,
      );
      assert.equal(restored.value, 'AI 最终稿');
      assert.equal(core.workspace.getSnapshot(restored.preservedSnapshotId).text, '新计划');
    },
  ));

test('a failed AI answer still retains the history version of edits it already applied', () =>
  withMeeting(
    async function* ({ call }) {
      const project = (await call('workspace_read', { target: 'overview' })).projects[0];
      await call('workspace_edit', {
        resource: 'plans',
        key: project.id,
        op: 'write',
        args: { text: '失败前已保存的计划' },
      });
      yield { stop: 'failed', error: 'HTTP 502' };
    },
    async ({ core, project, say }) => {
      const answer = (await say('保存计划')).at(-1);
      assert.equal(answer.status, 'failed');
      const [snapshot] = core.workspace.snapshots({ resource: 'plans', key: project.id });
      assert.equal(snapshot.turnId, answer.turnId);
      assert.equal(core.workspace.getSnapshot(snapshot.id).text, '失败前已保存的计划');
    },
  ));
