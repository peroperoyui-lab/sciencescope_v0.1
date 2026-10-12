import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tempDir } from '../../testing.js';
import { createApp } from '../../app.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { fakeUv } from '../python/testing.js';
import { createResearchFixtures } from '../research/testing.js';
import { compileResearchInput } from '../research-input/compile.js';
import { compareText } from './comparison.js';
import { createVersions } from './index.js';
import { updateWorkbench } from '../secretary/publish.js';
import { withCore } from '../../testing.js';

test('secretary automatically organizes imported DOCX notes, changes baseline, keeps user history and quotes via shared input', async () => {
  const temporary = await tempDir('version-notes');
  const inputs = [];
  const runtime = createScriptedRuntime({
    script: async function* ({ input, call }) {
      const packet = JSON.parse(input);
      inputs.push(packet);
      const read = await call('workspace_read', {
        target: 'versions',
        key: `${packet.current.projectId}/${packet.current.id}`,
        limit: 1,
      });
      assert.equal(read.blocks.length, 1);
      yield JSON.stringify({
        markdown: `# 版本说明\n## 实际文件变化\n${packet.baseline ? '与指定基线比较。' : '首版，无前序版本。'}\n## 秘书的解释\n研究依据待核查。\n## 待用户决定的建议\n建议补充，尚未执行。`,
        references: [
          {
            schema: 1,
            kind: 'project-file',
            path: packet.current.originalPath,
            projectId: packet.current.projectId,
            location: { page: 1 },
            label: '当前稿件',
          },
        ],
      });
    },
  });
  const app = await createApp({
    dataRoot: temporary.dir,
    token: 'notes',
    runtime,
    pythonOptions: { runner: fakeUv().runner },
  });
  try {
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          models: { default: { provider: 'test', model: 'cheap' } },
          versionNotes: { template: '三部分及参考链接。' },
          summary: { onEnterProject: false, onLeaveProject: false },
          memory: { enabled: false },
        },
      },
    });
    const project = await app.core.projects.create({ name: '文献说明' });
    const main = app.core.meetings.create({ projectId: project.id, title: '主会议' });
    await app.core.workspace.edit({
      resource: 'plans',
      key: project.id,
      op: 'write',
      args: { text: '核查因果推断。' },
    });
    const fixtures = await createResearchFixtures(temporary.dir);
    const imported = await app.versions.importFiles({
      projectId: project.id,
      files: [
        { name: '原稿.docx', base64: Buffer.from(fixtures.docx.bytes).toString('base64') },
        { name: '修订.docx', base64: Buffer.from(fixtures.docxUnknown.bytes).toString('base64') },
      ],
    });
    await app.versionNotes.idle();
    assert.equal(inputs.length, 2);
    assert.equal(inputs[1].baseline.id, imported.versions[0].id);
    assert.equal(inputs[1].context.plans, '核查因果推断。');
    assert.equal(inputs[1].template, '三部分及参考链接。');
    const version = app.versions.get(imported.versions[1].id);
    assert.equal(version.notesStatus, 'completed');
    assert.equal(version.references[0].schema, 1);
    assert.equal(version.references[0].kind, 'version');
    assert.equal(version.references[0].id, version.id);
    assert.equal(app.core.messages.since(main.id, 0).length, 0);
    const key = `${project.id}/${version.id}`;
    const initial = await app.core.workspace.read({ resource: 'versions', key });
    assert.match(initial.text, /实际文件变化[\s\S]*秘书的解释[\s\S]*待用户决定的建议/u);
    const firstHistory = app.core.workspace.snapshots({ resource: 'versions', key });
    assert.equal(firstHistory[0].actorId, 'agent_secretary');
    await app.core.workspace.edit(
      { resource: 'versions', key, op: 'append', args: { text: '用户补充。' } },
      { actorId: 'person_user' },
    );
    await app.core.workspace.captureSnapshot(
      { resource: 'versions', key },
      { actorId: 'person_user' },
    );
    assert.match((await app.versions.read(version.id)).notes.text, /用户补充/u);
    await app.core.workspace.restoreSnapshot(firstHistory[0].id, { actorId: 'person_user' });
    assert.equal((await app.versions.read(version.id)).notes.text, initial.text);
    app.versionNotes.baseline(version.id, null);
    await app.versionNotes.refresh(version.id);
    assert.equal(inputs.at(-1).baseline, null);
    app.researchInput.change(main.id, {
      op: 'add',
      material: { type: 'version-notes', id: version.id, text: '用户选定时的说明全文。' },
    });
    assert.match(
      compileResearchInput(app.researchInput.draft(main.id)),
      /workspace_read target=versions/,
    );
    assert.match(compileResearchInput(app.researchInput.draft(main.id)), /用户选定时的说明全文/u);
    assert.deepEqual(
      await readFile(app.versions.file(version.id)),
      Buffer.from(fixtures.docxUnknown.bytes),
    );
    app.versionNotes.configure(project.id, false);
    const disabled = await app.versions.importFiles({
      projectId: project.id,
      groupId: imported.group.id,
      files: [{ name: '第三稿.md', base64: Buffer.from('正文').toString('base64') }],
    });
    await app.versionNotes.idle();
    assert.equal(app.versions.get(disabled.versions[0].id).notesStatus, 'pending');
  } finally {
    await app.close();
    await temporary.cleanup();
  }
});

