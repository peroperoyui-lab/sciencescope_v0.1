import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { mkdir, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
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

/** Wait for a real event, with a deadline that fails instead of hanging a test. */
function idleEvent(core, projectId, timeout = 10_000) {
  let unsubscribe;
  let timer;
  /** @type {Promise<any>} */
  const promise = new Promise((resolve, reject) => {
    unsubscribe = core.events.subscribe((event) => {
      if (
        event.type === 'research.index.progress' &&
        event.payload.projectId === projectId &&
        event.payload.phase === 'idle'
      ) {
        clearTimeout(timer);
        unsubscribe();
        resolve(event.payload);
      }
    });
    timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Project index did not publish its idle progress event.'));
    }, timeout);
  });
  // The caller may first await listing/copy gates; avoid an unhandled rejection.
  void promise.catch(() => {});
  return {
    promise,
    cancel() {
      clearTimeout(timer);
      unsubscribe();
    },
  };
}

test(
  'concurrent projects share the service-wide limit of two background workers',
  {
    timeout: 30_000,
  },
  () =>
    withCore('project-index-shared-workers', async (core, dir) => {
      const projects = [];
      for (const name of ['first', 'second']) {
        const folder = path.join(dir, name);
        await mkdir(folder);
        await Promise.all(
          ['a.md', 'b.md'].map((file) =>
            writeFile(path.join(folder, file), `# ${name} ${file}\n\nDistinct research evidence.`),
          ),
        );
        projects.push(await core.projects.create({ name, folder }));
      }
      const research = createResearch(core);
      const gates = [deferred(), deferred()];
      const firstPairStarted = deferred();
      let copies = 0;
      let active = 0;
      let peak = 0;
      const index = createProjectIndex({
        core,
        research,
        files: createProjectFiles(core),
        concurrency: 2,
        async copy(library, projectId, file, expected) {
          const ordinal = copies++;
          active++;
          peak = Math.max(peak, active);
          if (copies === 2) firstPairStarted.resolve();
          try {
            if (ordinal < gates.length) await gates[ordinal].promise;
            return await snapshotProjectFile(library, projectId, file, expected);
          } finally {
            active--;
          }
        },
      });
      try {
        const listings = await Promise.all(projects.map((project) => index.scan(project.id)));
        assert.deepEqual(
          listings.map((result) => result.queued),
          [2, 2],
        );
        await firstPairStarted.promise;
        // Let both project schedulers reach their worker boundary while the first
        // two real copies remain explicitly blocked.
        await yieldLoop();
        assert.equal(active, 2);
        assert.equal(copies, 2, 'a second project cannot take two extra worker slots');
        for (const gate of gates) gate.resolve();
        await Promise.all(projects.map((project) => index.idle(project.id)));
        assert.equal(copies, 4);
        assert.equal(peak, 2, 'the concurrency limit applies across all projects');
        assert.equal(active, 0);
        for (const project of projects) {
          const sources = research.store.listSources({ projectId: project.id });
          assert.equal(sources.length, 2);
          assert.ok(sources.every((source) => source.contentStatus === 'parsed'));
          assert.equal(index.status(project.id).phase, 'idle');
        }
      } finally {
        for (const gate of gates) gate.resolve();
        await index.close();
      }
    }),
);

