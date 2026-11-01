import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createAppServer } from '../../server/server.js';
import { createVersions } from './index.js';

const file = (text) => ({ name: '公开合成稿.md', base64: Buffer.from(text).toString('base64') });
const writes = (core) => Number(core.db.prepare('SELECT total_changes() AS count').get().count);
const changed = (core, sequence = 0) =>
  core.events.since(sequence).filter((event) => event.type === 'versions.changed');
const head = (core) => core.events.since(0).at(-1)?.seq ?? 0;
const record = (t, scenario, value) =>
  t.diagnostic('P5_BRANCH_NAMES ' + JSON.stringify({ scenario, ...value }));

/** @param {(context:any)=>Promise<void>} work */
function withBranches(work) {
  return withCore('branch-names', async (core) => {
    const project = await core.projects.create({ name: '公开合成分支校验' });
    const versions = createVersions(core);
    const server = createAppServer({ core, versions, token: 'branch-test' });
    const address = await server.listen();
    try {
      const imported = await versions.importFiles({
        projectId: project.id,
        files: [file('首版合成资料。'), file('次版合成资料。')],
      });
      const [first, second] = imported.versions;
      const fork = await versions.createVersion({
        groupId: imported.group.id,
        parentId: first.id,
        bytes: Buffer.from('分支首版合成资料。'),
        name: '公开合成稿.md',
        origin: 'desk',
      });
      const child = await versions.createVersion({
        groupId: imported.group.id,
        parentId: fork.id,
        bytes: Buffer.from('分支次版合成资料。'),
        name: '公开合成稿.md',
        origin: 'desk',
      });
      await versions.diffIdle();
      const patch = async (id, changes) => {
        const response = await fetch(`${address}/api/versions/${id}`, {
          method: 'PATCH',
          headers: { authorization: 'Bearer branch-test', 'content-type': 'application/json' },
          body: JSON.stringify(changes),
        });
        return { status: response.status, body: await response.json() };
      };
      await work({
        core,
        project,
        versions,
        group: imported.group,
        first,
        second,
        fork,
        child,
        patch,
      });
    } finally {
      await server.close();
      await versions.close();
    }
  });
}

test('HTTP trims an entire branch rename and retains event identity and metadata action priority', (t) =>
  withBranches(async ({ core, project, versions, first, second, fork, child, patch }) => {
    const sequence = head(core);
    const response = await patch(fork.id, { branch: ' \t复核分支\n ' });
    const events = changed(core, sequence);
    record(t, 'trim-entire-branch', {
      status: response.status,
      branch: response.body.branch,
      branches: [versions.get(fork.id).branch, versions.get(child.id).branch],
      events: events.map((event) => event.payload),
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.branch, '复核分支');
    assert.equal(versions.get(fork.id).branch, '复核分支');
    assert.equal(versions.get(child.id).branch, '复核分支');
    assert.deepEqual(versions.get(first.id), first);
    assert.deepEqual(versions.get(second.id), second);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'versions.changed');
    assert.equal(events[0].projectId, project.id);
    assert.equal(events[0].actorId, 'person_user');
    assert.deepEqual(events[0].payload, {
      projectId: project.id,
      action: 'metadata',
      id: fork.id,
      oldBranch: fork.branch,
      newBranch: '复核分支',
    });

    const nextSequence = head(core);
    const marked = await patch(fork.id, {
      branch: '再次复核',
      description: '这一支已完成合成资料复核。',
      key: true,
    });
    assert.equal(marked.status, 200);
    const [event] = changed(core, nextSequence);
    assert.deepEqual(event.payload, {
      projectId: project.id,
      action: 'marked',
      id: fork.id,
      oldBranch: '复核分支',
      newBranch: '再次复核',
    });
    assert.equal(versions.get(child.id).branch, '再次复核');
  }));