test('secretary preserves concurrent user notes and records a failed organization for retry', async () => {
  const temporary = await tempDir('version-notes-race');
  let race = true;
  let fail = true;
  const runtime = createScriptedRuntime({
    script: async function* ({ input, call }) {
      const packet = JSON.parse(input);
      if (race)
        await app.core.workspace.edit(
          {
            resource: 'versions',
            key: `${packet.current.projectId}/${packet.current.id}`,
            op: 'write',
            args: { text: fail ? '用户刚刚补充。' : '用户再次补充。' },
          },
          { actorId: 'person_user' },
        );
      if (fail) {
        await call('workspace_edit', {
          resource: 'plans',
          key: packet.current.projectId,
          op: 'append',
          args: { text: '工具修改也必须留历史。' },
        });
        yield { stop: 'failed', error: 'provider disconnected after tool edit' };
        return;
      }
      yield JSON.stringify({
        markdown: '## 实际文件变化\n首版\n## 秘书解释\n保持\n## 待用户决定\n建议',
        references: [],
      });
    },
  });
  const app = await createApp({
    dataRoot: temporary.dir,
    token: 'race',
    runtime,
    pythonOptions: { runner: fakeUv().runner },
  });
  try {
    const project = await app.core.projects.create({ name: '并发编辑' });
    app.versionNotes.configure(project.id, false);
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { models: { default: { provider: 'test', model: 'fake' } } } },
    });
    const imported = await app.versions.importFiles({
      projectId: project.id,
      files: [{ name: '原稿.md', base64: Buffer.from('原文').toString('base64') }],
    });
    const id = imported.versions[0].id;
    await assert.rejects(app.versionNotes.refresh(id), { code: 'MINUTES_FAILED' });
    assert.equal(app.versions.get(id).notesStatus, 'failed');
    assert.equal((await app.versions.read(id)).notes.text, '用户刚刚补充。');
    assert.ok(
      app.core.workspace
        .snapshots({ resource: 'plans', key: project.id })
        .some((entry) => entry.actorId === 'agent_secretary'),
    );
    fail = false;
    await assert.rejects(app.versionNotes.refresh(id), { code: 'REVISION_CONFLICT' });
    assert.equal((await app.versions.read(id)).notes.text, '用户再次补充。');
    race = false;
    await app.versionNotes.refresh(id);
    assert.equal(app.versions.get(id).notesStatus, 'completed');
    const changes = compareText('研究使用问卷。', '研究使用访谈和问卷。');
    assert.equal(
      changes
        .filter((entry) => entry.type !== 'added')
        .map((entry) => entry.text)
        .join(''),
      '研究使用问卷。',
    );
    assert.equal(
      changes
        .filter((entry) => entry.type !== 'removed')
        .map((entry) => entry.text)
        .join(''),
      '研究使用访谈和问卷。',
    );
  } finally {
    await app.close();
    await temporary.cleanup();
  }
});

test('minutes workbench setting appends version context as secretary, retains original notes and undo', async () => {
  await withCore('version-workbench', async (core) => {
    const project = await core.projects.create({ name: '总结更新说明' });
    const meeting = core.meetings.create({ projectId: project.id });
    const versions = createVersions(core);
    const imported = await versions.importFiles({
      projectId: project.id,
      files: [{ name: '稿件.md', base64: Buffer.from('原文').toString('base64') }],
    });
    const id = imported.versions[0].id,
      key = `${project.id}/${id}`;
    await core.workspace.edit(
      { resource: 'versions', key, op: 'write', args: { text: '用户说明保留。' } },
      { actorId: 'person_user' },
    );
    const minutes = await core.workspace.edit({
      resource: 'minutes',
      key: meeting.id,
      op: 'write',
      args: { text: '待核查证据。' },
    });
    const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_secretary' });
    await updateWorkbench({
      core,
      meetingId: meeting.id,
      minutesRevisionId: minutes.revisionId,
      minutes: '待核查证据。',
      modes: { versions: 'apply' },
      store: { patchStatus() {} },
      runner: {
        run: async (_meeting, _instructions, input) => {
          assert.match(input, /用户说明保留/u);
          return {
            turnId: turn.id,
            text: JSON.stringify({
              operations: [
                {
                  target: 'versions',
                  op: 'append',
                  versionId: id,
                  note: '研究进展：证据仍待核查，未修改稿件。',
                },
              ],
            }),
          };
        },
      },
    });
    assert.match(
      (await core.workspace.read({ resource: 'versions', key })).text,
      /^用户说明保留。[\s\S]*研究进展/u,
    );
    const history = core.workspace.history({ resource: 'versions', key });
    assert.equal(history[0].actorId, 'agent_secretary');
    assert.ok(
      core.workspace
        .snapshots({ resource: 'versions', key })
        .some((entry) => entry.turnId === turn.id),
    );
    await core.workspace.undo(history[0].id);
    assert.equal((await core.workspace.read({ resource: 'versions', key })).text, '用户说明保留。');
  });
});
