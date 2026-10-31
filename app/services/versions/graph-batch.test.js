import test from 'node:test';
import assert from 'node:assert/strict';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { withCore } from '../../testing.js';
import { AppError } from '../../core/errors.js';
import { createVersions } from './index.js';

async function fixture(core, count) {
  const project = await core.projects.create({ name: '批量版本图' });
  const versions = createVersions(core, {
    recycle: (folder) => rename(folder, folder + '-recycled'),
    diffs: {
      compute: async () => ({
        old: { blocks: [] },
        new: { blocks: [] },
        diff: { status: 'unchanged' },
      }),
    },
  });
  const imported = await versions.importFiles({
    projectId: project.id,
    files: Array.from({ length: count }, (_, index) => ({
      name: `稿件${index + 1}.md`,
      base64: Buffer.from('Synthetic manuscript ' + index).toString('base64'),
    })),
  });
  await versions.diffIdle();
  return { project, versions, imported };
}

test('batched graph retains metadata types, instruction order and external note revisions across deleted ancestors', (context) =>
  withCore('graph-batch-projection', async (core) => {
    const { project, versions, imported } = await fixture(core, 5);
    const [first, second, third, fourth, fifth] = imported.versions;
    try {
      await versions.editNotes(first.id, 'Original notes', null);
      const external = '😀研究'.repeat(100);
      await writeFile(versions.file(first.id) + '.notes.md', external);
      await versions.editNotes(fifth.id, 'Notes to remove', null);
      await unlink(versions.file(fifth.id) + '.notes.md');
      await versions.updateMetadata(fourth.id, {
        title: '修订标题',
        label: '标记',
        description: '  修改说明  ',
        key: true,
      });
      core.db
        .prepare(
          `INSERT INTO desk_sessions(id,group_id,base_version_id,created_at)
        VALUES('graph-session',?,?,'now')`,
        )
        .run(imported.group.id, first.id);
      const instruction = core.db
        .prepare(`INSERT INTO desk_changes(id,session_id,version_id,seq,block_id,op,instruction,created_at)
        VALUES(?,'graph-session',?,?,'block','edit',?,'now')`);
      instruction.run('first-instruction', first.id, 50, 'Repeated instruction');
      instruction.run('empty-instruction', first.id, 49, ' ');
      for (let index = 0; index < 12; index++)
        instruction.run('instruction-' + index, first.id, 48 - index, 'Instruction ' + index);
      instruction.run('duplicate-instruction', first.id, 20, 'Repeated instruction');
      instruction.run('other-version-instruction', fourth.id, 1, 'Repeated instruction');
      await versions.remove(second.id);
      await versions.remove(third.id);
      const graph = await versions.graph(imported.group.id);
      assert.deepEqual(graph.group, core.versionCatalog.group(imported.group.id));
      assert.deepEqual(
        graph.nodes.map((node) => node.id),
        [first.id, fourth.id, fifth.id],
      );
      const raw = versions.get(first.id);
      assert.deepEqual(graph.nodes[0], {
        id: raw.id,
        number: raw.number,
        parentId: null,
        branch: raw.branch,
        tier: raw.tier,
        label: raw.label,
        description: raw.description,
        key: raw.key,
        title: raw.title,
        displayTitle: raw.name,
        origin: raw.origin,
        createdAt: raw.createdAt,
        notesExcerpt: Array.from(external).slice(0, 200).join(''),
        instructions: [
          'Repeated instruction',
          ...Array.from({ length: 9 }, (_, index) => 'Instruction ' + index),
        ],
      });
      const revised = graph.nodes[1];
      assert.equal(revised.parentId, first.id);
      assert.equal(revised.title, '修订标题');
      assert.equal(revised.displayTitle, revised.title);
      assert.equal(revised.description, '修改说明');
      assert.equal(revised.key, true);
      assert.equal(revised.notesExcerpt, '');
      assert.deepEqual(revised.instructions, ['Repeated instruction']);
      assert.equal(graph.nodes[2].parentId, fourth.id);
      assert.equal(graph.nodes[2].notesExcerpt, '');
      const externalRevision = core.workspace.history({
        resource: 'versions',
        key: `${project.id}/${first.id}`,
        limit: 1,
      })[0];
      assert.equal(externalRevision.op, 'external');
      assert.equal(core.workspace.getRevision(externalRevision.id).after, external);
      const deletion = core.workspace.history({
        resource: 'versions',
        key: `${project.id}/${fifth.id}`,
        limit: 1,
      })[0];
      assert.equal(deletion.op, 'external');
      assert.equal(core.workspace.getRevision(deletion.id).after, null);
      const sql = [];
      const prepare = core.db.prepare;
      core.db.prepare = (statement) => {
        sql.push(statement);
        return prepare(statement);
      };
      try {
        assert.deepEqual(await versions.graph(imported.group.id), graph);
      } finally {
        core.db.prepare = prepare;
      }
      assert.equal(
        sql.filter((statement) => /FROM manuscript_versions WHERE group_id=/u.test(statement))
          .length,
        1,
      );
      assert.equal(sql.filter((statement) => statement.includes('desk_changes')).length, 1);
      assert.equal(sql.length, 15);
      context.diagnostic(
        '3 visible versions: 1 metadata batch + 1 instruction batch + 1 group lookup + 12 canonical note guard queries = 15 statements.',
      );
      for (const version of [first, fourth, fifth]) await versions.remove(version.id);
      assert.deepEqual((await versions.graph(imported.group.id)).nodes, []);
      await assert.rejects(versions.graph('missing-group'), { code: 'VERSION_GROUP_NOT_FOUND' });
    } finally {
      await versions.close();
    }
  }));

