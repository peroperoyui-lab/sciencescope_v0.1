import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, readdir } from 'node:fs/promises';
import path from 'node:path';
import { withCore, tempDir } from '../../testing.js';
import { createVersions } from './index.js';
import { createResearchFixtures } from '../research/testing.js';
import { createApp } from '../../app.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { fakeUv } from '../python/testing.js';
import { openDatabase } from '../../core/db/database.js';
import { migrations } from '../../core/db/migrations/index.js';

test('ordered DOCX imports keep owned originals, paged text and notes history; deletion never reuses a number', async () => {
  await withCore('version-files', async (core, dir) => {
    const external = path.join(dir, '外部研究目录');
    await mkdir(external);
    const project = await core.projects.create({ name: '中文稿件', folder: external });
    const fixtures = await createResearchFixtures(dir);
    const opened = [];
    const service = createVersions(core, {
      open: async (file) => {
        opened.push(file);
      },
      recycle: async (folder) => {
        await rename(folder, `${folder}-recycled`);
      },
    });
    const result = await service.importFiles(
      {
        projectId: project.id,
        groupName: '论文',
        files: [
          { name: '第一版.docx', base64: Buffer.from(fixtures.docx.bytes).toString('base64') },
          {
            name: '第二版.docx',
            base64: Buffer.from(fixtures.docxUnknown.bytes).toString('base64'),
          },
        ],
      },
      { actorId: 'person_user' },
    );
    assert.deepEqual(
      result.versions.map((v) => v.number),
      [1, 2],
    );
    assert.equal(result.versions[1].baselineId, result.versions[0].id);
    assert.deepEqual(await readdir(external), []);
    assert.deepEqual(
      await readFile(service.file(result.versions[0].id)),
      Buffer.from(fixtures.docx.bytes),
    );
    const page = await service.read(result.versions[0].id, { limit: 1 });
    assert.equal(page.pages, 2);
    assert.equal(page.blocks.length, 1);
    assert.ok(page.remaining > 0);
    const key = `${project.id}/${result.versions[0].id}`;
    await core.workspace.edit(
      { resource: 'versions', key, op: 'write', args: { text: '## 实际变化\n首版。' } },
      { actorId: 'agent_secretary' },
    );
    const snapshot = await core.workspace.captureSnapshot(
      { resource: 'versions', key },
      { actorId: 'agent_secretary' },
    );
    await core.workspace.edit(
      { resource: 'versions', key, op: 'append', args: { text: '用户补充。' } },
      { actorId: 'person_user' },
    );
    assert.ok(snapshot);
    assert.match(
      await readFile(`${service.file(result.versions[0].id)}.notes.md`, 'utf8'),
      /用户补充/u,
    );
    await service.openOriginal(result.versions[0].id);
    await service.openOriginal(result.versions[0].id, true);
    assert.deepEqual(opened, [
      service.file(result.versions[0].id),
      path.dirname(service.file(result.versions[0].id)),
    ]);
    await service.remove(result.versions[1].id);
    const more = await service.importFiles({
      projectId: project.id,
      groupId: result.group.id,
      files: [
        { name: '第三版.md', base64: Buffer.from('全文保留。'.repeat(20000)).toString('base64') },
      ],
    });
    assert.equal(more.versions[0].number, 3);
    const text = await service.read(more.versions[0].id, { limit: 10000 });
    assert.equal(text.blocks.map((b) => b.text).join(''), '全文保留。'.repeat(20000));
    service.renameGroup(result.group.id, '新组名');
    assert.equal(service.list(project.id)[0].name, '新组名');
    await core.projects.update(project.id, { name: '改名后的项目' });
    assert.deepEqual(
      await readFile(service.file(result.versions[0].id)),
      Buffer.from(fixtures.docx.bytes),
    );
  });
});

test('shared workspace tools let a meeting read version paragraphs and edit only the paired notes', async () => {
  const temporary = await tempDir('version-tools');
  const runtime = createScriptedRuntime({
    script: async function* ({ call, inputs }) {
      const scope = inputs[0];
      const projectId = scope.match(/prj_[a-z0-9]+/)[0];
      const listing = await call('workspace_read', { target: 'versions', scope: projectId });
      const version = listing.groups[0].versions[0];
      const extracted = await call('workspace_read', {
        target: 'versions',
        key: `${projectId}/${version.id}`,
        limit: 1,
      });
      assert.match(extracted.blocks[0].text, /研究稿/u);
      await call('workspace_edit', {
        resource: 'versions',
        key: `${projectId}/${version.id}`,
        op: 'write',
        args: { text: '实际变化：首版。' },
      });
      yield '已读原件并保存说明。';
    },
  });
  const app = await createApp({
    dataRoot: temporary.dir,
    token: 'test',
    runtime,
    runtimeName: 'scripted',
    pythonOptions: { runner: fakeUv().runner },
  });
  try {
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          models: { default: { provider: 'test', model: 'test' } },
          summary: {
            everyMessages: { enabled: false },
            everyTokens: { enabled: false },
            onEnterProject: false,
            onLeaveProject: false,
          },
          memory: { enabled: false },
        },
      },
    });
    const project = await app.core.projects.create({ name: '工具测试' });
    // This path isolates Main's shared tools; automatic secretary organization
    // has its own functional test and must not write concurrently here.
    app.versionNotes.configure(project.id, false);
    const imported = await app.versions.importFiles({
      projectId: project.id,
      files: [{ name: '稿件.md', base64: Buffer.from('研究稿。').toString('base64') }],
    });
    const meeting = app.core.meetings.create({
      projectId: project.id,
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    app.core.messages.post({
      meetingId: meeting.id,
      text: `读取项目 ${project.id} 的稿件。`,
      authorId: 'person_user',
    });
    await app.conductor.idle();
    const original = await readFile(app.versions.file(imported.versions[0].id), 'utf8');
    assert.equal(original, '研究稿。');
    const notes = await app.core.workspace.read({
      resource: 'versions',
      key: `${project.id}/${imported.versions[0].id}`,
    });
    assert.equal(notes.text, '实际变化：首版。');
    assert.equal(app.core.workspace.history({ resource: 'versions' })[0].actorId, 'agent_main');
  } finally {
    await app.close();
    await temporary.cleanup();
  }
});

test('v14 upgrades with version tables while keeping existing projects and a backup', async () => {
  const temporary = await tempDir('version-upgrade');
  const dbFile = path.join(temporary.dir, 'sciencescope.sqlite');
  const backupDir = path.join(temporary.dir, 'backups');
  let db = await openDatabase(dbFile, { migrations: migrations.slice(0, 14), backupDir });
  db.prepare(
    'INSERT INTO projects (id,name,dir_name,created_at,updated_at) VALUES (?,?,?,?,?)',
  ).run('p', '已有项目', '已有项目-p', 'time', 'time');
  db.close();
  db = await openDatabase(dbFile, { migrations, backupDir });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, migrations.at(-1).version);
    assert.equal(db.prepare('SELECT name FROM projects WHERE id = ?').get('p').name, '已有项目');
    assert.equal(db.prepare('SELECT count(*) AS n FROM version_groups').get().n, 0);
    assert.ok((await readdir(backupDir)).length);
  } finally {
    db.close();
    await temporary.cleanup();
  }
});
