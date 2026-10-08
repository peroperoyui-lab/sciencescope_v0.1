import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../app.js';
import { tempDir } from '../../testing.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';

test('marks retain exact provenance through restart, edits, successful sends and later provider failure', async () => {
  const { dir, cleanup } = await tempDir('marks');
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  const inputs = [];
  const runtime = () =>
    createScriptedRuntime({
      script: async function* ({ input }) {
        inputs.push(input);
        yield 'Partial answer';
        await gate;
        throw new Error('provider failure');
      },
    });
  let app = await createApp({ dataRoot: dir, token: 'test', runtime: runtime() });
  try {
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { models: { default: { provider: 'test', model: 'test' } } } },
    });
    const meeting = app.core.meetings.create({
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    const mark = {
      meetingId: meeting.id,
      messageId: 'source-message',
      speaker: 'Author',
      text: 'Exact\noriginal',
      comment: 'first note',
    };
    const initial = app.researchInput.change(meeting.id, { op: 'mark-add', mark });
    await app.close();
    app = await createApp({ dataRoot: dir, token: 'test', runtime: runtime() });
    assert.deepEqual(app.researchInput.draft(meeting.id).marks, initial.marks);
    const changed = app.researchInput.change(meeting.id, {
      op: 'mark-edit',
      id: initial.marks[0].id,
      comment: 'newer note',
    });
    app.researchInput.change(meeting.id, { op: 'consume', input: initial });
    assert.deepEqual(app.researchInput.draft(meeting.id).marks, changed.marks);
    const url = await app.listen();
    await fetch(`${url}/api/meetings/${meeting.id}/messages`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Read selected evidence', researchInput: changed }),
    });
    assert.equal(app.researchInput.draft(meeting.id).marks.length, 0);
    app.researchInput.change(meeting.id, {
      op: 'mark-add',
      mark: { ...mark, text: 'Added after send' },
    });
    release();
    await app.conductor.idle();
    const restored = app.researchInput.draft(meeting.id).marks;
    assert.equal(restored.length, 2);
    assert.equal(restored.find((entry) => entry.id === initial.marks[0].id).comment, 'newer note');
    assert.match(inputs[0], /<quote source-chat=/u);
    assert.ok(inputs[0].includes('Exact\noriginal'));
    app.researchInput.change(meeting.id, { op: 'marks-clear' });
    assert.equal(app.researchInput.draft(meeting.id).marks.length, 0);
  } finally {
    release();
    await app.close();
    await cleanup();
  }
});
