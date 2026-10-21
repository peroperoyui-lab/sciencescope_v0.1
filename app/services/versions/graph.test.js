import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { withCore } from '../../testing.js';
import { createAppServer } from '../../server/server.js';
import { createVersions } from './index.js';
import { createVersionOrganizer } from './organizer.js';

test('version graph routes retain lineage, rename lanes and tiers, and bypass deleted ancestors', async () => {
  await withCore('version-graph', async (core, dir) => {
    const project = await core.projects.create({ name: '版本图' });
    const versions = createVersions(core, { recycle: (file) => rename(file, `${file}-recycled`) });
    const versionNotes = createVersionOrganizer({
      core,
      versions,
      runtime: null,
      tools: null,
      defaultModel: async () => null,
    });
    const server = createAppServer({ core, versions, versionNotes, token: 'test' });
    const address = await server.listen();
    async function api(route, body, method = 'POST', status = 200) {
      const response = await fetch(`${address}${route}`, {
        method: body === undefined ? 'GET' : method,
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      return result;
    }
    try {
      const imported = await api('/api/versions/import', {
        projectId: project.id,
        files: ['第一版', '第二版'].map((text) => ({
          name: `${text}.tex`,
          base64: Buffer.from(text).toString('base64'),
        })),
      });
      const [first, second] = imported.versions;
      const groupId = imported.group.id;
      assert.equal(imported.group.format, 'tex');
      assert.equal(imported.group.sourcePath, null);
      assert.equal(first.contentHash, createHash('sha256').update('第一版').digest('hex'));
      assert.equal(second.parentId, first.id);
      const fork = await versions.createVersion({
        groupId,
        parentId: first.id,
        bytes: Buffer.from('导师版'),
        origin: 'desk',
        title: '导师初稿',
      });
      const source = path.join(dir, '中文稿.tex');
      await writeFile(source, '导师第二版');
      const child = await versions.createVersion({
        groupId,
        parentId: fork.id,
        path: source,
        origin: 'desk',
      });
      assert.equal(fork.branch, '分支 1');
      assert.equal(child.branch, '分支 1');
      assert.equal(await readFile(versions.file(child.id), 'utf8'), '导师第二版');
      assert.equal((await versions.compare(child.id)).previous.version.id, fork.id);
      await api(`/api/versions/${child.id}/baseline`, { baselineId: first.id }, 'PATCH');
      assert.equal((await api(`/api/versions/${child.id}/compare`)).previous.version.id, first.id);
      assert.equal((await versions.compare(child.id)).previous.version.id, fork.id);
      assert.equal(versions.get(child.id).parentId, fork.id);
      await api(`/api/versions/${child.id}/baseline`, { baselineId: null }, 'PATCH');
      assert.equal((await api(`/api/versions/${child.id}/compare`)).previous, null);
      assert.equal(versions.get(child.id).parentId, fork.id);

      await api(`/api/versions/${fork.id}`, { branch: '给导师' }, 'PATCH');
      assert.equal(versions.get(fork.id).branch, '给导师');
      assert.equal(versions.get(child.id).branch, '给导师');
      await api(`/api/versions/${second.id}`, { branch: '给导师' }, 'PATCH', 400);
      const secondFork = await versions.createVersion({
        groupId,
        parentId: first.id,
        bytes: Buffer.from('另一支'),
        origin: 'desk',
      });
      assert.equal(secondFork.branch, '分支 1');
      const thirdFork = await versions.createVersion({
        groupId,
        parentId: first.id,
        bytes: Buffer.from('第三支'),
        origin: 'desk',
      });
      assert.equal(thirdFork.branch, '分支 2');
      await api(
        `/api/versions/${second.id}`,
        { tier: '投稿', label: '10-20 投 JMS', title: '投稿版' },
        'PATCH',
      );
      await api(`/api/versions/${second.id}`, { tier: '未设置的层级' }, 'PATCH', 400);
      const tierResult = await api('/api/version-tiers/rename', { from: '投稿', to: '期刊投稿' });
      assert.equal(tierResult.updated, 1);
      assert.equal(versions.get(second.id).tier, '期刊投稿');
      assert.ok(
        (await core.workspace.read({ resource: 'settings', key: 'app' })).value.desk.tiers.includes(
          '期刊投稿',
        ),
      );
      await versions.editNotes(first.id, '📝研究'.repeat(100), null);
      // Seed future D3 records only to exercise the graph's documented projection.
      core.db
        .prepare(
          `INSERT INTO desk_sessions (id,group_id,base_version_id,created_at)
        VALUES ('session',?,?, 'now')`,
        )
        .run(groupId, first.id);
      const instruction = core.db.prepare(`INSERT INTO desk_changes
        (id,session_id,version_id,seq,block_id,op,instruction,created_at)
        VALUES (?,'session',?,?,'block','edit',?,'now')`);
      instruction.run('duplicate', first.id, 12, '修改 0');
      instruction.run('empty', first.id, 13, ' ');
      for (let index = 0; index < 12; index += 1)
        instruction.run(`change-${index}`, first.id, index, `修改 ${index}`);
      let graph = await api(`/api/version-groups/${groupId}/graph`);
      assert.equal(graph.nodes.length, 6);
      assert.equal(graph.nodes.find((node) => node.id === second.id).displayTitle, '投稿版');
      const root = graph.nodes[0];
      assert.equal(root.displayTitle, '第一版.tex');
      assert.equal(Array.from(root.notesExcerpt).length, 200);
      assert.deepEqual(
        root.instructions,
        Array.from({ length: 10 }, (_, index) => `修改 ${index}`),
      );
      assert.equal(graph.nodes.find((node) => node.id === child.id).parentId, fork.id);
      await versions.remove(fork.id);
      graph = await api(`/api/version-groups/${groupId}/graph`);
      assert.equal(graph.nodes.length, 5);
      assert.equal(graph.nodes.find((node) => node.id === child.id).parentId, first.id);
      assert.ok(graph.nodes.every((node) => node.id !== fork.id));
      await core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { desk: { tiers: ['草稿'] } } },
      });
      assert.equal(versions.get(second.id).tier, '期刊投稿');
      for (const action of ['metadata', 'tier-renamed'])
        assert.ok(
          core.db
            .prepare(
              "SELECT 1 FROM events WHERE type='versions.changed' AND json_extract(payload_json,'$.action')=?",
            )
            .get(action),
        );
    } finally {
      await server.close();
    }
  });
});

