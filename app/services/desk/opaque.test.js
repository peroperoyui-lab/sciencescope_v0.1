import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { withCore } from '../../testing.js';
import { createVersions } from '../versions/index.js';
import { createProjectFiles } from '../project-files.js';
import { createDesk } from './index.js';
import { readDocx } from './docx/read.js';
import { WORD } from './docx/xml.js';
import { WORD14 } from './docx/ids.js';

test('a read-only cross-paragraph field can anchor an editable paragraph without changing the field', () =>
  withCore('desk-opaque-anchor', async (core) => {
    const zip = new JSZip();
    const field =
      '<w:p w14:paraId="00000001"><w:r><w:fldChar w:fldCharType="begin"/>' +
      '<w:instrText>TOC</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>目录</w:t></w:r></w:p>' +
      '<w:p w14:paraId="00000002"><w:r><w:t>第一章</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="${WORD}" xmlns:w14="${WORD14}"><w:body>${field}<w:sectPr/></w:body></w:document>`,
    );
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const project = await core.projects.create({ name: '目录后写正文' });
    const versions = createVersions(core);
    const imported = await versions.importFiles({
      projectId: project.id,
      files: [{ name: '目录.docx', base64: bytes.toString('base64') }],
    });
    const desk = createDesk(core, { versions, projectFiles: createProjectFiles(core) });
    try {
      const opened = await desk.openSession({ groupId: imported.group.id });
      assert.ok(opened.blocks.every((block) => block.kind === 'opaque'));
      await assert.rejects(
        desk.updateBlocks(opened.session.id, {
          baseSeq: 0,
          inserted: [{ id: 'inside', after: 'p:00000001', inlines: [{ text: '不能拆开域' }] }],
        }),
        { code: 'DOCX_OPAQUE_BLOCK' },
      );
      await assert.rejects(
        desk.updateBlocks(opened.session.id, {
          baseSeq: 0,
          blocks: { 'p:00000001': [{ text: '不能改域' }] },
        }),
        { code: 'DOCX_OPAQUE_BLOCK' },
      );
      const result = await desk.updateBlocks(opened.session.id, {
        baseSeq: 0,
        inserted: [{ id: 'body', after: 'p:00000002', inlines: [{ text: '新增正文' }] }],
      });
      const state = await desk.getSession(opened.session.id);
      assert.equal(state.blocks.at(-1).kind, 'paragraph');
      await desk.updateBlocks(opened.session.id, {
        baseSeq: 1,
        blocks: { [result.inserted.body]: [{ text: '正文可以继续改' }] },
      });
      const saved = await desk.save(opened.session.id, { to: 'version' });
      const parsed = await readDocx(await readFile(versions.file(saved.version.id)));
      assert.ok(parsed.xml.includes(field));
      assert.equal(parsed.blocks.at(-1).kind, 'paragraph');
      assert.equal(parsed.blocks.at(-1).text, '正文可以继续改');
      await desk.closeSession(opened.session.id);
    } finally {
      await desk.shutdown();
    }
  }));
