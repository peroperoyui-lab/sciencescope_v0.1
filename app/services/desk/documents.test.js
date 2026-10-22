import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { withCore } from '../../testing.js';
import { createVersions } from '../versions/index.js';
import { createProjectFiles } from '../project-files.js';
import { createDesk } from './index.js';
import { createAppServer } from '../../server/server.js';
import { WORD } from './docx/xml.js';

test('desk listing includes registered and unregistered manuscripts without importing application folders', () =>
  withCore('desk-list', async (core, dir) => {
    const versions = createVersions(core);
    const projectFiles = createProjectFiles(core);
    const desk = createDesk(core, { versions, projectFiles });
    const own = await core.projects.create({ name: '自带文件夹' });
    const external = path.join(dir, '外部文件夹');
    await mkdir(external);
    const bound = await core.projects.create({ name: '外部', folder: external });
    for (const project of [own, bound]) {
      for (const name of [
        '正文.tex',
        '未登记.markdown',
        'notes/笔记.md',
        'versions/稿件.docx',
        'workbench/计划.md',
        'minutes/纪要.md',
        'desk/临时.tex',
        '.hidden/忽略.md',
        'node_modules/忽略.md',
        'refs/参考.pdf',
      ]) {
        const target = projectFiles.locate(project.id, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, '# 内容\n');
      }
    }
    try {
      const group = await desk.registerDocument({ projectId: own.id, path: '正文.tex' });
      const stored = await versions.importFiles({
        projectId: own.id,
        files: [{ name: '只在应用.md', base64: Buffer.from('稿件').toString('base64') }],
      });
      const before = core.db.prepare('SELECT count(*) AS count FROM version_groups').get().count;
      const listed = await desk.listDocuments(own.id);
      assert.deepEqual(
        listed.files.map((file) => file.path).sort(),
        ['refs/参考.pdf', '未登记.markdown', '正文.tex'].sort(),
      );
      assert.equal(listed.files.find((file) => file.path === '正文.tex').group.id, group.id);
      assert.equal(listed.files.find((file) => file.path === '正文.tex').group.latest.number, 1);
      assert.equal(listed.files.find((file) => file.path === '未登记.markdown').group, null);
      assert.equal(listed.groups[0].id, stored.group.id);
      assert.equal(listed.groups[0].latest.number, 1);
      const outside = await desk.listDocuments(bound.id);
      assert.equal(outside.files.length, 8);
      assert.ok(outside.files.some((file) => file.path === 'notes/笔记.md'));
      assert.equal(
        core.db.prepare('SELECT count(*) AS count FROM version_groups').get().count,
        before,
      );
      assert.equal(core.db.prepare('SELECT count(*) AS count FROM desk_sessions').get().count, 0);
      const limited = createDesk(core, { versions, projectFiles, documentLimit: 2 });
      const first = await limited.listDocuments(bound.id);
      assert.equal(first.files.length, 2);
      assert.equal(first.truncated, true);
      // Exactly reaching the limit is not truncation.
      const exact = createDesk(core, { versions, projectFiles, documentLimit: 8 });
      assert.equal((await exact.listDocuments(bound.id)).truncated, false);
    } finally {
      await desk.shutdown();
    }
  }));

test('desk media returns the first embedded image bytes and MIME and exposes availability on image atoms', () =>
  withCore('desk-media', async (core, dir) => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kX9sAAAAASUVORK5CYII=',
      'base64',
    );
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="${WORD}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:drawing><a:blip r:embed="first"/><a:blip r:embed="second"/></w:drawing></w:r></w:p><w:p><w:r><w:pict><a:blip r:embed="vector"/></w:pict></w:r></w:p></w:body></w:document>`,
    );
    zip.file(
      'word/_rels/document.xml.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        ['first', 'second', 'vector']
          .map(
            (id) =>
              `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${id}.${id === 'vector' ? 'emf' : 'png'}"/>`,
          )
          .join('') +
        '</Relationships>',
    );
    zip.file(
      '[Content_Types].xml',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="emf" ContentType="image/emf"/></Types>',
    );
    zip.file('word/media/first.png', png);
    zip.file('word/media/second.png', Buffer.from('second'));
    zip.file('word/media/vector.emf', Buffer.from('EMF fixture bytes'));
    const documentXml = await zip.file('word/document.xml').async('string');
    zip.file(
      'word/document.xml',
      documentXml.replace(
        '</w:body>',
        '<w:p><w:r><w:drawing><a:blip r:embed="missing"/><a:blip r:embed="second"/></w:drawing></w:r></w:p></w:body>',
      ),
    );
    const folder = path.join(dir, '图片稿');
    await mkdir(folder);
    await writeFile(
      path.join(folder, '图片.docx'),
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    const project = await core.projects.create({ name: '图片', folder });
    const versions = createVersions(core);
    const desk = createDesk(core, { versions, projectFiles: createProjectFiles(core) });
    const server = createAppServer({ core, versions, desk, token: 'media-test' });
    const url = await server.listen();
    const headers = { authorization: 'Bearer media-test' };
    try {
      const group = await desk.registerDocument({ projectId: project.id, path: '图片.docx' });
      const opened = await desk.openSession({ groupId: group.id });
      const images = opened.blocks
        .flatMap((block) => block.inlines)
        .filter((inline) => inline.atom === 'image');
      assert.ok(images.slice(0, 2).every((inline) => inline.media === true));
      assert.equal(images[2].media, undefined);
      await assert.rejects(desk.media(opened.session.id, images[2].ref), {
        code: 'DESK_MEDIA_NOT_FOUND',
      });
      const response = await fetch(
        `${url}/api/desk/sessions/${opened.session.id}/media/${images[0].ref}`,
        { headers },
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.match(response.headers.get('content-security-policy'), /sandbox/u);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
      assert.equal((await desk.media(opened.session.id, images[1].ref)).mimeType, 'image/emf');
      const missing = await fetch(`${url}/api/desk/sessions/${opened.session.id}/media/99999`, {
        headers,
      });
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).code, 'DESK_MEDIA_NOT_FOUND');
      await assert.rejects(desk.updateText(opened.session.id, { baseSeq: 0, text: '' }), {
        code: 'DESK_FORMAT',
      });
      const listing = await fetch(`${url}/api/desk/documents?projectId=${project.id}`, { headers });
      assert.equal((await listing.json()).files[0].group.id, group.id);
    } finally {
      await server.close();
      await desk.shutdown();
    }
  }));
