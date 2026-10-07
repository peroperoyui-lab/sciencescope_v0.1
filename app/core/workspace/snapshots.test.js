import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createMinutesStore } from '../../services/secretary/store.js';

const user = { actorId: 'person_user' };

test('leaving an edited page saves one version, skips unchanged content and scopes minutes to its project', () =>
  withCore('snapshots-leave', async (core) => {
    const project = await core.projects.create({ name: '历史版本' });
    const target = { resource: 'plans', key: project.id };
    assert.equal(await core.workspace.captureSnapshot(target, user), null);
    await core.workspace.edit({ ...target, op: 'write', args: { text: '最初计划' } }, user);
    await core.workspace.edit({ ...target, op: 'append', args: { text: '补充计划' } }, user);
    const first = await core.workspace.captureSnapshot(target, user);
    assert.equal(first.source, 'leave-page');
    assert.equal(first.actorId, 'person_user');
    assert.equal(await core.workspace.captureSnapshot(target, user), null);
    assert.equal(core.workspace.snapshots({ projectId: project.id }).length, 1);
    assert.equal(
      core.workspace.history(target).length,
      2,
      'fine-grained revisions remain internal',
    );
    const meeting = core.meetings.create({ projectId: project.id });
    await core.workspace.edit(
      { resource: 'minutes', key: meeting.id, op: 'write', args: { text: '手工纪要' } },
      user,
    );
    const minutes = await core.workspace.captureSnapshot(
      { resource: 'minutes', key: meeting.id },
      user,
    );
    assert.equal(minutes.projectId, project.id);
    assert.equal(core.workspace.snapshots({ projectId: project.id }).length, 2);
    assert.equal(core.workspace.getSnapshot(minutes.id).text, '手工纪要');
  }));

test('restoring an old version preserves unsaved current content and deleting history keeps files and revisions', () =>
  withCore('snapshots-restore', async (core) => {
    const project = await core.projects.create({ name: '恢复版本' });
    const target = { resource: 'log', key: project.id };
    const write = (text) => core.workspace.edit({ ...target, op: 'write', args: { text } }, user);
    await write('旧日志');
    const first = await core.workspace.captureSnapshot(target, user);
    await write('尚未形成版本的新日志');
    const restored = await core.workspace.restoreSnapshot(first.id, user);
    assert.equal((await core.workspace.read(target)).text, '旧日志');
    const preserved = core.workspace.getSnapshot(restored.preservedSnapshotId);
    assert.equal(preserved.text, '尚未形成版本的新日志');
    assert.equal(preserved.source, 'before-restore');
    await core.workspace.restoreSnapshot(preserved.id, user);
    assert.equal((await core.workspace.read(target)).text, preserved.text);
    const revisions = core.workspace.history(target).length;
    assert.deepEqual(core.workspace.deleteSnapshot(first.id, user), { deleted: true });
    assert.throws(() => core.workspace.getSnapshot(first.id), { code: 'SNAPSHOT_NOT_FOUND' });
    assert.equal((await core.workspace.read(target)).text, preserved.text);
    assert.equal(core.workspace.history(target).length, revisions);
  }));

test('AI turn boundaries preserve its final content per resource despite concurrent writers and are retry-safe', () =>
  withCore('snapshots-turn', async (core) => {
    const project = await core.projects.create({ name: '并发版本' });
    const meeting = core.meetings.create({ projectId: project.id });
    const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    const actor = { actorId: 'agent_main', meetingId: meeting.id, turnId: turn.id };
    const plans = { resource: 'plans', key: project.id, op: 'write' };
    await core.workspace.edit({ ...plans, args: { text: 'AI 第一稿' } }, actor);
    await core.workspace.edit({ ...plans, args: { text: 'AI 最终稿' } }, actor);
    await core.workspace.edit(
      { resource: 'map', key: project.id, op: 'addNode', args: { node: { text: 'AI 导图' } } },
      actor,
    );
    await core.workspace.edit({ ...plans, args: { text: '用户并行修改' } }, user);
    const saved = core.workspace.captureTurnSnapshots(turn.id);
    assert.equal(saved.length, 2);
    assert.equal(
      core.workspace.getSnapshot(saved.find((item) => item.resource === 'plans').id).text,
      'AI 最终稿',
    );
    assert.equal((await core.workspace.read(plans)).text, '用户并行修改');
    assert.deepEqual(core.workspace.captureTurnSnapshots(turn.id), []);
    assert.equal(core.workspace.snapshots({ projectId: project.id }).length, 2);
  }));

test('restoring minutes restores their original coverage instead of retaining later summarized messages', () =>
  withCore('snapshots-minutes', async (core) => {
    const meeting = core.meetings.create({});
    const store = createMinutesStore(core);
    const target = { resource: 'minutes', key: meeting.id };
    const first = await core.workspace.edit(
      { ...target, op: 'write', args: { text: '第一轮纪要' } },
      user,
    );
    store.save(meeting.id, first.revisionId, 1, ['message-first']);
    const snapshot = await core.workspace.captureSnapshot(target, user);
    const second = await core.workspace.edit(
      { ...target, op: 'write', args: { text: '第二轮纪要' } },
      user,
    );
    store.save(meeting.id, second.revisionId, 5, ['message-first', 'message-later']);
    const restored = await core.workspace.restoreSnapshot(snapshot.id, user);
    assert.deepEqual(store.state(meeting.id, restored.revisionId), {
      throughSeq: 1,
      coveredMessageIds: ['message-first'],
    });
    core.workspace.deleteSnapshot(snapshot.id, user);
    assert.equal(
      store.state(meeting.id).throughSeq,
      1,
      'deleting a snapshot does not delete revision ancestry',
    );
  }));