test('graph limits note reads to four and preserves queued note edits and current project paths during metadata changes', (context) =>
  withCore('graph-batch-concurrency', async (core) => {
    const { project, versions, imported } = await fixture(core, 8);
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const read = core.workspace.read;
    let active = 0;
    let maximum = 0;
    let started = 0;
    const mock = context.mock.method(core.workspace, 'read', async (target) => {
      if (target.resource !== 'versions') return read(target);
      active++;
      started++;
      maximum = Math.max(maximum, active);
      try {
        await gate;
        return await read(target);
      } finally {
        active--;
      }
    });
    let pending;
    try {
      pending = versions.graph(imported.group.id);
      await setImmediate();
      assert.equal(started, 4);
      await versions.editNotes(imported.versions[0].id, 'Concurrent note revision', null);
      await versions.updateMetadata(imported.versions.at(-1).id, { title: 'Later metadata' });
      await core.projects.update(project.id, { name: '重命名后的项目' });
      release();
      const graph = await pending;
      assert.equal(maximum, 4);
      assert.equal(started, imported.versions.length);
      assert.deepEqual(
        graph.nodes.map((node) => node.number),
        [1, 2, 3, 4, 5, 6, 7, 8],
      );
      assert.equal(graph.nodes[0].notesExcerpt, 'Concurrent note revision');
      assert.equal(graph.nodes.at(-1).title, '');
      mock.mock.restore();
      const refreshed = await versions.graph(imported.group.id);
      assert.equal(refreshed.nodes.at(-1).title, 'Later metadata');
      assert.equal(refreshed.nodes[0].notesExcerpt, 'Concurrent note revision');
    } finally {
      release();
      await Promise.allSettled([pending]);
      mock.mock.restore();
      await versions.close();
    }
  }));

test('a failed note read stops new work and waits for its in-flight siblings before rejecting', (context) =>
  withCore('graph-batch-failure', async (core) => {
    const { versions, imported } = await fixture(core, 8);
    const read = core.workspace.read;
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    let entered = 0;
    let active = 0;
    const mock = context.mock.method(core.workspace, 'read', async (target) => {
      if (target.resource !== 'versions') return read(target);
      const index = entered++;
      if (index === 0) throw new AppError('VERSION_NOT_FOUND', '找不到这个文献版本。', 404);
      active++;
      try {
        await gate;
        return await read(target);
      } finally {
        active--;
      }
    });
    let pending;
    try {
      pending = versions.graph(imported.group.id);
      let finished = false;
      const completion = pending.then(
        () => {
          finished = true;
        },
        () => {
          finished = true;
        },
      );
      await setImmediate();
      assert.equal(entered, 4);
      assert.equal(active, 3);
      assert.equal(finished, false);
      release();
      await assert.rejects(pending, { code: 'VERSION_NOT_FOUND', status: 404 });
      await completion;
      assert.equal(entered, 4);
      assert.equal(active, 0);
    } finally {
      release();
      await Promise.allSettled([pending]);
      mock.mock.restore();
      await versions.close();
    }
  }));
