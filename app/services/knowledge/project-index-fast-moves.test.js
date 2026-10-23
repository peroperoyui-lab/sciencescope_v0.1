import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, rename, stat, utimes, writeFile } from 'node:fs/promises';
import { withCore } from '../../testing.js';
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

test('unique rename and folder move preserve completed IDs and search during listing without content work', () =>
  withCore('project-index-fast-moves', async (core, dir) => {
    const folder = path.join(dir, 'project');
    await mkdir(path.join(folder, 'nested'), { recursive: true });
    await writeFile(path.join(folder, 'old.md'), '# Original academic evidence\n');
    await writeFile(path.join(folder, 'old.dta'), 'binary data fixture');
    const project = await core.projects.create({ name: 'Fast moves', folder });
    const research = createResearch(core);
    let copies = 0;
    let parses = 0;
    let stats = 0;
    const index = createProjectIndex({
      core,
      files: createProjectFiles(core),
      async stat(file) {
        stats++;
        return stat(file);
      },
      async copy(library, projectId, file, expected) {
        copies++;
        return snapshotProjectFile(library, projectId, file, expected);
      },
      research: {
        ...research,
        async parseProjectSource(id, actor, snapshot) {
          parses++;
          return research.parseProjectSource(id, actor, snapshot);
        },
      },
    });
    try {
      await index.scanAndWait(project.id);
      const original = research.store.listSources({ projectId: project.id });
      const paper = original.find((source) => source.name === 'old.md');
      const data = original.find((source) => source.name === 'old.dta');
      research.store.updateSource(paper.id, { title: 'My curated research title' });
      const chunks = research.store.chunks(paper.id);
      await rename(path.join(folder, 'old.md'), path.join(folder, 'renamed.md'));
      await rename(path.join(folder, 'old.dta'), path.join(folder, 'nested/moved.dta'));
      copies = parses = stats = 0;
      const listing = await index.scan(project.id);
      assert.equal(listing.moved, 2);
      assert.equal(listing.added, 0);
      assert.equal(listing.updated, 0);
      assert.equal(listing.queued, 0);
      assert.equal(listing.nameOnly, 1);
      assert.equal(copies, 0);
      assert.equal(parses, 0);
      assert.equal(stats, 2, 'each present path is stat-ed once');
      assert.equal(research.store.listSources({ projectId: project.id }).length, 2);
      const movedPaper = research.store.getSource(paper.id);
      const movedData = research.store.getSource(data.id);
      assert.equal(movedPaper.folderPath, 'renamed.md');
      assert.equal(movedPaper.name, 'renamed.md');
      assert.equal(movedPaper.title, 'My curated research title');
      assert.equal(movedPaper.originalPath, paper.originalPath);
      assert.equal(movedPaper.contentStatus, 'parsed');
      assert.deepEqual(research.store.chunks(paper.id), chunks);
      assert.equal(movedData.folderPath, 'nested/moved.dta');
      assert.equal(movedData.title, 'moved.dta');
      assert.equal(movedData.contentStatus, 'name-only');
      assert.equal(movedData.parseError, data.parseError);
      assert.ok(
        research
          .search('renamed', { projectId: project.id })
          .hits.some((hit) => hit.sourceId === paper.id),
      );
      assert.ok(
        research
          .search('nested moved', { projectId: project.id })
          .hits.some((hit) => hit.sourceId === data.id),
      );
      const final = await index.idle(project.id);
      assert.equal(final.deleted, 0);
      assert.equal(copies, 0);
      assert.equal(parses, 0);
      assert.deepEqual(index.status(project.id), {
        phase: 'idle',
        total: 2,
        done: 2,
        queued: 0,
        failed: 0,
      });
    } finally {
      await index.close();
    }
  }));

test('a title edited while listing stats a renamed file survives the fast move', () =>
  withCore('project-index-fast-move-title', async (core, dir) => {
    const folder = path.join(dir, 'project');
    await mkdir(folder);
    await writeFile(path.join(folder, 'old.md'), '# Evidence with a user curated title\n');
    const target = path.join(folder, 'renamed.md');
    const project = await core.projects.create({ name: 'Concurrent move title', folder });
    const research = createResearch(core);
    const started = deferred();
    const gate = deferred();
    let block = false;
    let copies = 0;
    const index = createProjectIndex({
      core,
      research,
      files: createProjectFiles(core),
      async stat(file) {
        if (block && file === target) {
          started.resolve();
          await gate.promise;
        }
        return stat(file);
      },
      async copy(...args) {
        copies++;
        return snapshotProjectFile(...args);
      },
    });
    try {
      await index.scanAndWait(project.id);
      const source = research.store.listSources({ projectId: project.id })[0];
      await rename(path.join(folder, 'old.md'), target);
      copies = 0;
      block = true;
      const listing = index.scan(project.id);
      await started.promise;
      research.store.updateSource(
        source.id,
        { title: 'Title edited while listing' },
        { actorId: 'person_user' },
      );
      gate.resolve();
      assert.equal((await listing).moved, 1);
      const moved = research.store.getSource(source.id);
      assert.equal(moved.folderPath, 'renamed.md');
      assert.equal(moved.name, 'renamed.md');
      assert.equal(moved.title, 'Title edited while listing');
      await index.idle(project.id);
      assert.equal(copies, 0);
    } finally {
      gate.resolve();
      await index.close();
    }
  }));

