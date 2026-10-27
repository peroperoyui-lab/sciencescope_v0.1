import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createAppServer } from '../../server/server.js';
import { createVersions } from './index.js';

test('version mark routes preserve omitted fields and expose the same metadata in every read', async () => {
  await withCore('version-marks', async (core) => {
    const project = await core.projects.create({ name: '合成版本标记' });
    const versions = createVersions(core);
    const server = createAppServer({ core, versions, token: 'test' });
    const address = await server.listen();
    async function api(route, body, expectedStatus = 200) {
      const response = await fetch(`${address}${route}`, {
        method: body === undefined ? 'GET' : 'PATCH',
        headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      assert.equal(response.status, expectedStatus, JSON.stringify(result));
      return result;
    }
    try {
      const imported = await versions.importFiles({
        projectId: project.id,
        files: ['首稿', '修订'].map((text) => ({
          name: `${text}.md`,
          base64: Buffer.from(text).toString('base64'),
        })),
      });
      const [first, second] = imported.versions;
      assert.equal(first.description, '');
      assert.equal(first.key, false);
      const route = `/api/versions/${second.id}`;
      let updated = await api(route, {
        title: '修订标题',
        label: '简短标签',
        tier: '投稿',
        description: '  导师看过的版本，第三章已修改。 \n',
        key: true,
      });
      assert.equal(updated.description, '导师看过的版本，第三章已修改。');
      assert.equal(updated.key, true);
      assert.equal(updated.label, '简短标签');
      const list = await api(`/api/versions?projectId=${project.id}`);
      const read = await api(route);
      const graph = await api(`/api/version-groups/${imported.group.id}/graph`);
      for (const value of [list[0].versions[0], read.version, graph.nodes[1]]) {
        assert.equal(value.description, updated.description);
        assert.equal(value.key, true);
        assert.equal(value.label, '简短标签');
      }
      updated = await api(route, { key: false });
      assert.equal(updated.description, '导师看过的版本，第三章已修改。');
      assert.equal(updated.key, false);
      const unicodeLimit = '😀'.repeat(2000);
      updated = await api(route, { description: ` ${unicodeLimit} ` });
      assert.equal(updated.description, unicodeLimit);
      assert.equal(updated.key, false);
      const before = versions.get(second.id);
      const rejected = await api(
        route,
        { title: '不能部分保存', description: '字'.repeat(2001) },
        400,
      );
      assert.equal(rejected.code, 'VERSION_DESCRIPTION_TOO_LONG');
      const invalid = await api(route, { description: '不能部分保存', key: null }, 400);
      assert.equal(invalid.code, 'INVALID_VERSION_METADATA');
      assert.equal((await api(route, { key: 1 }, 400)).code, 'INVALID_VERSION_METADATA');
      assert.deepEqual(versions.get(second.id), before);
      updated = await api(route, { description: '   ' });
      assert.equal(updated.description, '');
      assert.equal(updated.title, '修订标题');
      assert.equal(updated.label, '简短标签');
      assert.equal(updated.tier, '投稿');
      for (const action of ['marked', 'key-changed'])
        assert.ok(
          core.db
            .prepare(
              "SELECT 1 FROM events WHERE type='versions.changed' AND json_extract(payload_json,'$.action')=?",
            )
            .get(action),
        );
    } finally {
      await server.close();
      await versions.close();
    }
  });
});

test('failed metadata transaction rolls back marks and branch renames together', async () => {
  await withCore('version-marks-rollback', async (core) => {
    const project = await core.projects.create({ name: '合成事务回滚' });
    const versions = createVersions(core);
    try {
      const imported = await versions.importFiles({
        projectId: project.id,
        files: ['首稿', '修订'].map((text) => ({
          name: `${text}.md`,
          base64: Buffer.from(text).toString('base64'),
        })),
      });
      await versions.diffIdle();
      const before = versions.list(project.id);
      const events = core.db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
      core.db.exec(`CREATE TRIGGER fail_group_update BEFORE UPDATE ON version_groups
        BEGIN SELECT RAISE(ABORT, 'Synthetic metadata write failure'); END;`);
      await assert.rejects(
        versions.updateMetadata(imported.versions[1].id, {
          branch: '合成新分支',
          title: '事务内标题',
          label: '事务内标签',
          tier: '投稿',
          description: '事务内描述',
          key: true,
        }),
        /Synthetic metadata write failure/u,
      );
      assert.deepEqual(versions.list(project.id), before);
      assert.equal(core.db.prepare('SELECT COUNT(*) AS count FROM events').get().count, events);
      core.db.exec('DROP TRIGGER fail_group_update');
      assert.equal(
        (await versions.updateMetadata(imported.versions[1].id, { key: true })).key,
        true,
      );
    } finally {
      await versions.close();
    }
  });
});
