import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { renameSync } from 'node:fs';
import { mkdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { withCore, tempDir } from '../../testing.js';
import { createCore } from '../../core/index.js';
import { createResearch } from '../research/index.js';
import { createProjectFiles } from '../project-files.js';
import { createProjectIndex } from './project-index.js';
import { snapshotProjectFile } from './project-copies.js';

function deferred() {
  /** @type {() => void} */
  let resolve = () => {};
  /** @type {Promise<void>} */
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test(
  'a queued file deleted during copying is resolved by the follow-up listing',
  { timeout: 30_000 },
  () =>
    withCore('project-index-deleted-queued', async (core, dir) => {
      const folder = path.join(dir, 'project');
      await mkdir(folder);
      const file = path.join(folder, 'evidence.md');
      await writeFile(file, '# Evidence\n');
      const project = await core.projects.create({ name: 'Deleted queued file', folder });
      const research = createResearch(core);
      const started = deferred();
      const gate = deferred();
      let parses = 0;
      const index = createProjectIndex({
        core,
        files: createProjectFiles(core),
        research: {
          ...research,
          async parseProjectSource(id, actor, snapshot) {
            parses++;
            return research.parseProjectSource(id, actor, snapshot);
          },
        },
        async copy(library, projectId, source, expected) {
          started.resolve();
          await gate.promise;
          return snapshotProjectFile(library, projectId, source, expected);
        },
      });
      try {
        await index.scan(project.id);
        await started.promise;
        const queued = research.store.listSources({ projectId: project.id })[0];
        assert.equal(queued.contentStatus, 'queued');
        await unlink(file);
        gate.resolve();
        await index.idle(project.id);
        assert.deepEqual(research.store.listSources({ projectId: project.id }), []);
        assert.equal(parses, 0);
        assert.equal(index.status(project.id).phase, 'idle');
        assert.equal(index.status(project.id).queued, 0);
      } finally {
        gate.resolve();
        await index.close();
      }
    }),
);

test(
  'a continuously changing file gets one automatic follow-up and completes on a later explicit scan',
  { timeout: 30_000 },
  () =>
    withCore('project-index-changing', async (core, dir) => {
      const folder = path.join(dir, 'project');
      await mkdir(folder);
      await writeFile(path.join(folder, 'evidence.md'), '# Stable final evidence\n');
      const project = await core.projects.create({ name: 'Changing file queue', folder });
      const research = createResearch(core);
      let changing = true;
      let copies = 0;
      let parses = 0;
      const index = createProjectIndex({
        core,
        files: createProjectFiles(core),
        research: {
          ...research,
          async parseProjectSource(id, actor, snapshot) {
            parses++;
            return research.parseProjectSource(id, actor, snapshot);
          },
        },
        async copy(library, projectId, file, expected) {
          copies++;
          if (changing)
            throw Object.assign(new Error('File changed during indexing; scan again.'), {
              code: 'INDEX_FILE_CHANGED',
            });
          return snapshotProjectFile(library, projectId, file, expected);
        },
      });
      try {
        const first = await index.scanAndWait(project.id);
        assert.equal(copies, 2, 'the initial attempt has exactly one automatic follow-up');
        assert.equal(parses, 0);
        assert.equal(first.queued, 1);
        assert.equal(first.failed, 0);
        const queued = research.store.listSources({ projectId: project.id })[0];
        assert.equal(queued.contentStatus, 'queued');
        assert.equal(queued.originalPath, null);
        assert.equal(queued.parseError, null);
        assert.deepEqual(index.status(project.id), {
          phase: 'idle',
          total: 1,
          done: 0,
          queued: 1,
          failed: 0,
        });
        changing = false;
        const next = await index.scanAndWait(project.id);
        assert.equal(copies, 3);
        assert.equal(parses, 1);
        assert.equal(next.queued, 0);
        const completed = research.store.getSource(queued.id);
        assert.equal(completed.contentStatus, 'parsed');
        assert.ok(completed.originalPath);
        assert.equal(index.status(project.id).queued, 0);
      } finally {
        await index.close();
      }
    }),
);

test(
  'an unavailable root after an empty listing preserves missing catalog identities',
  { timeout: 30_000 },
  () =>
    withCore('project-index-unavailable-root', async (core, dir) => {
      const folder = path.join(dir, 'project');
      const moved = path.join(dir, 'project-moved');
      await mkdir(folder);
      const file = path.join(folder, 'evidence.md');
      await writeFile(file, '# Durable evidence\n');
      const project = await core.projects.create({ name: 'Unavailable root', folder });
      const research = createResearch(core);
      const index = createProjectIndex({ core, research, files: createProjectFiles(core) });
      try {
        await index.scanAndWait(project.id);
        const original = research.store.listSources({ projectId: project.id })[0];
        const chunks = research.store.chunks(original.id);
        await unlink(file);
        const listing = await index.scan(project.id);
        assert.equal(listing.queued, 0);
        assert.equal(listing.deleted, 0);
        // Listing is the barrier: move synchronously before the background
        // continuation can treat this now-unavailable root as an empty folder.
        renameSync(folder, moved);
        const final = await index.idle(project.id);
        assert.equal(final.deleted, 0);
        assert.equal(final.failed, 1);
        assert.equal(research.store.getSource(original.id).id, original.id);
        assert.equal(research.store.getSource(original.id).originalPath, original.originalPath);
        assert.deepEqual(research.store.chunks(original.id), chunks);
      } finally {
        await index.close();
      }
    }),
);

test(
  'rebinding to the same content at a new path preserves the queued original identity',
  { timeout: 30_000 },
  () =>
    withCore('project-index-rebound-move', async (core, dir) => {
      const first = path.join(dir, 'first-folder');
      const second = path.join(dir, 'second-folder');
      await mkdir(first);
      await mkdir(second);
      const bytes = '# Evidence moved with the project folder\n';
      await writeFile(path.join(first, 'old.md'), bytes);
      const newFile = path.join(second, 'new.md');
      await writeFile(newFile, bytes);
      const project = await core.projects.create({ name: 'Rebound moved identity', folder: first });
      const research = createResearch(core);
      const started = deferred();
      const gate = deferred();
      const index = createProjectIndex({
        core,
        research,
        files: createProjectFiles(core),
        async copy(library, projectId, file, expected) {
          if (file === newFile) {
            started.resolve();
            await gate.promise;
          }
          return snapshotProjectFile(library, projectId, file, expected);
        },
      });
      try {
        await index.scanAndWait(project.id);
        const original = research.store.listSources({ projectId: project.id })[0];
        assert.equal(original.contentStatus, 'parsed');
        const changedTime = new Date(original.fileMtimeMs + 2000);
        await utimes(newFile, changedTime, changedTime);
        await core.projects.update(project.id, { folder: second });
        await started.promise;
        assert.equal(research.store.getSource(original.id).contentStatus, 'queued');
        const provisional = research.store
          .listSources({ projectId: project.id })
          .find((source) => source.folderPath === 'new.md');
        assert.equal(provisional.contentStatus, 'queued');
        assert.equal(provisional.contentHash, null);
        gate.resolve();
        await index.idle(project.id);
        const final = research.store.listSources({ projectId: project.id });
        assert.equal(final.length, 1);
        assert.equal(final[0].id, original.id);
        assert.equal(final[0].folderPath, 'new.md');
        assert.equal(final[0].contentHash, original.contentHash);
        assert.equal(final[0].originalPath, original.originalPath);
        assert.equal(final[0].contentStatus, 'parsed');
        assert.ok(
          research.store.chunks(original.id).some((chunk) => chunk.text.includes('Evidence moved')),
        );
        assert.throws(() => research.store.getSource(provisional.id), { code: 'SOURCE_NOT_FOUND' });
        assert.equal(index.status(project.id).queued, 0);
      } finally {
        gate.resolve();
        await index.close();
      }
    }),
);

test(
  'rebinding the folder reparses equal-path equal-stamp files from the new folder',
  { timeout: 30_000 },
  () =>
    withCore('project-index-rebound', async (core, dir) => {
      const first = path.join(dir, 'first-folder');
      const second = path.join(dir, 'second-folder');
      await mkdir(first);
      await mkdir(second);
      const earlier = '# Earlier evidence\n';
      const updated = '# Updated evidence\n';
      const oldFile = path.join(first, 'a.md');
      const newFile = path.join(second, 'a.md');
      await writeFile(oldFile, earlier);
      await writeFile(newFile, updated);
      const timestamp = new Date('2025-01-01T00:00:00Z');
      await utimes(oldFile, timestamp, timestamp);
      await utimes(newFile, timestamp, timestamp);
      const oldStamp = await stat(oldFile);
      const newStamp = await stat(newFile);
      assert.equal(oldStamp.size, newStamp.size);
      assert.equal(oldStamp.mtimeMs, newStamp.mtimeMs);
      const project = await core.projects.create({ name: 'Rebound folder', folder: first });
      const research = createResearch(core);
      const started = deferred();
      const gate = deferred();
      const index = createProjectIndex({
        core,
        files: createProjectFiles(core),
        research,
        async copy(library, projectId, file, expected) {
          if (file === path.join(first, 'pending.md')) {
            started.resolve();
            await gate.promise;
          }
          return snapshotProjectFile(library, projectId, file, expected);
        },
      });
      try {
        await index.scanAndWait(project.id);
        const original = research.store.listSources({ projectId: project.id })[0];
        await writeFile(path.join(first, 'pending.md'), '# Pending old-folder evidence\n');
        await index.scan(project.id);
        await started.promise;
        await core.projects.update(project.id, { folder: second });
        gate.resolve();
        await index.idle(project.id);
        const final = research.store.listSources({ projectId: project.id });
        assert.equal(final.length, 1);
        assert.equal(final[0].folderPath, 'a.md');
        assert.equal(final[0].contentStatus, 'parsed');
        assert.notEqual(final[0].contentHash, original.contentHash);
        assert.ok(
          research.store
            .chunks(final[0].id)
            .some((chunk) => chunk.text.includes('Updated evidence')),
        );
        assert.ok(
          research.store
            .chunks(final[0].id)
            .every((chunk) => !chunk.text.includes('Earlier evidence')),
        );
        assert.equal(index.status(project.id).queued, 0);
      } finally {
        gate.resolve();
        await index.close();
      }
    }),
);

test(
  'archiving pauses queued work and unarchiving resumes it with the same source identities',
  { timeout: 30_000 },
  () =>
    withCore('project-index-archived', async (core, dir) => {
      const folder = path.join(dir, 'project');
      await mkdir(folder);
      await writeFile(path.join(folder, 'a.md'), '# First evidence\n');
      await writeFile(path.join(folder, 'b.md'), '# Second evidence\n');
      const project = await core.projects.create({ name: 'Archived queue', folder });
      const research = createResearch(core);
      const started = deferred();
      const gate = deferred();
      let copies = 0;
      let parses = 0;
      const index = createProjectIndex({
        core,
        concurrency: 1,
        files: createProjectFiles(core),
        research: {
          ...research,
          async parseProjectSource(id, actor, snapshot) {
            parses++;
            return research.parseProjectSource(id, actor, snapshot);
          },
        },
        async copy(library, projectId, file, expected) {
          copies++;
          if (copies === 1) {
            started.resolve();
            await gate.promise;
          }
          return snapshotProjectFile(library, projectId, file, expected);
        },
      });
      try {
        await index.scan(project.id);
        await started.promise;
        const initial = research.store.listSources({ projectId: project.id });
        await core.projects.update(project.id, { archived: true });
        gate.resolve();
        await index.idle(project.id);
        assert.equal(parses, 0);
        assert.ok(
          research.store
            .listSources({ projectId: project.id })
            .every((source) => source.contentStatus === 'queued'),
        );
        assert.equal(index.status(project.id).queued, 2);
        await core.projects.update(project.id, { archived: false });
        await index.idle(project.id);
        const final = research.store.listSources({ projectId: project.id });
        assert.deepEqual(
          new Set(final.map((source) => source.id)),
          new Set(initial.map((source) => source.id)),
        );
        assert.ok(final.every((source) => source.contentStatus === 'parsed'));
        assert.equal(parses, 2);
        assert.equal(index.status(project.id).queued, 0);
      } finally {
        gate.resolve();
        await index.close();
      }
    }),
);

test(
  'a provisional moved path keeps the original identity when its queue resumes after restart',
  { timeout: 30_000 },
  async () => {
    const { dir, cleanup } = await tempDir('project-index-move-restart');
    let core;
    let index;
    const gate = deferred();
    try {
      core = await createCore({ dataRoot: dir });
      const folder = path.join(dir, 'project');
      await mkdir(folder);
      await writeFile(path.join(folder, 'old.md'), '# Durable moved evidence\n');
      const project = await core.projects.create({ name: 'Moved queue restart', folder });
      const research = createResearch(core);
      const started = deferred();
      let block = false;
      index = createProjectIndex({
        core,
        research,
        files: createProjectFiles(core),
        async copy(library, projectId, file, expected) {
          if (block) {
            started.resolve();
            await gate.promise;
          }
          return snapshotProjectFile(library, projectId, file, expected);
        },
      });
      await index.scanAndWait(project.id);
      const original = research.store.listSources({ projectId: project.id })[0];
      const chunks = research.store.chunks(original.id);
      await rename(path.join(folder, 'old.md'), path.join(folder, 'new.md'));
      const changedTime = new Date(original.fileMtimeMs + 2000);
      await utimes(path.join(folder, 'new.md'), changedTime, changedTime);
      block = true;
      await index.scan(project.id);
      await started.promise;
      const provisional = research.store
        .listSources({ projectId: project.id })
        .find((source) => source.folderPath === 'new.md');
      assert.equal(provisional.contentStatus, 'queued');
      assert.equal(provisional.contentHash, null);
      const closing = index.close();
      gate.resolve();
      await closing;
      core.close();
      core = await createCore({ dataRoot: dir });
      const resumed = createResearch(core);
      let parses = 0;
      index = createProjectIndex({
        core,
        files: createProjectFiles(core),
        research: {
          ...resumed,
          async parseProjectSource(id, actor, snapshot) {
            parses++;
            return resumed.parseProjectSource(id, actor, snapshot);
          },
        },
      });
      await index.idle(project.id);
      const final = resumed.store.listSources({ projectId: project.id });
      assert.equal(final.length, 1);
      assert.equal(final[0].id, original.id);
      assert.equal(final[0].folderPath, 'new.md');
      assert.equal(final[0].originalPath, original.originalPath);
      assert.equal(final[0].contentStatus, 'parsed');
      assert.deepEqual(resumed.store.chunks(original.id), chunks);
      assert.equal(parses, 0);
      assert.throws(() => resumed.store.getSource(provisional.id), { code: 'SOURCE_NOT_FOUND' });
      assert.equal(index.status(project.id).queued, 0);
    } finally {
      gate.resolve();
      await index?.close();
      core?.close();
      await cleanup();
    }
  },
);