test(
  '2,000 files are searchable before copies or parsing, then finish with deduplicated copies',
  {
    timeout: 600_000,
  },
  (t) =>
    withCore('project-index-queue', async (core, dir) => {
      const folder = path.join(dir, 'large-project');
      await mkdir(folder);
      const names = Array.from(
        { length: 2000 },
        (_, i) => `batch_${String(i).padStart(4, '0')}.txt`,
      );
      await Promise.all(
        names.map((name) => writeFile(path.join(folder, name), 'Shared research evidence.')),
      );
      const project = await core.projects.create({ name: 'Large queue', folder });
      const research = createResearch(core);
      const gate = deferred();
      const started = deferred();
      let copies = 0;
      let parses = 0;
      let inFlight = 0;
      let maxInFlight = 0;
      const progress = [];
      const unsubscribe = core.events.subscribe((event) => {
        if (event.type === 'research.index.progress' && event.payload.projectId === project.id)
          progress.push({ time: performance.now(), ...event.payload });
      });
      const idle = idleEvent(core, project.id, 590_000);
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
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          started.resolve();
          try {
            await gate.promise;
            return await snapshotProjectFile(library, projectId, file, expected);
          } finally {
            inFlight--;
          }
        },
      });
      try {
        const listingStarted = performance.now();
        const first = await index.scan(project.id);
        const listingMs = performance.now() - listingStarted;
        assert.equal(first.added, names.length);
        assert.equal(first.queued, names.length);
        assert.equal(copies, 0, 'listing returns before any file is read for copying');
        assert.equal(parses, 0);
        const sources = research.store.listSources({ projectId: project.id });
        assert.equal(sources.length, names.length);
        assert.ok(sources.every((source) => source.contentStatus === 'queued'));
        assert.ok(sources.every((source) => source.originalPath === null));
        const hits = research.search('batch', { projectId: project.id, limit: names.length });
        assert.equal(hits.total, names.length);
        assert.deepEqual(
          new Set(hits.hits.map((hit) => hit.sourceId)),
          new Set(sources.map((s) => s.id)),
        );

        await started.promise;
        assert.equal(index.status(project.id).phase, 'indexing');
        const searchStarted = performance.now();
        const responsive = research.search('batch 1999', { projectId: project.id });
        const searchMs = performance.now() - searchStarted;
        t.diagnostic(
          `2,000-file listing: ${listingMs.toFixed(1)} ms; queued search: ${searchMs.toFixed(1)} ms`,
        );
        assert.ok(responsive.hits.some((hit) => hit.folderPath === 'batch_1999.txt'));
        assert.ok(
          searchMs < 1000,
          `Filename search during blocked background copying took ${searchMs} ms`,
        );
        assert.equal(parses, 0);
        gate.resolve();
        await index.idle(project.id);
        const final = research.store.listSources({ projectId: project.id });
        assert.ok(final.every((source) => source.contentStatus === 'parsed'));
        assert.equal(new Set(final.map((source) => source.originalPath)).size, 1);
        assert.equal(
          (await readdir(path.join(core.paths.library, 'project-files', project.id))).length,
          1,
        );
        assert.equal(copies, names.length);
        assert.equal(parses, names.length);
        assert.equal(maxInFlight, 2);
        assert.deepEqual(index.status(project.id), {
          phase: 'idle',
          total: names.length,
          done: names.length,
          queued: 0,
          failed: 0,
        });
        assert.equal((await idle.promise).done, names.length);
        for (let i = 1; i < progress.length; i++)
          assert.ok(
            progress[i].time - progress[i - 1].time >= 990,
            'progress is limited to once per second',
          );
        assert.equal(progress.at(-1).phase, 'idle');
      } finally {
        gate.resolve();
        idle.cancel();
        unsubscribe();
        await index.close();
      }
    }),
);

test('requests during listing share one listing pass', () =>
  withCore('project-index-coalesced', async (core, dir) => {
    const folder = path.join(dir, 'project');
    await mkdir(folder);
    await Promise.all(
      ['a.md', 'b.md', 'c.md'].map((name) => writeFile(path.join(folder, name), name)),
    );
    const project = await core.projects.create({ name: 'Coalesced listing', folder });
    const gate = deferred();
    const started = deferred();
    let calls = 0;
    const index = createProjectIndex({
      core,
      research: createResearch(core),
      files: createProjectFiles(core),
      async stat(file) {
        calls++;
        started.resolve();
        await gate.promise;
        return stat(file);
      },
    });
    try {
      const first = index.scan(project.id);
      await started.promise;
      assert.equal(index.status(project.id).phase, 'listing');
      const second = index.scan(project.id);
      const third = index.scan(project.id);
      gate.resolve();
      const results = await Promise.all([first, second, third]);
      assert.deepEqual(results[0], results[1]);
      assert.deepEqual(results[0], results[2]);
      assert.equal(results[0].added, 3);
      assert.equal(calls, 3, 'merged requests do not enumerate/stat every file again');
      await index.idle(project.id);
    } finally {
      gate.resolve();
      await index.close();
    }
  }));

