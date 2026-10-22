import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { tempDir } from '../../testing.js';
import { createApp } from '../../app.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { fakeUv } from '../python/testing.js';
import { WORD } from './docx/xml.js';
import { WORD14 } from './docx/ids.js';

test('selection rewrite posts a version mark, returns its turn and queues busy edits without starting another turn', async () => {
  const fixture = await tempDir('desk-rewrite');
  let key;
  let entered = () => {};
  let release = () => {};
  let count = 0;
  const started = new Promise((resolve) => {
    entered = () => resolve(undefined);
  });
  const gate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  const runtime = createScriptedRuntime({
    script: async function* ({ call, input, instructions }) {
      const index = count++;
      assert.match(instructions, /workspace_edit resource=manuscript/u);
      assert.match(input, /<annotation/u);
      assert.ok(input.includes(`manuscript="${key}"`));
      assert.match(input, /&quot;kind&quot;:&quot;version&quot;/u);
      if (index === 0) {
        entered();
        await gate;
      }
      const read = await call('workspace_read', { target: 'manuscript', key });
      const result = await call('workspace_edit', {
        resource: 'manuscript',
        key,
        op: 'replace',
        args: { block: read.blocks[index].id, find: '显著', with: '可能' },
      });
      assert.equal(result.revisionIds.length, 1);
      await call('desk_suggest', { reason: '继续核对表述', document: key });
      yield '已缓和这一句的语气。';
    },
  });
  const app = await createApp({
    dataRoot: path.join(fixture.dir, 'data'),
    token: 'rewrite-test',
    runtime,
    runtimeName: 'scripted',
    pythonOptions: { runner: fakeUv().runner },
  });
  const base = await app.listen();
  async function api(method, route, body, status = 200) {
    const response = await fetch(base + '/api/' + route, {
      method,
      headers: { authorization: 'Bearer rewrite-test', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  }
  try {
    await api('PATCH', 'settings', {
      models: { default: { provider: 'test', model: 'test' } },
      python: { defaultEnvironment: 'system' },
      memory: { enabled: false },
      summary: {
        everyMessages: { enabled: false },
        everyTokens: { enabled: false },
        onEnterProject: false,
        onLeaveProject: false,
      },
    });
    const folder = path.join(fixture.dir, '项目');
    await mkdir(folder);
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="${WORD}" xmlns:w14="${WORD14}"><w:body><w:p w14:paraId="00000001"><w:r><w:t>研究显著提高效率。</w:t></w:r></w:p><w:p w14:paraId="00000002"><w:r><w:t>另一句显著提高收益。</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    );
    await writeFile(
      path.join(folder, '论文.docx'),
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    const project = await app.core.projects.create({ name: '划选改写', folder });
    app.versionNotes.configure(project.id, false);
    const group = await app.desk.registerDocument({ projectId: project.id, path: '论文.docx' });
    key = `${project.id}/${group.id}`;
    const unbound = await app.desk.openSession({ groupId: group.id });
    const missing = await api(
      'POST',
      `desk/sessions/${unbound.session.id}/rewrite`,
      { blockId: 'p:00000001', quote: '研究显著提高效率。', instruction: '语气缓和些' },
      400,
    );
    assert.equal(missing.code, 'DESK_MEETING_REQUIRED');
    await app.desk.closeSession(unbound.session.id);
    const meeting = await api('POST', 'meetings', {
      projectId: project.id,
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    const bound = await app.desk.openSession({ groupId: group.id, meetingId: meeting.id });
    const first = await api('POST', `desk/sessions/${bound.session.id}/rewrite`, {
      blockId: 'p:00000001',
      quote: '研究显著提高效率。',
      instruction: '语气缓和些',
    });
    assert.equal(app.core.turns.get(first.turnId).triggerMessageId, first.messageId);
    const message = app.core.messages.get(first.messageId);
    assert.equal(message.text, '语气缓和些');
    const mark = message.researchInput.marks[0];
    assert.equal(mark.reference.schema, 1);
    assert.equal(mark.reference.kind, 'version');
    assert.equal(mark.reference.id, bound.session.baseVersionId);
    assert.equal(mark.reference.location.paragraph, 1);
    assert.equal(mark.reference.location.blockId, 'p:00000001');
    assert.equal(mark.reference.location.quote.exact, mark.text);
    await started;
    const second = await api('POST', `desk/sessions/${bound.session.id}/rewrite`, {
      blockId: 'p:00000002',
      quote: { exact: '另一句显著提高收益。' },
      instruction: '把另一句也缓和',
    });
    assert.deepEqual(
      { messageId: second.messageId, turnId: second.turnId, queued: second.queued },
      { messageId: null, turnId: null, queued: true },
    );
    assert.equal(app.core.outbox.list(meeting.id).items[0].id, second.itemId);
    assert.equal(
      app.core.messages.since(meeting.id, 0).filter((entry) => entry.authorId === 'person_user')
        .length,
      1,
    );
    release();
    await app.conductor.idle();
    assert.equal(count, 2);
    const current = await app.desk.getSession(bound.session.id);
    assert.deepEqual(
      current.blocks.map((block) => block.text),
      ['研究可能提高效率。', '另一句可能提高收益。'],
    );
    assert.deepEqual(
      current.changes.map((entry) => entry.instruction),
      ['语气缓和些', '把另一句也缓和'],
    );
    assert.ok(
      current.changes.every(
        (entry) => entry.actorId === 'agent_main' && entry.meetingId === meeting.id && entry.turnId,
      ),
    );
    assert.equal(
      app.core.events.since(0).filter((event) => event.type === 'desk.suggested').length,
      1,
    );
    assert.ok(
      app.core.events.since(0).filter((event) => event.type === 'desk.changed').length >= 2,
    );
  } finally {
    release?.();
    await app.close();
    await fixture.cleanup();
  }
});