test('tier settings failure compensates only the renamed versions and the next rename succeeds', async (t) => {
  await withCore('version-tier-compensation', async (core) => {
    const project = await core.projects.create({ name: '层级恢复' });
    const versions = createVersions(core);
    const imported = await versions.importFiles({
      projectId: project.id,
      files: ['首稿', '次稿'].map((name) => ({
        name: `${name}.md`,
        base64: Buffer.from(name).toString('base64'),
      })),
    });
    const [first, second] = imported.versions;
    await versions.updateMetadata(first.id, { tier: '内部审阅' });
    // An old, deleted setting may still appear verbatim on existing versions.
    core.db.prepare('UPDATE manuscript_versions SET tier=? WHERE id=?').run('组会', second.id);
    const before = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
    const edit = t.mock.method(core.workspace, 'edit', async () => {
      assert.equal(versions.get(first.id).tier, '组会');
      throw new Error('Settings file is busy');
    });
    await assert.rejects(versions.renameTier('内部审阅', '组会'), {
      code: 'TIER_RENAME_FAILED',
      message: /restored.*Settings file is busy/,
    });
    edit.mock.restore();
    assert.equal(versions.get(first.id).tier, '内部审阅');
    assert.equal(versions.get(second.id).tier, '组会');
    assert.deepEqual(
      (await core.workspace.read({ resource: 'settings', key: 'app' })).value,
      before,
    );
    assert.equal((await versions.renameTier('内部审阅', '组会')).updated, 1);
    assert.equal(versions.get(first.id).tier, '组会');
  });
});

test('a failed multi-file import registers no partial versions or consumed numbers', async () => {
  await withCore('version-batch-rollback', async (core) => {
    const project = await core.projects.create({ name: '批量导入' });
    const versions = createVersions(core);
    const first = await versions.importFiles({
      projectId: project.id,
      files: [{ name: '首稿.md', base64: 'YQ==' }],
    });
    await assert.rejects(
      versions.importFiles({
        projectId: project.id,
        groupId: first.group.id,
        files: [
          { name: '可读.md', base64: 'Yg==' },
          { name: '', base64: 'Yw==' },
        ],
      }),
    );
    assert.equal(versions.list(project.id)[0].versions.length, 1);
    assert.equal(core.versionCatalog.group(first.group.id).nextNumber, 2);
    const copied = (await versions.saveAsNew(first.versions[0].id)).versions[0];
    assert.equal(copied.number, 2);
    assert.equal(copied.origin, 'save-as-new');
  });
});