test('global stamp ambiguity on either side remains queued for background hash matching', async () => {
  for (const [oldCount, newCount] of [
    [1, 2],
    [2, 1],
  ]) {
    await withCore(`project-index-ambiguous-${oldCount}-${newCount}`, async (core, dir) => {
      const folder = path.join(dir, 'project');
      await mkdir(folder);
      const timestamp = new Date('2025-01-01T00:00:00Z');
      for (let i = 0; i < oldCount; i++) {
        const file = path.join(folder, `old${i}.md`);
        await writeFile(file, '# Same academic evidence\n');
        await utimes(file, timestamp, timestamp);
      }
      const project = await core.projects.create({ name: 'Ambiguous stamps', folder });
      const research = createResearch(core);
      const gate = deferred();
      let block = false;
      const index = createProjectIndex({
        core,
        research,
        files: createProjectFiles(core),
        batchSize: 1,
        async copy(library, projectId, file, expected) {
          if (block) await gate.promise;
          return snapshotProjectFile(library, projectId, file, expected);
        },
      });
      try {
        await index.scanAndWait(project.id);
        const old = research.store.listSources({ projectId: project.id });
        await rename(path.join(folder, 'old0.md'), path.join(folder, 'new0.md'));
        if (oldCount === 2)
          await rename(path.join(folder, 'old1.md'), path.join(dir, 'removed.md'));
        if (newCount === 2) {
          await writeFile(path.join(folder, 'new1.md'), '# Same academic evidence\n');
          await utimes(path.join(folder, 'new1.md'), timestamp, timestamp);
        }
        block = true;
        const listing = await index.scan(project.id);
        assert.equal(listing.moved, 0);
        assert.equal(listing.added, newCount);
        assert.equal(listing.queued, newCount);
        const queued = research.store
          .listSources({ projectId: project.id })
          .filter((source) => source.contentStatus === 'queued');
        assert.equal(queued.length, newCount);
        assert.ok(queued.every((source) => !old.some((prior) => prior.id === source.id)));
        for (const source of old)
          assert.equal(research.store.getSource(source.id).folderPath, source.folderPath);
        gate.resolve();
        await index.idle(project.id);
        assert.equal(index.status(project.id).queued, 0);
      } finally {
        gate.resolve();
        await index.close();
      }
    });
  }
});

test('unique moves of queued and failed sources retain identity and still complete background parsing', () =>
  withCore('project-index-fast-pending', async (core, dir) => {
    const folder = path.join(dir, 'project');
    await mkdir(folder);
    const project = await core.projects.create({ name: 'Pending fast moves', folder });
    const research = createResearch(core);
    const gate = deferred();
    let copies = 0;
    let parses = 0;
    const index = createProjectIndex({
      core,
      files: createProjectFiles(core),
      async copy(library, projectId, file, expected) {
        copies++;
        await gate.promise;
        return snapshotProjectFile(library, projectId, file, expected);
      },
      research: {
        ...research,
        async parseProjectSource(id, actor, snapshot) {
          parses++;
          return research.parseProjectSource(id, actor, snapshot);
        },
      },
    });
    try {
      const originals = [];
      for (const [i, status] of ['queued', 'failed'].entries()) {
        const name = `old${i}.md`;
        const file = path.join(folder, name);
        await writeFile(file, `# ${status} academic evidence ${i}\n`);
        const stamp = await stat(file);
        originals.push(
          research.store.createSource({
            projectId: project.id,
            folderPath: name,
            title: name,
            name,
            contentStatus: status,
            parseError: status === 'failed' ? 'Old failure' : null,
            fileSize: stamp.size,
            fileMtimeMs: stamp.mtimeMs,
          }),
        );
        await rename(file, path.join(folder, `new${i}.md`));
      }
      const listing = await index.scan(project.id);
      assert.equal(listing.moved, 2);
      assert.equal(listing.added, 0);
      assert.equal(listing.queued, 2);
      assert.equal(copies, 0);
      assert.equal(parses, 0);
      for (const [i, original] of originals.entries()) {
        const source = research.store.getSource(original.id);
        assert.equal(source.folderPath, `new${i}.md`);
        assert.equal(source.contentStatus, 'queued');
        assert.equal(source.parseError, null);
      }
      gate.resolve();
      await index.idle(project.id);
      assert.equal(copies, 2);
      assert.equal(parses, 2);
      assert.ok(
        originals.every((source) => research.store.getSource(source.id).contentStatus === 'parsed'),
      );
      assert.equal(research.store.listSources({ projectId: project.id }).length, 2);
    } finally {
      gate.resolve();
      await index.close();
    }
  }));
