import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../app.js';
import { tempDir } from '../../testing.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';

test('image attachments survive restart and fork, bypass research indexing and reach the runtime as bytes', async () => {
  const { dir, cleanup } = await tempDir('input-images');
  const calls = [];
  const runtime = () =>
    createScriptedRuntime({
      script: async function* (context) {
        calls.push(context);
        yield 'Picture received.';
      },
    });
  let app = await createApp({ dataRoot: dir, token: 'images-test', runtime: runtime() });
  try {
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          models: { default: { provider: 'test', model: 'vision' } },
          python: { defaultEnvironment: 'system' },
        },
      },
    });
    const meeting = app.core.meetings.create({
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    const base = await app.listen();
    const headers = { authorization: 'Bearer images-test', 'content-type': 'application/json' };
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    const response = await fetch(`${base}/api/research-input/${meeting.id}/attachments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '图表.png', base64 }),
    });
    assert.equal(response.status, 200);
    const draft = await response.json();
    const image = draft.materials[0];
    assert.equal(image.type, 'image');
    assert.equal(image.mimeType, 'image/png');
    const bytes = await fetch(base + image.url, { headers });
    assert.equal(bytes.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), Buffer.from(base64, 'base64'));
    assert.equal(app.research.store.listSources({}).length, 0);
    await app.close();
    app = await createApp({ dataRoot: dir, token: 'images-test', runtime: runtime() });
    assert.deepEqual(app.researchInput.draft(meeting.id), draft);
    app.conductor.submit({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: 'Explain the image',
      researchInput: app.researchInput.capture(draft),
    });
    await app.conductor.idle();
    assert.deepEqual(calls[0].images, [{ type: 'image', data: base64, mimeType: 'image/png' }]);
    assert.match(calls[0].instructions, /用户没有提到其他对话时，不查阅本对话以外的会议记录/u);
    const message = app.core.messages.since(meeting.id, 0)[0];
    const fork = app.core.meetings.fork(meeting.id, { atMessageId: message.id });
    assert.deepEqual(app.core.messages.since(fork.id, 0)[0].researchInput.materials[0], image);
    app.conductor.submit({
      meetingId: fork.id,
      authorId: 'person_user',
      text: 'Read the previous image',
    });
    await app.conductor.idle();
    assert.deepEqual(calls[1].images, calls[0].images);
    const answer = app.core.messages.since(meeting.id, 0).findLast((item) => item.turnId);
    await app.conductor.retry(answer.id);
    await app.conductor.idle();
    assert.deepEqual(calls.at(-1).images, calls[0].images);
    const settings = await app.core.workspace.read({ resource: 'settings', key: 'app' });
    assert.equal(settings.value.composer.hideWindowOnScreenshot, true);
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { composer: { hideWindowOnScreenshot: false } } },
    });
    assert.equal(
      (await app.core.workspace.read({ resource: 'settings', key: 'app' })).value.composer
        .hideWindowOnScreenshot,
      false,
    );
  } finally {
    await app.close();
    await cleanup();
  }
});
