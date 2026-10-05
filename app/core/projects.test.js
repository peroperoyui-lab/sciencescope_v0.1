import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { lockWindowsFile, withCore } from '../testing.js';

test('a project has a readable folder that follows renames and keeps its files', () =>
  withCore('projects', async (core) => {
    const project = await core.projects.create({ name: '气候政策', description: '面板数据' });
    assert.match(project.dirName, /^气候政策-prj_/);

    await core.workspace.edit({
      resource: 'log',
      key: project.id,
      op: 'append',
      args: { text: '## 10-05 立项' },
    });
    const renamed = await core.projects.update(project.id, { name: '碳政策' });
    assert.match(renamed.dirName, /^碳政策-prj_/);
    await access(path.join(core.paths.projects, renamed.dirName, 'workbench', 'log.md'));

    const log = await core.workspace.read({ resource: 'log', key: project.id });
    assert.equal(log.text, '## 10-05 立项');
  }));

test('archived projects leave the default list; pinned ones sort first', () =>
  withCore('projects', async (core) => {
    const first = await core.projects.create({ name: 'A' });
    const second = await core.projects.create({ name: 'B' });
    await core.projects.update(first.id, { pinned: true });
    assert.equal(core.projects.list()[0].id, first.id);

    await core.projects.update(second.id, { archived: true });
    assert.deepEqual(
      core.projects.list().map((project) => project.id),
      [first.id],
    );
    assert.equal(core.projects.list({ includeArchived: true }).length, 2);
  }));

test(
  'an occupied project keeps its old name and files until the user can rename it',
  { skip: process.platform !== 'win32' },
  () =>
    withCore('project-locked', async (core) => {
      const project = await core.projects.create({ name: '气候政策' });
      await core.workspace.edit({
        resource: 'plans',
        key: project.id,
        op: 'write',
        args: { text: '原计划' },
      });
      const file = path.join(core.paths.projects, project.dirName, 'workbench', 'plans.md');
      const unlock = await lockWindowsFile(file);
      try {
        await assert.rejects(core.projects.update(project.id, { name: '碳政策' }), {
          code: 'PATH_BUSY',
          status: 409,
        });
        assert.deepEqual(core.projects.get(project.id), project);
        await access(file);
      } finally {
        await unlock();
      }
      const renamed = await core.projects.update(project.id, { name: '碳政策' });
      await access(path.join(core.paths.projects, renamed.dirName, 'workbench', 'plans.md'));
      assert.equal(
        (await core.workspace.read({ resource: 'plans', key: project.id })).text,
        '原计划',
      );
    }),
);
