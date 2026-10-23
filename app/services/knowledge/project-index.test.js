import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, readdir, rename, writeFile, utimes } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { withCore } from '../../testing.js';
import { createResearchPdf } from '../research/testing.js';
import { createResearch } from '../research/index.js';
import { createSemanticDocuments } from '../research/semantic/documents.js';
import { createProjectFiles } from '../project-files.js';
import { createProjectIndex } from './project-index.js';
import { createPreview } from '../preview/index.js';
import { createViewImage } from '../builtin-tools/view-image.js';
import { createAppServer } from '../../server/server.js';

test('project files are indexed, changed once and readable after their folder moves', () =>
  withCore('project-index', async (core, dir) => {
    const folder = path.join(dir, '用户项目');
    await mkdir(path.join(folder, 'papers'), { recursive: true });
    await mkdir(path.join(folder, 'data/raw'), { recursive: true });
    await mkdir(path.join(folder, '.hidden'));
    await writeFile(path.join(folder, '.hidden/ignore.txt'), 'not indexed');
    const pdf = await createResearchPdf();
    await writeFile(path.join(folder, 'papers/研究.pdf'), pdf);
    await writeFile(path.join(folder, 'data/raw/panel_2020.dta'), 'binary fixture');
    const project = await core.projects.create({ name: '文件索引', folder });
    const research = createResearch(core);
    const files = createProjectFiles(core, {
      requestIndex: (id) => index.request(id),
      indexEntry: (id, relative) => index.entry(id, relative),
    });
    const index = createProjectIndex({ core, research, files });
    const server = createAppServer({
      core,
      token: 'test',
      research,
      projectFiles: files,
      projectIndex: index,
    });
    const url = await server.listen();
    const changes = [];
    const unsubscribe = core.events.subscribe((event) => {
      if (event.type === 'research.changed') changes.push(event.payload);
    });
    const call = async (method, route, body) => {
      const response = await fetch(url + route, {
        method,
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(response.status, 200, route);
      return response.json();
    };
    try {
      assert.deepEqual(await call('POST', `/api/projects/${project.id}/index`), {
        added: 2,
        updated: 0,
        unchanged: 0,
        nameOnly: 0,
        failed: 0,
        moved: 0,
        deleted: 0,
        queued: 2,
      });
      await index.idle(project.id);
      assert.deepEqual(await call('GET', `/api/projects/${project.id}/index`), {
        phase: 'idle',
        total: 2,
        done: 2,
        queued: 0,
        failed: 0,
      });
      const sources = research.store.listSources({ projectId: project.id });
      const paper = sources.find((source) => source.name === '研究.pdf');
      const data = sources.find((source) => source.name === 'panel_2020.dta');
      assert.equal(paper.contentStatus, 'parsed');
      assert.equal(paper.kind, 'paper', 'a PDF with a DOI counts as a paper');
      assert.equal(data.contentStatus, 'name-only');
      assert.equal(data.kind, 'file');
      assert.match(data.parseError, /Unsupported/);
      assert.ok(
        research
          .search('Left column searchable', { projectId: project.id })
          .hits.some((hit) => hit.sourceId === paper.id),
      );
      assert.ok(
        research
          .search('panel 2020', { projectId: project.id })
          .hits.some((hit) => hit.folderPath === 'data/raw/panel_2020.dta'),
      );
      const document = createSemanticDocuments(core)
        .documents()
        .find((item) => item.ref.id === data.id);
      assert.match(document.text, /data\/raw\/panel_2020.dta/);
      assert.equal(await research.sourcePath(paper.id), path.join(folder, 'papers/研究.pdf'));
      assert.deepEqual(
        await readFile(path.join(core.paths.library, paper.originalPath)),
        Buffer.from(pdf),
      );
      const listing = await call('GET', `/api/projects/${project.id}/files?path=papers`);
      assert.deepEqual(listing.entries[0].index, {
        status: 'parsed',
        sourceId: paper.id,
        error: null,
      });
      // A timestamp-only edit does not reparse; simultaneous requests coalesce.
      changes.length = 0;
      await utimes(path.join(folder, 'papers/研究.pdf'), new Date(), new Date(Date.now() + 2000));
      await Promise.all([
        index.scanAndWait(project.id),
        index.scanAndWait(project.id),
        index.scanAndWait(project.id),
      ]);
      assert.equal(changes.filter((event) => event.action === 'source.imported').length, 0);
      const changed = await PDFDocument.load(pdf);
      changed.getPage(0).drawText('Updated evidence sentence.', { x: 48, y: 500 });
      await writeFile(path.join(folder, 'papers/研究.pdf'), await changed.save());
      changes.length = 0;
      const result = await call('POST', `/api/projects/${project.id}/index`);
      assert.equal(result.updated, 1);
      assert.equal(result.unchanged, 1);
      assert.equal(result.queued, 1);
      await index.idle(project.id);
      assert.deepEqual(
        changes
          .filter((event) => event.action === 'source.imported')
          .map((event) => event.sourceId),
        [paper.id],
      );
      const latest = research.store.getSource(paper.id);
      assert.notEqual(latest.originalPath, paper.originalPath);
      assert.ok(await readFile(path.join(core.paths.library, paper.originalPath)));
      assert.ok(research.search('Updated evidence', { projectId: project.id }).hits.length);
      // App writes schedule the same scanner, and a broken PDF remains name-searchable.
      await call('POST', `/api/projects/${project.id}/files`, {
        op: 'add',
        path: 'broken.pdf',
        base64: Buffer.from('broken').toString('base64'),
      });
      await index.scanAndWait(project.id);
      const broken = research.store
        .listSources({ projectId: project.id })
        .find((source) => source.name === 'broken.pdf');
      assert.equal(broken.contentStatus, 'name-only');
      assert.ok(broken.parseError);
      await writeFile(path.join(folder, 'same.dta'), 'binary fixture');
      await call('GET', `/api/projects/${project.id}/files`);
      await index.scanAndWait(project.id);
      const same = research.store
        .listSources({ projectId: project.id })
        .find((source) => source.name === 'same.dta');
      assert.equal(same.originalPath, data.originalPath);
      const originalEntries = (await readdir(folder, { recursive: true })).sort();
      assert.deepEqual(
        originalEntries,
        [
          '.hidden',
          '.hidden\\ignore.txt',
          'broken.pdf',
          'data',
          'data\\raw',
          'data\\raw\\panel_2020.dta',
          'papers',
          'papers\\研究.pdf',
          'same.dta',
        ]
          .map((name) => name.replaceAll('\\', path.sep))
          .sort(),
      );
      const moved = path.join(dir, '项目移走');
      await rename(folder, moved);
      await assert.rejects(index.scanAndWait(project.id), { code: 'ENOENT' });
      assert.equal(research.store.getSource(paper.id).id, paper.id);
      assert.equal(
        await research.sourcePath(paper.id),
        path.join(core.paths.library, latest.originalPath),
      );
      assert.ok(
        research
          .read({ id: paper.id })
          .chunks.some((chunk) => chunk.text.includes('Updated evidence')),
      );
      const preview = await createPreview(core, research).content({ kind: 'source', id: paper.id });
      assert.equal(preview.name, '研究.pdf');
      assert.ok(preview.bytes.length);
      const meeting = await core.meetings.create({ projectId: project.id, title: '查看副本' });
      const image = await createViewImage(core, research)(
        { sourceId: paper.id, page: 1 },
        { meetingId: meeting.id, participantId: 'agent_main', turnId: 'fixture', callId: 'image' },
      );
      assert.equal(image.images[0].mimeType, 'image/png');
      assert.equal(image.preview.page, 1);
    } finally {
      unsubscribe();
      await index.close();
      await server.close();
    }
  }));

test("a project's built-in folder leaves ScienceScope's own workspace out of the index", () =>
  withCore('project-index-own', async (core) => {
    const project = await core.projects.create({ name: '自带文件夹' });
    const research = createResearch(core);
    const files = createProjectFiles(core);
    const index = createProjectIndex({ core, research, files });
    const root = files.rootOf(project.id);
    try {
      for (const folder of ['workbench', 'notes', 'minutes', 'versions/g1', 'papers/notes'])
        await mkdir(path.join(root, folder), { recursive: true });
      await writeFile(path.join(root, 'workbench/plans.md'), '# 计划');
      await writeFile(path.join(root, 'notes/想法.md'), '笔记');
      await writeFile(path.join(root, 'minutes/m1.md'), '纪要');
      await writeFile(path.join(root, 'versions/g1/v1.md'), '稿子');
      await writeFile(path.join(root, 'papers/notes/读书.md'), '用户放进来的');
      await index.scanAndWait(project.id);
      assert.deepEqual(
        research.store.listSources({ projectId: project.id }).map((source) => source.folderPath),
        ['papers/notes/读书.md'],
      );
    } finally {
      await index.close();
    }
  }));
