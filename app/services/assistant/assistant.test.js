import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../app.js';
import { tempDir } from '../../testing.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';

test('global assistant persists one meeting, deduplicates overview and edits project plans through shared tools with history', async () => {
  const { dir, cleanup } = await tempDir('assistant');
  const inputs = [];
  const runtime = createScriptedRuntime({
    script: async function* ({ input, call }) {
      inputs.push(input);
      if (input.includes('EDIT_PLAN')) {
        const match = input.match(/PROJECT_ID=(\S+)/u);
        const plans = await call('workspace_read', { target: 'plans', key: match[1] });
        assert.match(plans.value, /Clean initial/u);
        await call('workspace_edit', {
          resource: 'plans',
          key: match[1],
          op: 'append',
          args: { text: '\n- Clean updated' },
        });
      }
      yield 'Assistant answer';
    },
  });
  let app = await createApp({ dataRoot: dir, token: 'test', runtime, runtimeName: 'scripted' });
  try {
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { models: { default: { provider: 'test', model: 'test' } } } },
    });
    const project = await app.core.projects.create({
      name: '中文研究',
      description: 'Research goal',
    });
    await app.core.workspace.edit({
      resource: 'plans',
      key: project.id,
      op: 'write',
      args: { text: '- Clean initial' },
    });
    await app.core.workspace.edit({
      resource: 'map',
      key: project.id,
      op: 'addNode',
      args: { node: { text: 'Identification' } },
    });
    const research = app.core.meetings.create({
      projectId: project.id,
      title: 'Research meeting',
      members: [{ participantId: 'agent_main' }],
    });
    await app.core.workspace.edit({
      resource: 'minutes',
      key: research.id,
      op: 'write',
      args: {
        text: '## Research questions and goals\nGoal marker\n## To-dos and next steps\nTodo marker',
      },
    });
    app.core.meetings.create({
      projectId: project.id,
      title: 'TEMPORARY_SECRET_MARKER',
      temporary: true,
    });
    app.secretary.ensure(research.id);
    app.research.store.createItem({
      projectId: project.id,
      type: 'knowledge',
      title: 'PRIVATE_ITEM_MARKER',
      body: 'PRIVATE_BODY_MARKER',
      visibility: 'private',
    });
    const meeting = app.assistant.ensure();
    assert.equal(app.assistant.ensure().id, meeting.id);
    assert.equal(meeting.projectId, null);
    assert.deepEqual(
      meeting.members.map((m) => m.participantId),
      ['person_user', 'agent_assistant'],
    );
    const say = async (text) => {
      app.conductor.submit({ meetingId: meeting.id, authorId: 'person_user', text });
      await app.conductor.idle();
    };
    await say('Hello');
    assert.match(
      inputs[0],
      /工作区概览[\s\S]*Research goal[\s\S]*Clean initial[\s\S]*Identification[\s\S]*Goal marker[\s\S]*Todo marker/u,
    );
    assert.doesNotMatch(
      inputs[0],
      /TEMPORARY_SECRET_MARKER|PRIVATE_ITEM_MARKER|PRIVATE_BODY_MARKER|任务秘书/u,
    );
    await say('Unchanged');
    assert.doesNotMatch(inputs[1], /工作区概览/u);
    await say('EDIT_PLAN PROJECT_ID=' + project.id);
    assert.match(
      (await app.core.workspace.read({ resource: 'plans', key: project.id })).text,
      /Clean updated/u,
    );
    const versions = app.core.workspace.snapshots({ resource: 'plans', key: project.id });
    assert.equal(versions[0].actorId, 'agent_assistant');
    await say('Changed workspace');
    assert.match(inputs[3], /工作区概览[\s\S]*Clean updated/u);
    app.core.turns.dropSession(meeting.id, 'agent_assistant');
    await say('Rebuild');
    assert.match(inputs[4], /工作区概览[\s\S]*Clean updated/u);
    const url = await app.listen();
    const response = await fetch(url + '/api/assistant', {
      headers: { authorization: 'Bearer test' },
    });
    assert.equal((await response.json()).id, meeting.id);
    await app.close();
    app = await createApp({
      dataRoot: dir,
      token: 'test',
      runtime: createScriptedRuntime({
        script: async function* () {
          yield 'Again';
        },
      }),
      runtimeName: 'scripted',
    });
    assert.equal(app.assistant.ensure().id, meeting.id);
    assert.equal(app.core.messages.since(meeting.id, 0).length, 10);
  } finally {
    await app.close();
    await cleanup();
  }
});
