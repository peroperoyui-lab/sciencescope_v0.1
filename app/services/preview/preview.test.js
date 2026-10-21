import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { createApp } from '../../app.js';
import { tempDir } from '../../testing.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createPreview } from './index.js';

test('original previews preserve full text and DOCX body, project files and page citation targets', async () => {
  const { dir, cleanup } = await tempDir('preview');
  const app = await createApp({
    dataRoot: dir,
    token: 'test',
    runtime: createScriptedRuntime({ script: async function* () {} }),
  });
  try {
    const project = await app.core.projects.create({ name: '中文原件' });
    const preview = createPreview(app.core, app.research);
    const text = 'long text\n'.repeat(10000);
    const source = await app.research.importSource({
      name: '全文.txt',
      bytes: Buffer.from(text),
      projectId: project.id,
    });
    assert.equal((await preview.document({ id: source.id })).text, text);
    const note = app.research.store.createSource({
      projectId: project.id,
      title: '无原件',
      kind: 'note',
    });
    app.research.store.addChunks(note.id, [{ text: '第一段' }, { text: '第二段' }], {
      contentStatus: 'parsed',
    });
    assert.equal((await preview.document({ id: note.id })).text, '第一段\n\n第二段');
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      'word/document.xml',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>正文证据</w:t></w:r></w:p></w:body></w:document>',
    );
    const docx = await app.research.importSource({
      name: '原件.docx',
      bytes: await zip.generateAsync({ type: 'nodebuffer' }),
      projectId: project.id,
    });
    assert.match((await preview.document({ id: docx.id })).html, /正文证据/u);
    await writeFile(
      path.join(app.core.workspace.locate.projectDir(project.id), '代码.py'),
      'print(137)',
    );
    assert.equal(
      (await preview.document({ kind: 'project', projectId: project.id, path: '代码.py' })).text,
      'print(137)',
    );
    const meeting = app.core.meetings.create({ projectId: project.id });
    const message = app.core.messages.post({
      meetingId: meeting.id,
      authorId: 'agent_main',
      text: '[S1 p.2] and [S1 appendix X]',
    });
    const labels = preview.citations(message.id);
    assert.equal(labels[0].targets[0].page, 2);
    assert.equal(labels[1].parseStatus, 'unrecognized');
    assert.equal(labels[1].raw, '[S1 appendix X]');
    const url = await app.listen();
    const response = await fetch(`${url}/api/preview/content?id=${source.id}`, {
      headers: { authorization: 'Bearer test' },
    });
    assert.equal(await response.text(), text);
  } finally {
    await app.close();
    await cleanup();
  }
});
