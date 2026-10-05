import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../testing.js';
import { LOCAL_USER_ID } from './defaults.js';

test('a meeting keeps its members, policy and an ordered record of messages', () =>
  withCore('meetings', async (core) => {
    const project = await core.projects.create({ name: '气候政策' });
    const meeting = core.meetings.create({
      projectId: project.id,
      title: '方法讨论',
      members: [
        { participantId: LOCAL_USER_ID },
        { participantId: 'agent_main', roleNote: '主专家' },
      ],
    });
    assert.deepEqual(
      meeting.members.map((member) => member.participantId),
      [LOCAL_USER_ID, 'agent_main'],
    );
    assert.equal(meeting.policy.mode, 'direct');

    for (let index = 1; index <= 5; index++) {
      core.messages.post({
        meetingId: meeting.id,
        authorId: LOCAL_USER_ID,
        text: `第 ${index} 条`,
      });
    }
    const latest = core.messages.list(meeting.id, { limit: 2 });
    assert.deepEqual(
      latest.messages.map((message) => message.text),
      ['第 4 条', '第 5 条'],
    );
    assert.equal(latest.hasBefore, true);
    assert.equal(latest.hasAfter, false);

    const earlier = core.messages.list(meeting.id, { before: latest.messages[0].seq, limit: 10 });
    assert.equal(earlier.messages.length, 3);
    assert.equal(earlier.hasBefore, false);

    const updated = core.meetings.update(meeting.id, {
      policy: { mode: 'round', order: ['agent_main'] },
    });
    assert.equal(updated.policy.mode, 'round');
    assert.deepEqual(
      core.meetings.list({ projectId: project.id }).map((item) => item.id),
      [meeting.id],
    );
  }));

test('forking copies the record up to a message and leaves the source unchanged', () =>
  withCore('meetings', async (core) => {
    const meeting = core.meetings.create({
      title: '全局问题',
      members: [{ participantId: LOCAL_USER_ID }],
    });
    const first = core.messages.post({ meetingId: meeting.id, authorId: LOCAL_USER_ID, text: 'A' });
    core.messages.post({ meetingId: meeting.id, authorId: 'agent_main', text: 'B' });
    core.messages.post({ meetingId: meeting.id, authorId: LOCAL_USER_ID, text: 'C' });

    const branch = core.meetings.fork(meeting.id, { atMessageId: first.id });
    assert.equal(branch.parentMeetingId, meeting.id);
    assert.deepEqual(
      core.messages.list(branch.id).messages.map((message) => message.text),
      ['A'],
    );
    assert.equal(core.messages.list(meeting.id).messages.length, 3);
  }));

test('message status and review adoption are updated and published as events', () =>
  withCore('meetings', async (core) => {
    const meeting = core.meetings.create({ title: '审核', members: [] });
    const seen = [];
    core.events.subscribe((event) => seen.push(event.type));
    const review = core.messages.post({
      meetingId: meeting.id,
      authorId: 'agent_main',
      text: '',
      status: 'streaming',
    });
    core.messages.streamDelta(review.id, '结论');
    const done = core.messages.update(review.id, { text: '结论', status: 'done', adopted: false });
    assert.equal(done.adopted, false);
    assert.equal(core.messages.update(review.id, { adopted: true }).adopted, true);
    assert.deepEqual(seen, [
      'message.created',
      'message.delta',
      'message.updated',
      'message.updated',
    ]);
    assert.equal(
      core.events.since(0).filter((event) => event.type === 'message.delta').length,
      0,
      'streaming deltas are not stored',
    );
  }));
