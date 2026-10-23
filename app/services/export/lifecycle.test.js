import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, open, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createFullExport } from '../export.js';
import { createExportWriter } from './writer.js';
import { withExportFixture, exportEvent } from './testing.js';

test('invalid, missing and realpath-inside-data targets fail before a job starts', () =>
  withExportFixture(async ({ core, target, dir }) => {
    const service = createFullExport(core);
    const inside = path.join(core.paths.root, 'inside');
    const link = path.join(dir, 'alias-to-data');
    await mkdir(inside);
    await symlink(inside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const notFolder = path.join(dir, 'not-folder.txt');
    await writeFile(notFolder, 'fixture');
    try {
      for (const invalid of [
        core.paths.root,
        inside,
        link,
        path.join(dir, 'missing'),
        notFolder,
        '',
      ])
        await assert.rejects(service.start({ target: invalid }), {
          code: 'EXPORT_TARGET_INVALID',
          status: 400,
        });
      assert.deepEqual(await readdir(target), []);
      assert.throws(() => service.get('missing'), { status: 404 });
    } finally {
      await service.close();
    }
  }));

test('cancel and host shutdown keep incomplete folders, coalesce starts and do not resume after recreation', () =>
  withExportFixture(async ({ core, target }) => {
    const service = createFullExport(core);
    const finished = exportEvent(core, 'export.finished');
    try {
      const [first, duplicate] = await Promise.all([
        service.start({ target }),
        service.start({ target }),
      ]);
      assert.deepEqual(first, duplicate);
      service.cancel(first.jobId);
      const result = await finished.promise;
      assert.equal(result.cancelled, true);
      assert.match(result.folder, /（未完成）$/u);
      assert.equal(service.get(first.jobId).phase, 'cancelled');
      assert.ok((await stat(result.folder)).isDirectory());
      const nextFinished = exportEvent(core, 'export.finished');
      const next = await service.start({ target });
      await service.close();
      assert.equal((await nextFinished.promise).cancelled, true);
      nextFinished.cancel();
      assert.match(service.get(next.jobId).folder, / \(2\)（未完成）$/u);
      await assert.rejects(service.start({ target }), { code: 'EXPORT_CLOSED' });
      const recreated = createFullExport(core);
      try {
        assert.throws(() => recreated.get(first.jobId), { status: 404 });
        assert.equal((await readdir(target)).length, 2);
      } finally {
        await recreated.close();
      }
    } finally {
      finished.cancel();
      await service.close();
    }
  }));

test('file copying streams bytes, cancels mid-file and leaves progress visibly incomplete', () =>
  withExportFixture(async ({ core, target }) => {
    const source = path.join(core.paths.root, 'large-research.bin');
    const file = await open(source, 'w');
    await file.truncate(32 * 1024 * 1024);
    await file.close();
    const controller = new AbortController();
    const writer = await createExportWriter({
      root: target,
      paths: core.paths,
      signal: controller.signal,
      cancelled: () => controller.signal.aborted,
      notify(value) {
        if (value.bytes > 0) controller.abort();
      },
    });
    await writer.copy(source, 'copy.bin');
    await assert.rejects(writer.run(0), { name: 'AbortError' });
    const partial = await stat(path.join(target, 'copy.bin'));
    assert.ok(partial.size < (await stat(source)).size);
  }));

test('progress events are limited to one per second including terminal status; finished is immediate', () =>
  withExportFixture(async ({ core, target }) => {
    const service = createFullExport(core);
    const progress = [];
    const unsubscribe = core.events.subscribe((event) => {
      if (event.type === 'export.progress')
        progress.push({ time: performance.now(), ...event.payload });
    });
    const finished = exportEvent(core, 'export.finished');
    const terminal = exportEvent(
      core,
      'export.progress',
      (event) => event.payload.phase === 'finished',
    );
    try {
      const job = await service.start({ target });
      const result = await finished.promise;
      assert.equal(result.error, undefined, result.error);
      await terminal.promise;
      assert.equal(service.get(job.jobId).phase, 'finished');
      assert.ok(progress.length >= 2);
      for (let i = 1; i < progress.length; i++)
        assert.ok(progress[i].time - progress[i - 1].time >= 990);
      assert.equal(progress.at(-1).phase, 'finished');
      assert.ok(
        (await readFile(path.join(service.get(job.jobId).folder, 'README.md'), 'utf8')).length,
      );
    } finally {
      unsubscribe();
      finished.cancel();
      terminal.cancel();
      await service.close();
    }
  }));

test('a failed export stays incomplete and a later job can finish', () =>
  withExportFixture(async ({ core, target }) => {
    const project = await core.projects.create({ name: 'Unreadable map fixture' });
    const workbench = path.join(core.paths.projects, project.dirName, 'workbench');
    await mkdir(workbench, { recursive: true });
    const map = path.join(workbench, 'map.json');
    await writeFile(map, '{broken json');
    const service = createFullExport(core);
    const failed = exportEvent(core, 'export.finished');
    try {
      const first = await service.start({ target });
      const event = await failed.promise;
      assert.equal(event.cancelled, false);
      assert.ok(event.error);
      assert.equal(service.get(first.jobId).phase, 'failed');
      assert.match(service.get(first.jobId).folder, /（未完成）$/u);
      await writeFile(map, JSON.stringify({ nodes: [], edges: [] }));
      const completed = exportEvent(core, 'export.finished');
      try {
        const next = await service.start({ target });
        const result = await completed.promise;
        assert.equal(result.error, undefined, result.error);
        assert.equal(service.get(next.jobId).phase, 'finished');
      } finally {
        completed.cancel();
      }
    } finally {
      failed.cancel();
      await service.close();
    }
  }));
