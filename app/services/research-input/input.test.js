import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../../app.js';
import { tempDir } from '../../testing.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { compileResearchInput } from './compile.js';
import { workspaceOverview } from '../assistant/overview.js';

test('materials survive drafts, queue, restart and fork; every participant receives the same source snapshot', async () => {
  const { dir, cleanup } = await tempDir('research-input');
  const calls = [];
  const runtime = () =>
    createScriptedRuntime({
      script: async function* ({ input, call }) {
        if (input.includes('FAIL_PROVIDER')) throw new Error('local provider failure');
        calls.push(input);
        const id = input.match(/<material id="([^"]+)"/u)?.[1];
        assert.ok(id);
        const result = await call('research_read', { id });
        assert.match(result.chunks[0].text, /Original evidence/u);
        yield 'The original evidence supports the answer [S1].';
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
    const project = await app.core.projects.create({ name: '中文资料' });
    const meeting = app.core.meetings.create({
      projectId: project.id,
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    const source = await app.research.importSource({
      name: '研究.txt',
      bytes: Buffer.from('Original evidence\n'.repeat(5000)),
      projectId: project.id,
    });
    assert.match(
      await readFile(path.join(app.core.paths.library, source.originalPath), 'utf8'),
      /Original evidence/u,
    );
    const snapshot = app.researchInput.change(meeting.id, {
      op: 'add',
      material: { id: source.id },
    });
    assert.ok(!compileResearchInput(snapshot).includes('Original evidence'));
    app.core.outbox.setPaused(meeting.id, true);
    app.conductor.submit({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: 'Read it',
      researchInput: app.researchInput.capture(snapshot),
    });
    await app.close();
    app = await createApp({ dataRoot: dir, token: 'test', runtime: runtime() });
    assert.deepEqual(app.researchInput.draft(meeting.id), snapshot);
    app.core.outbox.setPaused(meeting.id, false);
    await app.conductor.idle();
    const message = app.core.messages.since(meeting.id, 0)[0];
    assert.equal(message.researchInput.materials[0].id, source.id);
    const fork = app.core.meetings.fork(meeting.id, { atMessageId: message.id });
    assert.deepEqual(app.core.messages.since(fork.id, 0)[0].researchInput, message.researchInput);
    // Re-adding the same file after removing it is a new selection; an older
    // acknowledgement must not clear it.
    app.researchInput.change(meeting.id, {
      op: 'remove',
      selectionId: snapshot.materials[0].selectionId,
    });
    app.researchInput.change(meeting.id, { op: 'add', material: { id: source.id } });
    app.researchInput.change(meeting.id, { op: 'consume', input: snapshot });
    assert.equal(app.researchInput.draft(meeting.id).materials.length, 1);
    const secretary = await app.secretary.ensure(meeting.id);
    const assistant = app.assistant.ensure();
    for (const target of [secretary, assistant]) {
      app.conductor.submit({
        meetingId: target.id,
        authorId: 'person_user',
        text: 'Read attached evidence',
        researchInput: snapshot,
      });
      await app.conductor.idle();
    }
    assert.equal(calls.length, 3);
    const url = await app.listen();
    const failed = await fetch(`${url}/api/meetings/${assistant.id}/messages`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'FAIL_PROVIDER', researchInput: snapshot }),
    });
    assert.equal(failed.ok, true);
    await app.conductor.idle();
    assert.equal(app.researchInput.draft(assistant.id).materials[0].id, source.id);
    app.core.meetings.update(assistant.id, { policy: { respondent: 'agent_main' } });
    const ordinary = app.core.meetings.create({
      title: 'Ordinary research',
      policy: { respondent: 'agent_assistant' },
    });
    const overview = await workspaceOverview(app.core);
    assert.ok(!overview.includes(assistant.id));
    assert.ok(overview.includes(ordinary.id));
  } finally {
    await app.close();
    await cleanup();
  }
});

test('input compiler preserves verbatim quotes, annotations and escaped attributes without mark limits', () => {
  /** @type {{materials:any[],marks:any[]}} */
  const input = {
    materials: [{ id: 'S"<&', title: 'Paper', pages: 12 }],
    marks: Array.from({ length: 40 }, (_, i) => ({
      sourceId: 'source',
      text: `line ${i}\n\\alpha`,
      location: 'p.4',
      comment: 'Check this',
    })),
  };
  input.marks.push({
    meetingId: 'meeting',
    messageId: 'message',
    speaker: 'Expert',
    text: 'Exact words',
    comment: 'Explain',
  });
  const text = compileResearchInput(input);
  assert.match(text, /id="S&quot;&lt;&amp;"/u);
  assert.match(text, /pages="12"/u);
  assert.match(
    text,
    /<quote source-chat="meeting" source-message="message" speaker="Expert">\nExact words\n<comment>Explain<\/comment>/u,
  );
  assert.equal((text.match(/<annotation /gu) ?? []).length, 40);
  assert.ok(text.includes('line 39\n\\alpha'));
});
