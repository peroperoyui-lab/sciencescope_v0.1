import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, rename, utimes, writeFile } from 'node:fs/promises';
import { withCore } from '../../testing.js';
import { createResearch } from '../research/index.js';
import { createKnowledgeStore } from './store.js';
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

for (const restoreQueued of [false, true]) {
  test(
    `hash move retains edited identities and references (old queued: ${restoreQueued})`,
    { timeout: 30_000 },
    () =>
      withCore('project-index-edited-move', async (core, dir) => {
        const folder = path.join(dir, 'project');
        await mkdir(folder);
        await writeFile(path.join(folder, 'old.md'), '# Evidence\n\nKeep both identities.');
        const project = await core.projects.create({ name: 'Edited move', folder });
        const research = createResearch(core);
        const knowledge = createKnowledgeStore(core);
        const started = deferred();
        const gate = deferred();
        let block = false;
        const index = createProjectIndex({
          core,
          research,
          files: createProjectFiles(core),
          async copy(...args) {
            if (block) {
              started.resolve();
              await gate.promise;
            }
            return snapshotProjectFile(...args);
          },
        });
        try {
          await index.scanAndWait(project.id);
          const old = research.store.listSources({ projectId: project.id })[0];
          const oldChunks = research.store.chunks(old.id).map((chunk) => chunk.id);
          const actor = { actorId: 'person_user', origin: 'user' };
          knowledge.label(`source:${old.id}`, 'old label', true, actor);
          if (restoreQueued) research.store.queueProjectSources(project.id);
          const target = path.join(folder, 'new.md');
          await rename(path.join(folder, 'old.md'), target);
          // Different mtime deliberately bypasses the first-stage unique pair.
          const changed = new Date(old.fileMtimeMs + 2000);
          await utimes(target, changed, changed);
          block = true;
          await index.scan(project.id);
          await started.promise;
          const queued = research.store
            .listSources({ projectId: project.id })
            .find((source) => source.folderPath === 'new.md');
          research.store.updateSource(
            queued.id,
            {
              title: 'User title',
              metadata: { userNote: 'Preserve this' },
            },
            actor,
          );
          knowledge.label(`source:${queued.id}`, 'new label', true, actor);
          knowledge.membership(project.id, `source:${queued.id}`, true, actor);
          gate.resolve();
          await index.idle(project.id);
          const retained = research.store.getSource(old.id);
          const current = research.store.getSource(queued.id);
          assert.equal(research.store.listSources({ projectId: project.id }).length, 2);
          assert.equal(retained.folderPath, null);
          assert.equal(retained.metadata.originalFileMissing, true);
          assert.equal(retained.metadata.missingFolderPath, 'old.md');
          assert.equal(retained.contentStatus, 'parsed');
          assert.equal(current.contentStatus, 'parsed');
          assert.equal(current.title, 'User title');
          assert.equal(current.metadata.userNote, 'Preserve this');
          assert.equal(current.folderPath, 'new.md');
          assert.equal(current.originalPath, retained.originalPath);
          assert.deepEqual(
            knowledge.labels(`source:${old.id}`).map((row) => row.label),
            ['old label'],
          );
          assert.deepEqual(
            knowledge.labels(`source:${queued.id}`).map((row) => row.label),
            ['new label'],
          );
          assert.equal(
            core.db
              .prepare('SELECT count(*) AS n FROM kb_memberships WHERE ref=?')
              .get(`source:${queued.id}`).n,
            1,
          );
          assert.deepEqual(
            research.store.chunks(old.id).map((chunk) => chunk.id),
            oldChunks,
          );
          assert.ok(research.store.chunks(old.id).length > 0);
          assert.equal(index.status(project.id).queued, 0);
          assert.equal(index.status(project.id).failed, 0);
          await index.scanAndWait(project.id);
          assert.equal(research.store.getSource(old.id).folderPath, null);
          assert.equal(research.store.getSource(queued.id).title, 'User title');
        } finally {
          gate.resolve();
          await index.close();
        }
      }),
  );
}
