import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { tempDir } from '../testing.js';

test('confirmed project brief matches Main instructions on first, resumed and rebuilt turns and memory edits can be undone', async () => {
  const { dir, cleanup } = await tempDir('memory-host');
  const instructionsSeen = [];
  const runtime = createScriptedRuntime({
    script: async function* ({ instructions }) {
      instructionsSeen.push(instructions);
      yield '项目记忆已读取。';
    },
  });
  const app = await createApp({
    dataRoot: dir,
    token: 'memory-test',
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
          models: { default: { provider: 'fixture', model: 'memory-model' } },
          memory: { enabled: false },
          summary: {
            everyMessages: { enabled: false },
            everyTokens: { enabled: false },
            onEnterProject: false,
            onLeaveProject: false,
          },
        },
      },
    });
    const project = await app.core.projects.create({ name: '中文项目记忆' });
    const meeting = app.core.meetings.create({
      projectId: project.id,
      title: '确认记忆',
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    const make = (title, status = 'proposed', external = false, pinned = false) =>
      app.research.store.createItem(
        {
          projectId: project.id,
          type: 'memory',
          subtype: 'decision',
          title,
          body: title + ' 完整正文。'.repeat(1000),
          status,
          payload: {
            pinned,
            originTrust: external ? 'external' : 'user',
            evidence: [
              { meetingId: meeting.id, messageId: 'source-message', seq: 1, quote: '原始决定' },
            ],
          },
        },
        { actorId: 'agent_secretary' },
      );
    const approved = make('确认采用自然实验');
    const rejected = make('拒绝的方案');
    make('等待确认的假设');
    make('网页来源事实', 'active', true);
    const pinned = make('置顶用户目标', 'active', false, true);
    app.memory.update(approved.id, { status: 'active' });
    app.memory.update(rejected.id, { status: 'rejected' });
    const base = await app.listen();
    const request = async (route, method = 'GET', body) => {
      const response = await fetch(base + route, {
        method,
        headers: { authorization: 'Bearer memory-test', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    const brief = await request('/api/memory/brief?projectId=' + project.id);
    assert.ok(brief.text.length > 3500, 'confirmed content is never character-capped');
    assert.ok(brief.text.indexOf(pinned.title) < brief.text.indexOf(approved.title));
    assert.match(brief.text, /外部来源/);
    assert.doesNotMatch(brief.text, /拒绝的方案|等待确认的假设/);
    const say = async (text) => {
      app.core.messages.post({ meetingId: meeting.id, authorId: 'person_user', text });
      await app.conductor.idle();
    };
    await say('使用项目记忆');
    assert.ok(instructionsSeen.at(-1).includes(brief.text));
    await request('/api/memory/items/' + approved.id, 'PATCH', { title: '用户编辑后的已确认决定' });
    const updated = await request('/api/memory/brief?projectId=' + project.id);
    await say('再次使用');
    assert.ok(instructionsSeen.at(-1).includes(updated.text), 'resumed Main receives latest brief');
    app.core.turns.dropSession(meeting.id, 'agent_main');
    await say('重建后使用');
    assert.ok(instructionsSeen.at(-1).includes(updated.text));
    const history = await request('/api/memory/items/' + approved.id + '/history');
    await request('/api/memory/revisions/' + history[0].id + '/undo', 'POST');
    assert.equal(app.research.store.getItem(approved.id).title, approved.title);
    const inbox = await request('/api/memory/inbox?projectId=' + project.id);
    assert.equal(inbox.count, 1);
    assert.ok(inbox.items.every((item) => item.status === 'proposed'));
  } finally {
    await app.close();
    await cleanup();
  }
});