test('HTTP rejects blank, overlong, nontext and trim-colliding names without partial metadata writes', (t) =>
  withBranches(async ({ core, project, versions, group, first, fork, patch }) => {
    const occupied = await versions.createVersion({
      groupId: group.id,
      parentId: first.id,
      bytes: Buffer.from('独立的合成分支。'),
      name: '公开合成稿.md',
      origin: 'desk',
    });
    await versions.diffIdle();
    const before = versions.list(project.id);
    const sequence = head(core);
    const count = writes(core);
    const cases = [
      { name: 'blank', branch: ' \n\t ', code: 'BRANCH_NAME_REQUIRED' },
      { name: 'over-40-codepoints', branch: '😀'.repeat(41), code: 'BRANCH_NAME_TOO_LONG' },
      { name: 'nontext', branch: null, code: 'INVALID_VERSION_METADATA' },
      { name: 'trim-collision', branch: ` ${occupied.branch} `, code: 'BRANCH_EXISTS' },
    ];
    const responses = [];
    for (const item of cases) {
      const response = await patch(fork.id, {
        branch: item.branch,
        title: '拒绝时不能部分写入的标题',
      });
      responses.push({
        scenario: item.name,
        expected: item.code,
        status: response.status,
        code: response.body.code ?? null,
      });
    }
    record(t, 'rejected-names', {
      responses,
      sqlWrites: writes(core) - count,
      events: changed(core, sequence).length,
    });
    for (const response of responses) {
      assert.equal(response.status, 400, response.scenario);
      assert.equal(response.code, response.expected, response.scenario);
    }
    assert.deepEqual(versions.list(project.id), before);
    assert.equal(writes(core), count);
    assert.deepEqual(changed(core, sequence), []);
  }));

test('a forty-codepoint emoji name is accepted without cutting surrogate pairs', (t) =>
  withBranches(async ({ core, versions, fork, child }) => {
    const branch = '😀'.repeat(40);
    const sequence = head(core);
    const updated = await versions.updateMetadata(fork.id, { branch });
    record(t, 'forty-codepoints', {
      codepoints: Array.from(updated.branch).length,
      codeUnits: updated.branch.length,
      childBranch: versions.get(child.id).branch,
      events: changed(core, sequence).map((event) => event.payload),
    });
    assert.equal(updated.branch, branch);
    assert.equal(Array.from(updated.branch).length, 40);
    assert.equal(updated.branch.length, 80);
    assert.equal(versions.get(child.id).branch, branch);
  }));

test('an unchanged branch performs no SQL writes or events while real title edits and tier validation still work', (t) =>
  withBranches(async ({ core, project, versions, group, fork, child }) => {
    core.db
      .prepare('UPDATE version_groups SET updated_at=? WHERE id=?')
      .run('2026-01-01T00:00:00Z', group.id);
    const before = versions.get(fork.id);
    const clock = core.versionCatalog.group(group.id).updatedAt;
    const sequence = head(core);
    const count = writes(core);
    const same = await versions.updateMetadata(fork.id, {
      branch: fork.branch,
      title: before.title,
      label: before.label,
      tier: before.tier,
      description: ` ${before.description} `,
      key: before.key,
    });
    const delta = writes(core) - count;
    record(t, 'same-name-noop', {
      sqlWrites: delta,
      events: changed(core, sequence).length,
      groupClockUnchanged: core.versionCatalog.group(group.id).updatedAt === clock,
    });
    assert.deepEqual(same, before);
    assert.equal(delta, 0);
    assert.deepEqual(changed(core, sequence), []);
    assert.equal(core.versionCatalog.group(group.id).updatedAt, clock);

    await versions.updateMetadata(fork.id, { branch: ` ${fork.branch} ` });
    assert.equal(writes(core), count);
    await assert.rejects(
      versions.updateMetadata(fork.id, { branch: fork.branch, tier: '不存在的层级' }),
      { code: 'INVALID_TIER' },
    );
    assert.equal(writes(core), count);
    assert.deepEqual(changed(core, sequence), []);

    const updated = await versions.updateMetadata(fork.id, {
      branch: ` ${fork.branch} `,
      title: '复核后的合成标题',
    });
    assert.equal(updated.title, '复核后的合成标题');
    assert.equal(updated.branch, fork.branch);
    assert.equal(versions.get(child.id).title, child.title);
    assert.ok(writes(core) > count);
    assert.notEqual(core.versionCatalog.group(group.id).updatedAt, clock);
    const events = changed(core, sequence);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].payload, { projectId: project.id, action: 'metadata', id: fork.id });
  }));
