import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withCore } from '../../testing.js';

test('edits write readable files, record revisions and publish events', () =>
  withCore('workspace', async (core) => {
    const project = await core.projects.create({ name: '项目' });
    const seen = [];
    core.events.subscribe((event) => seen.push(event.type));

    const actor = { actorId: 'agent_secretary' };
    await core.workspace.edit(
      { resource: 'plans', key: project.id, op: 'append', args: { text: '- [ ] 整理文献' } },
      actor,
    );
    await core.workspace.edit(
      { resource: 'plans', key: project.id, op: 'append', args: { text: '- [ ] 跑回归' } },
      actor,
    );
    const file = path.join(core.paths.projects, project.dirName, 'workbench', 'plans.md');
    assert.equal(await readFile(file, 'utf8'), '- [ ] 整理文献\n- [ ] 跑回归');

    const history = core.workspace.history({ resource: 'plans', key: project.id });
    assert.equal(history.length, 2);
    assert.equal(history[0].actorId, 'agent_secretary');
    assert.deepEqual(seen, ['resource.changed', 'resource.changed']);
  }));

test('undo restores the previous text and refuses when a later change exists', () =>
  withCore('workspace', async (core) => {
    const project = await core.projects.create({ name: '项目' });
    const edit = (text) =>
      core.workspace.edit({ resource: 'log', key: project.id, op: 'append', args: { text } });
    const first = await edit('## 第一条');
    const second = await edit('## 第二条');

    await assert.rejects(core.workspace.undo(first.revisionId), { code: 'REVISION_CONFLICT' });
    await core.workspace.undo(second.revisionId);
    assert.equal(
      (await core.workspace.read({ resource: 'log', key: project.id })).text,
      '## 第一条',
    );
    await assert.rejects(core.workspace.undo(second.revisionId), { code: 'ALREADY_UNDONE' });

    await core.workspace.undo(first.revisionId);
    const log = await core.workspace.read({ resource: 'log', key: project.id });
    assert.equal(log.exists, false, 'undoing the first write removes the file it created');
  }));

test('a file edited outside the app becomes an external revision', () =>
  withCore('workspace', async (core) => {
    const project = await core.projects.create({ name: '项目' });
    const created = await core.workspace.edit({
      resource: 'notes',
      key: `${project.id}/想法`,
      op: 'write',
      args: { text: '初稿' },
    });
    const file = path.join(core.paths.projects, project.dirName, 'notes', '想法.md');
    await writeFile(file, '用户在编辑器里改过', 'utf8');

    const note = await core.workspace.read({ resource: 'notes', key: `${project.id}/想法` });
    assert.equal(note.text, '用户在编辑器里改过');
    const [external] = core.workspace.history({ resource: 'notes', key: `${project.id}/想法` });
    assert.equal(external.op, 'external');
    await assert.rejects(core.workspace.undo(created.revisionId), { code: 'REVISION_CONFLICT' });
    assert.deepEqual(await core.workspace.list({ resource: 'notes', scope: project.id }), [
      `${project.id}/想法`,
    ]);
  }));

test('map operations keep the tree consistent', () =>
  withCore('workspace', async (core) => {
    const project = await core.projects.create({ name: '项目' });
    const edit = (op, args) => core.workspace.edit({ resource: 'map', key: project.id, op, args });

    let result = await edit('addNode', { node: { id: 'root', text: '研究问题' } });
    result = await edit('addNode', { node: { id: 'm1', parent: 'root', text: '方法' } });
    result = await edit('addNode', { node: { id: 'm2', parent: 'm1', text: '双重差分' } });
    result = await edit('addNode', { node: { id: 'd1', parent: 'root', text: '数据' } });
    result = await edit('addEdge', { edge: { from: 'm2', to: 'd1', label: '需要' } });
    assert.equal(result.value.edges.length, 1);

    result = await edit('removeNode', { id: 'm1' });
    assert.deepEqual(
      result.value.nodes.map((node) => node.id),
      ['root', 'd1'],
    );
    assert.equal(result.value.edges.length, 0, 'edges to removed nodes go too');
    await assert.rejects(edit('addNode', { node: { parent: 'missing' } }), {
      code: 'NODE_NOT_FOUND',
    });
  }));

test('settings merge stored values over defaults; global minutes live at the root', () =>
  withCore('workspace', async (core) => {
    const patched = await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { appearance: { theme: 'dark' } } },
    });
    assert.equal(patched.value.appearance.theme, 'dark');
    assert.equal(patched.value.appearance.language, 'zh');

    const meeting = core.meetings.create({ title: '全局', members: [] });
    await core.workspace.edit({
      resource: 'minutes',
      key: meeting.id,
      op: 'write',
      args: { text: '# 纪要' },
    });
    await access(path.join(core.paths.globalMinutes, `${meeting.id}.md`));
  }));
