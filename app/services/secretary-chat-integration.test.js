import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { tempDir } from '../testing.js';

// The ordinary conductor/runner serves the attached chat; failed sends never
// acknowledge Main evidence even though their own partial text is retained.
test('secretary follows Main, keeps failure and stop cursors, and persists tool proposals through restart', async () => {
  const { dir, cleanup } = await tempDir('secretary-chat-integration');
  let attempt = 0;
  let beganStop = () => {};
  const stoppedStart = new Promise((resolve) => {
    beganStop = () => resolve(undefined);
  });
  const inputs = [];
  const runtime = createScriptedRuntime({
    script: async function* ({ input, call, signal }) {
      inputs.push(input);
      attempt += 1;
      if (attempt === 1) {
        yield '失败部分';
        yield { stop: 'failed', error: 'HTTP 502' };
        return;
      }
      if (attempt === 3) {
        yield '停止部分';
        beganStop();
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        return;
      }
      await call('propose_main_draft', { text: '请把清洗数据加入计划。' });
      yield '草稿准备好了。';
    },
  });
  let app = await createApp({
    dataRoot: dir,
    token: 'secretary-test',
    runtime,
    runtimeName: 'scripted',
  });
  try {
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          models: { default: { provider: 'test', model: 'meeting' } },
          summary: {
            everyMessages: { enabled: false },
            everyTokens: { enabled: false },
            onEnterProject: false,
            onLeaveProject: false,
          },
        },
      },
    });
    const main = app.core.meetings.create({ title: '主会议', members: [] });
    app.core.messages.post({
      meetingId: main.id,
      authorId: 'person_user',
      text: '原始用户研究目标',
    });
    const chat = app.secretary.ensure(main.id);
    assert.equal(app.secretary.ensure(main.id).id, chat.id);
    app.core.meetings.update(chat.id, {
      policy: { model: { provider: 'test', model: 'secretary-override', effort: 'high' } },
    });
    const say = async (text) => {
      app.core.messages.post({ meetingId: chat.id, authorId: 'person_user', text });
      await app.conductor.idle();
    };
    await say('帮我整理');
    assert.equal(app.secretary.cursor(chat.id).throughSeq, 0);
    await say('再回答');
    assert.equal(app.secretary.cursor(chat.id).throughSeq, 1);
    assert.ok(inputs[0].includes('原始用户研究目标'));
    assert.ok(inputs[1].includes('原始用户研究目标'), 'failed follow-up must be supplied again');
    assert.equal([...runtime.sessions.values()].at(-1).model.model, 'secretary-override');
    assert.equal(app.core.messages.since(main.id, 0).length, 1, 'proposal is never posted to Main');
    const [proposal] = app.secretary.list(main.id);
    assert.equal(proposal.actorId, 'agent_secretary');
    app.core.messages.post({
      meetingId: main.id,
      authorId: 'agent_main',
      text: '停止时尚未消费的原文',
    });
    app.core.messages.post({ meetingId: chat.id, authorId: 'person_user', text: '这次停止' });
    await stoppedStart;
    await app.conductor.interrupt(chat.id);
    await app.conductor.idle();
    assert.equal(app.secretary.cursor(chat.id).throughSeq, 1);
    app.core.turns.dropSession(chat.id, 'agent_secretary');
    await say('会话丢失后重新起草');
    assert.equal(app.secretary.cursor(chat.id).throughSeq, 2);
    assert.match(inputs.at(-1), /原始用户研究目标[\s\S]*停止时尚未消费的原文/);
    const mainId = main.id,
      chatId = chat.id,
      proposalId = proposal.id;
    await app.close();
    app = await createApp({
      dataRoot: dir,
      token: 'secretary-test',
      runtime: createScriptedRuntime({
        script: async function* () {
          yield '重启';
        },
      }),
      runtimeName: 'scripted',
    });
    assert.equal(app.secretary.ensure(mainId).id, chatId);
    assert.ok(
      app.secretary
        .list(mainId)
        .some((value) => value.id === proposalId && value.text.includes('清洗数据')),
    );
    assert.equal(app.secretary.cursor(chatId).throughSeq, 2);
    const edit = app.secretary.decide(proposalId, { text: '用户修改后再填入', status: 'filled' });
    assert.equal(app.core.messages.since(mainId, 0).length, 2);
    app.secretary.undo(edit.historyId);
    assert.equal(
      app.secretary.list(mainId).find((value) => value.id === proposalId).status,
      'pending',
    );
  } finally {
    await app.close();
    await cleanup();
  }
});
