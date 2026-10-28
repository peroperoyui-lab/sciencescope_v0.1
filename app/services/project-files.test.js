import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { withCore } from '../testing.js';
import { createProjectFiles } from './project-files.js';

test('recycling project entries uses the system adapter and changing location preserves meeting folders', async () => {
  await withCore('project-recycle', async (core, dir) => {
    const external = path.join(dir, '原工作目录');
    const next = path.join(dir, '新工作目录');
    const bin = path.join(dir, 'fake-recycle-bin');
    await Promise.all([external, next, bin].map((folder) => mkdir(folder)));
    const project = await core.projects.create({ name: '中文项目', folder: external });
    const meeting = core.meetings.create({ projectId: project.id });
    const files = createProjectFiles(core, {
      recycle: async (target) => {
        await rename(target, path.join(bin, path.basename(target)));
      },
    });
    await files.add(project.id, '中文文献.txt', Buffer.from('原件').toString('base64'));
    await files.recycle(project.id, '中文文献.txt');
    assert.deepEqual((await files.list(project.id)).entries, []);
    assert.equal(await readFile(path.join(bin, '中文文献.txt'), 'utf8'), '原件');
    await core.projects.update(project.id, { folder: next });
    assert.equal(files.rootOf(project.id), next);
    assert.equal(core.meetings.get(meeting.id).workFolder, external);
    assert.equal(core.meetings.create({ projectId: project.id }).workFolder, next);
    await core.projects.update(project.id, { folder: null });
    assert.equal(files.rootOf(project.id), path.join(core.paths.projects, project.dirName));
    const internalMeeting = core.meetings.create({ projectId: project.id });
    const renamed = await core.projects.update(project.id, { name: '新中文名称' });
    assert.equal(
      core.meetings.get(internalMeeting.id).workFolder,
      path.join(core.paths.projects, renamed.dirName),
    );
    assert.equal(core.meetings.get(meeting.id).workFolder, external);
  });
});

test("the project's own folder hides ScienceScope's workspace folders; a bound folder shows all", async () => {
  await withCore('project-own-folders', async (core, dir) => {
    const project = await core.projects.create({ name: '自带文件夹' });
    const files = createProjectFiles(core);
    const own = files.rootOf(project.id);
    await Promise.all(
      ['workbench', 'versions', 'data'].map((name) =>
        mkdir(path.join(own, name), { recursive: true }),
      ),
    );
    assert.deepEqual(
      (await files.list(project.id)).entries.map((entry) => entry.name),
      ['data'],
    );
    const bound = path.join(dir, '外部');
    await mkdir(path.join(bound, 'workbench'), { recursive: true });
    await core.projects.update(project.id, { folder: bound });
    assert.deepEqual(
      (await files.list(project.id)).entries.map((entry) => entry.name),
      ['workbench'],
    );
  });
});
