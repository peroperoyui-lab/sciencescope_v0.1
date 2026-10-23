import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { withCore, tempDir } from '../../testing.js';
import { createCore } from '../../core/index.js';
import { createResearch } from '../research/index.js';
import { createProjectFiles } from '../project-files.js';
import { createProjectIndex } from './project-index.js';
import { createKnowledgeStore } from './store.js';
import { createVectorStore } from '../research/semantic/vector-store.js';
import { createSemanticDocuments } from '../research/semantic/documents.js';
import { createAppServer } from '../../server/server.js';

test('moves keep source identity; deletion removes projections and cleanup preserves referenced copies', () =>
  withCore('project-removal', async (core, dir) => {
    const folder = path.join(dir, '外部项目');
    await mkdir(folder);
    await writeFile(path.join(folder, 'old.md'), '# Evidence\n\nDistinctive original sentence.');
    const project = await core.projects.create({ name: '项目移动删除', folder });
    const recycled = [];
    const research = createResearch(core, {
      recycle: async (file) => {
        recycled.push(file);
        await rename(file, path.join(dir, 'recycled.md'));
      },
    });
    const files = createProjectFiles(core);
    const index = createProjectIndex({ core, research, files });
    const knowledge = createKnowledgeStore(core);
    const server = createAppServer({
      core,
      token: 'test',
      research,
      projectFiles: files,
      projectIndex: index,
    });
    const base = await server.listen();
    const call = async (method, route) => {
      const response = await fetch(base + route, {
        method,
        headers: { authorization: 'Bearer test' },
      });
      assert.equal(response.status, 200, route);
      return response.json();
    };
    const embedding = {
      embedPassages: async (texts) =>
        texts.map(() => {
          const values = new Float32Array(384);
          values[0] = 1;
          return values;
        }),
    };
    const vectors = await createVectorStore({
      db: core.db,
      embedding,
      modelId: 'fixture',
      modelVersion: '1',
    });
    try {
      await index.scanAndWait(project.id);
      const original = research.store.listSources({ projectId: project.id })[0];
      const chunks = research.store.chunks(original.id);
      const entity = knowledge.createEntity({ name: 'Method', kind: 'method' });
      const derived = knowledge.createEdge({
        fromRef: 'source:' + original.id,
        toRef: 'entity:' + entity.id,
        relation: 'cites',
        layer: 'derived',
        method: 'citation',
      });
      const changes = [];
      const unsubscribe = core.events.subscribe((event) => {
        if (event.type === 'research.changed') changes.push(event.payload.action);
      });
      try {
        await rename(path.join(folder, 'old.md'), path.join(folder, 'moved.md'));
        const moved = await index.scanAndWait(project.id);
        assert.equal(moved.moved, 1);
        assert.equal(moved.added, 0);
        assert.equal(moved.deleted, 0);
        assert.equal(research.store.getSource(original.id).folderPath, 'moved.md');
        assert.deepEqual(research.store.chunks(original.id), chunks);
        assert.equal(knowledge.getEdge(derived.id).status, 'active');
        assert.ok(!changes.includes('source.imported'));
      } finally {
        unsubscribe();
      }

      await writeFile(
        path.join(folder, 'moved.md'),
        '# Evidence\n\nUpdated distinctive sentence with new content.',
      );
      await index.scanAndWait(project.id);
      const updated = research.store.getSource(original.id);
      const oldFile = path.join(core.paths.library, original.originalPath);
      const newFile = path.join(core.paths.library, updated.originalPath);
      const oldBytes = (await readFile(oldFile)).length;
      const usage = await call('GET', '/api/projects/storage/copies');
      assert.equal(usage.projects[0].totalFiles, 2);
      assert.equal(usage.projects[0].unreferencedBytes, oldBytes);
      const cleaned = await call('POST', `/api/projects/${project.id}/copies/cleanup`);
      assert.equal(cleaned.releasedBytes, oldBytes);
      assert.equal(cleaned.removedFiles, 1);
      await assert.rejects(readFile(oldFile), { code: 'ENOENT' });
      assert.match(await readFile(newFile, 'utf8'), /Updated distinctive/);

      await vectors.upsertDocuments(createSemanticDocuments(core).documents());
      await unlink(path.join(folder, 'moved.md'));
      const removed = await index.scanAndWait(project.id);
      assert.equal(removed.deleted, 1);
      assert.equal(research.search('distinctive', { projectId: project.id }).total, 0);
      assert.equal(
        core.db.prepare('SELECT count(*) AS n FROM rb_chunks WHERE source_id=?').get(original.id).n,
        0,
      );
      assert.equal(
        core.db.prepare('SELECT count(*) AS n FROM kb_edges WHERE id=?').get(derived.id).n,
        0,
      );
      assert.equal(
        core.db
          .prepare("SELECT count(*) AS n FROM rb_vec_docs WHERE ref_type IN ('source','chunk')")
          .get().n,
        0,
      );
      assert.ok(await readFile(newFile));
      assert.deepEqual(recycled, []);

      const global = await research.importSource({
        name: 'global.md',
        bytes: Buffer.from('# Global material\n\nSource evidence.'),
        kind: 'paper',
      });
      const ref = 'source:' + global.id;
      const curated = knowledge.createEdge({
        fromRef: ref,
        toRef: 'entity:' + entity.id,
        relation: 'uses',
      });
      const second = knowledge.createEntity({ name: 'Another method', kind: 'method' });
      const extracted = knowledge.createEdge(
        {
          fromRef: 'entity:' + entity.id,
          toRef: 'entity:' + second.id,
          relation: 'related',
          layer: 'extracted',
          producedFrom: ref,
        },
        { origin: 'system' },
      );
      const deleted = await call('DELETE', '/api/research/sources/' + global.id);
      assert.deepEqual(recycled, [path.join(core.paths.library, global.originalPath)]);
      assert.equal(knowledge.getEdge(curated.id).status, 'removed');
      assert.equal(
        core.db.prepare('SELECT count(*) AS n FROM kb_edges WHERE id=?').get(extracted.id).n,
        0,
      );
      assert.equal(knowledge.listEntities().total, 2);
      assert.equal(knowledge.versions.changes(deleted.versionId).length, 1);
      assert.deepEqual(knowledge.versions.restore(deleted.versionId).skipped, []);
      assert.equal(knowledge.getEdge(curated.id).status, 'active');
      assert.ok(
        core.events
          .since(0)
          .some((event) => event.type === 'knowledge.changed' && event.payload.refs.includes(ref)),
      );
    } finally {
      await index.close();
      await vectors.close();
      await server.close();
    }
  }));

test('deleting after restart clears stored vectors while semantic search is disabled', async () => {
  const { dir, cleanup } = await tempDir('source-delete-restart');
  let core;
  try {
    core = await createCore({ dataRoot: dir });
    const research = createResearch(core);
    const source = research.store.createSource({ title: 'Stored vector', kind: 'paper' });
    const vector = new Float32Array(384);
    vector[0] = 1;
    const store = await createVectorStore({
      db: core.db,
      embedding: { embedPassages: async (texts) => texts.map(() => vector) },
      modelId: 'fixture',
      modelVersion: '1',
    });
    await store.upsertDocuments(createSemanticDocuments(core).documents());
    await store.close();
    core.close();
    core = await createCore({ dataRoot: dir });
    assert.equal(
      (await core.workspace.read({ resource: 'settings', key: 'app' })).value.semantic.enabled,
      false,
    );
    assert.equal((await createResearch(core).deleteSource(source.id)).vectors, 1);
    assert.equal(core.db.prepare('SELECT count(*) AS n FROM rb_vec').get().n, 0);
    assert.equal(core.db.prepare('SELECT count(*) AS n FROM rb_vec_docs').get().n, 0);
  } finally {
    core?.close();
    await cleanup();
  }
});