test('closing stops taking work and reopening resumes queued sources without duplicate parse completion', async () => {
  const { dir, cleanup } = await tempDir('project-index-resume');
  let core;
  let index;
  let idle;
  const gate = deferred();
  try {
    core = await createCore({ dataRoot: dir });
    const folder = path.join(dir, 'project');
    await mkdir(folder);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        writeFile(path.join(folder, `${i}.md`), `Evidence ${i}.`),
      ),
    );
    const project = await core.projects.create({ name: 'Resumable queue', folder });
    const research = createResearch(core);
    const paused = deferred();
    let copies = 0;
    index = createProjectIndex({
      core,
      research,
      files: createProjectFiles(core),
      concurrency: 1,
      async copy(library, projectId, file, expected) {
        copies++;
        if (copies === 2) {
          paused.resolve();
          await gate.promise;
        }
        return snapshotProjectFile(library, projectId, file, expected);
      },
    });
    await index.scan(project.id);
    await paused.promise;
    const first = research.store.listSources({ projectId: project.id });
    assert.equal(first.filter((source) => source.contentStatus === 'parsed').length, 1);
    const closing = index.close();
    gate.resolve();
    await closing;
    assert.equal(copies, 2, 'close leaves the remaining queue untouched');
    const completed = research.store
      .listSources({ projectId: project.id })
      .filter((s) => s.contentStatus === 'parsed');
    assert.ok(completed.length >= 1 && completed.length <= 2);
    core.close();
    core = await createCore({ dataRoot: dir });
    const resumedResearch = createResearch(core);
    const reparsed = [];
    idle = idleEvent(core, project.id);
    index = createProjectIndex({
      core,
      files: createProjectFiles(core),
      research: {
        ...resumedResearch,
        async parseProjectSource(id, actor, snapshot) {
          reparsed.push(id);
          return resumedResearch.parseProjectSource(id, actor, snapshot);
        },
      },
    });
    await idle.promise;
    await index.idle(project.id);
    const final = resumedResearch.store.listSources({ projectId: project.id });
    assert.equal(final.length, 8);
    assert.deepEqual(
      new Set(final.map((source) => source.id)),
      new Set(first.map((source) => source.id)),
    );
    assert.ok(final.every((s) => s.contentStatus === 'parsed'));
    assert.ok(completed.every((source) => !reparsed.includes(source.id)));
    const imports = core.events
      .since(0)
      .filter(
        (event) => event.type === 'research.changed' && event.payload.action === 'source.imported',
      );
    assert.equal(imports.length, 8);
    assert.equal(new Set(imports.map((event) => event.payload.sourceId)).size, 8);
  } finally {
    gate.resolve();
    idle?.cancel();
    await index?.close();
    core?.close();
    await cleanup();
  }
});

test('moves keep identity without parsing, deletion waits for background work, and failed reads preserve missing identities', () =>
  withCore('project-index-move-queue', async (core, dir) => {
    const folder = path.join(dir, 'project');
    await mkdir(folder);
    await writeFile(path.join(folder, 'old.md'), 'Original research evidence.');
    const project = await core.projects.create({ name: 'Move and deletion queue', folder });
    const research = createResearch(core);
    const gate = deferred();
    const started = deferred();
    let block = false;
    let fail = false;
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
        if (fail) throw Object.assign(new Error('Fixture read failure'), { code: 'EACCES' });
        if (block) {
          started.resolve();
          await gate.promise;
        }
        return snapshotProjectFile(library, projectId, file, expected);
      },
    });
    try {
      await index.scanAndWait(project.id);
      const original = research.store.listSources({ projectId: project.id })[0];
      await rename(path.join(folder, 'old.md'), path.join(folder, 'moved.md'));
      const moved = await index.scanAndWait(project.id);
      assert.equal(moved.moved, 1);
      assert.equal(moved.added, 0);
      assert.equal(parses, 1);
      assert.equal(research.store.getSource(original.id).folderPath, 'moved.md');
      await unlink(path.join(folder, 'moved.md'));
      await writeFile(path.join(folder, 'new.md'), 'Different evidence.');
      block = true;
      const first = await index.scan(project.id);
      assert.equal(first.deleted, 0);
      await started.promise;
      assert.equal(research.store.getSource(original.id).id, original.id);
      gate.resolve();
      await index.idle(project.id);
      assert.throws(() => research.store.getSource(original.id), { code: 'SOURCE_NOT_FOUND' });
      const replacement = research.store.listSources({ projectId: project.id })[0];
      await rename(path.join(folder, 'new.md'), path.join(folder, 'unreadable.md'));
      const unreadableTime = new Date(replacement.fileMtimeMs + 2000);
      await utimes(path.join(folder, 'unreadable.md'), unreadableTime, unreadableTime);
      fail = true;
      const failed = await index.scanAndWait(project.id);
      assert.equal(failed.failed, 1);
      assert.equal(failed.deleted, 0);
      assert.equal(research.store.getSource(replacement.id).folderPath, 'new.md');
      assert.equal(index.status(project.id).failed, 1);
    } finally {
      gate.resolve();
      await index.close();
    }
  }));
