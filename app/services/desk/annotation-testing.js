import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { createDesk } from './index.js';
import { createVersions } from '../versions/index.js';
import { createProjectFiles } from '../project-files.js';
import { replaceInlines } from './manuscript-text.js';
import { WORD } from './docx/xml.js';
import { WORD14 } from './docx/ids.js';

/**
 * @param {import('../../core/index.js').Core} core
 * @param {string} dir
 * @param {string} format
 * @returns {Promise<any>}
 */
export async function setupAnnotations(core, dir, format) {
  const folder = path.join(dir, '稿件');
  await mkdir(folder);
  let bytes;
  if (format === 'docx') {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      '_rels/.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="${WORD}" xmlns:w14="${WORD14}"><w:body><w:p w14:paraId="00000001"><w:r><w:t>前文甲乙丙丁后文。</w:t></w:r></w:p><w:p w14:paraId="00000002"><w:r><w:t>第二段保留原样。</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    );
    bytes = await zip.generateAsync({ type: 'nodebuffer' });
  } else bytes = Buffer.from('前文甲乙丙丁后文。\n\n第二段保留原样。\n');
  const file = path.join(folder, '论文.' + format);
  await writeFile(file, bytes);
  const project = await core.projects.create({ name: '标注', folder });
  const versions = createVersions(core);
  const desk = createDesk(core, { versions, projectFiles: createProjectFiles(core) });
  const group = await desk.registerDocument({ projectId: project.id, path: path.basename(file) });
  const opened = await desk.openSession({ groupId: group.id });
  const id = opened.session.id;
  const actor = { actorId: 'person_user' };
  const sources = [{ schema: 1, kind: 'project-file', projectId: project.id, path: '数据.csv' }];
  async function replace(find, text) {
    const current = await desk.getSession(id);
    return format === 'docx'
      ? desk.updateBlocks(
          id,
          {
            baseSeq: current.session.seq,
            blocks: { [current.blocks[0].id]: replaceInlines(current.blocks[0], find, text) },
          },
          actor,
        )
      : desk.updateText(
          id,
          { baseSeq: current.session.seq, text: current.text.replace(find, text) },
          actor,
        );
  }
  return {
    folder,
    file,
    project,
    group,
    desk,
    versions,
    opened,
    id,
    sources,
    replace,
    close: async () => {
      await desk.shutdown();
      await versions.close();
    },
  };
}
