import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { withCore } from '../../testing.js';
import { createVersions } from './index.js';
import { runDiffWorker } from './diff-worker-client.js';
import { createDesk } from '../desk/index.js';
import { createProjectFiles } from '../project-files.js';
import { createAppServer } from '../../server/server.js';

const file = (text, name = '稿件.md') => ({ name, base64: Buffer.from(text).toString('base64') });
const empty = () => ({
  old: { blocks: [] },
  new: { blocks: [] },
  diff: { algorithm: 1, status: 'unchanged' },
});

test('desk close enqueues parent comparison; HTTP returns blocks, cached arbitrary baselines and group errors', () =>
  withCore('block-diff-http', async (core, dir) => {
    let calculations = 0;
    const versions = createVersions(core, {
      diffs: {
        compute: async (input, signal) => {
          if (!input.cached) calculations++;
          return runDiffWorker(input, signal);
        },
      },
    });
    const project = await core.projects.create({ name: '比较', folder: dir });
    await writeFile(path.join(dir, '稿件.md'), '# 研究\n\n研究发现经济发展。\n\n保留证据。');
    const desk = createDesk(core, { versions, projectFiles: createProjectFiles(core) });
    const server = createAppServer({ core, versions, desk, token: 'diff-test' });
    const url = await server.listen();
    const request = async (id, baseline, status = 200) => {
      const response = await fetch(
        `${url}/api/versions/${id}/diff${baseline ? '?baseline=' + baseline : ''}`,
        { headers: { authorization: 'Bearer diff-test' } },
      );
      const value = await response.json();
      assert.equal(response.status, status, JSON.stringify(value));
      return value;
    };
    try {
      const group = await desk.registerDocument({ projectId: project.id, path: '稿件.md' });
      const { session } = await desk.openSession({ groupId: group.id });
      await desk.updateText(session.id, {
        baseSeq: 0,
        text: '# 研究\n\n研究发现社会发展。\n\n保留证据。',
      });
      const closed = await desk.closeSession(session.id);
      await versions.diffIdle();
      const v1 = session.baseVersionId,
        v2 = closed.version.id;
      assert.equal(core.db.prepare('SELECT count(*) AS n FROM version_diffs').get().n, 1);
      assert.deepEqual(await request(v1), { status: 'first' });
      const result = await request(v2);
      assert.deepEqual(result.baseline, { id: v1, number: 1, branch: '' });
      assert.equal(result.format, 'md');
      assert.equal(result.old.blocks[1].text, '研究发现经济发展。');
      assert.deepEqual(result.diff.counts, { deleted: 1, inserted: 1, format: 0 });
      assert.equal(calculations, 1);
      const branch = (await versions.saveAsNew(v1)).versions[0];
      await versions.diffIdle();
      assert.notEqual(branch.branch, closed.version.branch);
      const prior = calculations;
      const comparison = await request(branch.id, v2);
      assert.equal(comparison.diff.status, 'ready');
      assert.equal(calculations, prior + 1);
      assert.deepEqual(await request(branch.id, v2), comparison);
      assert.equal(calculations, prior + 1);
      core.db
        .prepare('UPDATE version_diffs SET algorithm=0 WHERE baseline_id=? AND version_id=?')
        .run(v2, branch.id);
      assert.deepEqual(await request(branch.id, v2), comparison);
      assert.equal(calculations, prior + 2);
      const unrelated = await versions.importFiles({
        projectId: project.id,
        files: [file('其他文稿')],
      });
      assert.equal((await request(v2, unrelated.versions[0].id, 400)).code, 'INVALID_BASELINE');
    } finally {
      await versions.close();
      await server.close();
      await desk.shutdown();
    }
  }));

test('unsupported and malformed originals stay available without a false successful cache', () =>
  withCore('block-diff-originals', async (core) => {
    const errors = [];
    const versions = createVersions(core, { diffs: { log: (...args) => errors.push(args) } });
    const project = await core.projects.create({ name: '原件' });
    try {
      for (const name of ['稿件.bin', '损坏.docx']) {
        const imported = await versions.importFiles({
          projectId: project.id,
          files: [file('old', name), file('new', name)],
        });
        const result = await versions.diff(imported.versions[1].id);
        assert.deepEqual(result.diff, { status: 'originals-only' });
        assert.equal(result.old, null);
        assert.equal(result.new, null);
        assert.equal(result.version.id, imported.versions[1].id);
      }
      assert.equal(core.db.prepare('SELECT count(*) AS n FROM version_diffs').get().n, 0);
      assert.equal(errors.length, 1);
    } finally {
      await versions.close();
    }
  }));

test('background failures preserve committed versions and retry on demand', () =>
  withCore('block-diff-failure', async (core) => {
    let calls = 0;
    const errors = [];
    const versions = createVersions(core, {
      diffs: {
        compute: async () => {
          if (++calls === 1) throw new Error('fixture worker failure');
          return empty();
        },
        log: (...args) => errors.push(args),
      },
    });
    const project = await core.projects.create({ name: '重算' });
    try {
      const imported = await versions.importFiles({
        projectId: project.id,
        files: [file('首版'), file('次版')],
      });
      await versions.diffIdle();
      assert.equal(versions.get(imported.versions[1].id).number, 2);
      assert.equal(errors.length, 1);
      assert.equal(core.db.prepare('SELECT count(*) AS n FROM version_diffs').get().n, 0);
      assert.equal((await versions.diff(imported.versions[1].id)).diff.status, 'unchanged');
      assert.equal(calls, 2);
      assert.equal(core.db.prepare('SELECT count(*) AS n FROM version_diffs').get().n, 1);
    } finally {
      await versions.close();
    }
  }));

test('background queue does not block saves, serializes work, deduplicates requests and cancels on shutdown', () =>
  withCore('block-diff-queue', async (core) => {
    const started = [];
    const releases = [];
    let notify;
    const first = new Promise((resolve) => {
      notify = resolve;
    });
    const versions = createVersions(core, {
      diffs: {
        compute: async (input, signal) => {
          started.push(input);
          notify();
          return new Promise((resolve, reject) => {
            releases.push(() => resolve(empty()));
            signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
          });
        },
      },
    });
    const project = await core.projects.create({ name: '队列' });
    try {
      const imported = await versions.importFiles({
        projectId: project.id,
        files: [file('一'), file('二'), file('三')],
      });
      // Import has returned even though the first calculation remains gated.
      assert.equal(imported.versions.length, 3);
      await first;
      assert.equal(started.length, 1);
      const firstRequest = versions.diff(imported.versions[1].id);
      assert.equal(versions.diff(imported.versions[1].id), firstRequest);
      releases.shift()();
      await firstRequest;
      assert.equal(started.length, 2);
      const pending = assert.rejects(versions.diff(imported.versions[2].id), /cancelled/u);
      await versions.close();
      await pending;
      assert.equal(core.db.prepare('SELECT count(*) AS n FROM version_diffs').get().n, 1);
    } finally {
      await versions.close();
    }
  }));

test('actual worker cancellation waits for its thread to exit', async () => {
  const controller = new AbortController();
  const pending = runDiffWorker(
    {
      before: { file: 'unused.docx', name: 'unused.docx' },
      after: { file: 'unused.docx', name: 'unused.docx' },
    },
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pending, { code: 'VERSION_DIFF_CLOSED' });
});
