import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore, tempDir } from '../testing.js';
import { createCore } from './index.js';

test('queued drafts can be edited, canceled and dispatched without appearing in the formal record early', () =>
  withCore('outbox-drafts', async (core) => {
    const meeting = core.meetings.create({});
    const input = { meetingId: meeting.id, authorId: 'person_user' };
    const first = core.outbox.enqueue({
      ...input,
      text: '第一条',
      refs: { contextRefs: [{ path: '材料.md' }] },
    }).item;
    const second = core.outbox.enqueue({ ...input, text: '第二条' }).item;
    assert.equal(core.messages.since(meeting.id, 0).length, 0);
    const state = core.outbox.edit(meeting.id, first.id, { text: '修改后的第一条' });
    assert.ok(
      state.version >
        core.events.since(0).find((event) => event.type === 'meeting.outbox.changed').payload
          .version,
    );
    assert.equal(state.items[0].text, '修改后的第一条');
    assert.deepEqual(state.items[0].refs, { contextRefs: [{ path: '材料.md' }] });
    assert.equal(core.outbox.cancel(meeting.id, second.id).items.length, 1);
    const message = core.outbox.dispatch(meeting.id);
    assert.equal(message.text, '修改后的第一条');
    assert.deepEqual(message.refs, first.refs);
    assert.equal(core.outbox.list(meeting.id).items.length, 0);
    assert.equal(core.messages.since(meeting.id, 0).length, 1);
    assert.equal(core.outbox.dispatch(meeting.id), null);
    core.outbox.enqueue({ ...input, text: '第三条' });
    core.outbox.enqueue({ ...input, text: '第四条' });
    assert.equal(core.outbox.cancel(meeting.id).items.length, 0);
  }));

test('reopening retains all queued drafts paused until explicit resume and does not duplicate dispatched messages', async () => {
  const { dir, cleanup } = await tempDir('outbox-restart');
  let core;
  try {
    core = await createCore({ dataRoot: dir });
    const meeting = core.meetings.create({});
    const input = { meetingId: meeting.id, authorId: 'person_user' };
    core.outbox.enqueue({ ...input, text: '已发送' });
    const sent = core.outbox.dispatch(meeting.id);
    const emptyMeeting = core.meetings.create({});
    core.outbox.enqueue({
      meetingId: emptyMeeting.id,
      authorId: 'person_user',
      text: '已发空队列',
    });
    core.outbox.dispatch(emptyMeeting.id);
    const queued = core.outbox.enqueue({ ...input, text: '重启后待发' }).item;
    core.close();
    core = await createCore({ dataRoot: dir });
    assert.equal(core.outbox.list(meeting.id).paused, true);
    assert.equal(
      core.outbox.list(emptyMeeting.id).paused,
      false,
      'empty queues stay ready for new messages after restart',
    );
    assert.equal(core.outbox.list(meeting.id).items[0].id, queued.id);
    assert.equal(core.outbox.dispatch(meeting.id), null);
    assert.deepEqual(
      core.messages.since(meeting.id, 0).map((message) => message.id),
      [sent.id],
    );
    core.outbox.setPaused(meeting.id, false);
    assert.equal(core.outbox.dispatch(meeting.id).text, queued.text);
    assert.equal(core.messages.since(meeting.id, 0).length, 2);
  } finally {
    core?.close();
    await cleanup();
  }
});
