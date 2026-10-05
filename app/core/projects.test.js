import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { withCore } from '../testing.js';

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
