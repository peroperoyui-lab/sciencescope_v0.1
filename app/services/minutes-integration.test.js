import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { tempDir } from '../testing.js';

// These paths exercise the real host wiring, not manually emitted completion events.
test('ordered completion and project focus reach the secretary through the host', async () => {
  const { dir, cleanup } = await tempDir('minutes-integration');
  const runtime = createScriptedRuntime({
    script: async function* ({ instructions }) {
      yield instructions.includes('你是：方法学家') ? '专家结论' : '# 研究目标\n增量纪要';
    },
  });
  const app = await createApp({
    dataRoot: dir,
    token: 'minutes-test',
    runtime,
    runtimeName: 'scripted',
  });
  const url = await app.listen();
  const call = async (route, body) => {
    const response = await fetch(url + route, {
      method: 'POST',
      headers: { authorization: 'Bearer minutes-test', 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          models: { default: { provider: 'test', model: 'test' } },
          summary: { everyMessages: { enabled: false }, everyTokens: { enabled: false } },
        },
      },
    });
    const project = await app.core.projects.create({ name: '中文纪要项目' });
    const meeting = app.core.meetings.create({
      projectId: project.id,
      title: '有序讨论',
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
      policy: { mode: 'round', order: ['agent_methodologist'], reviewer: null },
    });
    await call(`/api/meetings/${meeting.id}/messages`, { text: '请讨论政策目标' });
    await app.conductor.idle();
    await app.minutes.idle();
    let status = await app.minutes.status(meeting.id);
    assert.equal(status.throughSeq, 2);
    assert.match(status.text, /增量纪要/);
    assert.ok(
      app.core.meetings
        .contexts(meeting.id)
        .every((entry) => entry.participantId !== 'agent_secretary'),
      'disposable background usage does not replace foreground context measurements',
    );
    const messages = app.core.messages.since(meeting.id, 0);
    assert.equal(messages.length, 2, 'background summary never creates a meeting message');
    const turns = app.core.db.prepare('SELECT participant_id, usage_json FROM turns').all();
    assert.ok(turns.some((row) => row.participant_id === 'agent_secretary' && row.usage_json));
    await call(`/api/meetings/${meeting.id}/minutes`, {
      text: '用户编辑的目标',
      expectedRevision: status.revision,
    });
    app.core.meetings.update(meeting.id, { members: [], policy: { mode: 'direct' } });
    app.core.messages.post({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: '进入项目的新进展',
    });
    await call(`/api/projects/${project.id}/focus`, { focused: true });
    await app.minutes.idle();
    status = await app.minutes.status(meeting.id);
    assert.equal(status.throughSeq, 3);
    const lastInput = [...runtime.sessions.values()].at(-1).inputs[0];
    assert.match(lastInput, /用户编辑的目标/);
    assert.match(lastInput, /进入项目的新进展/);
    assert.doesNotMatch(lastInput, /请讨论政策目标/);
    app.core.messages.post({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: '离开项目的新进展',
    });
    await call(`/api/projects/${project.id}/focus`, { focused: false });
    await app.minutes.idle();
    assert.equal((await app.minutes.status(meeting.id)).throughSeq, 4);
  } finally {
    await app.close();
    await cleanup();
  }
});
