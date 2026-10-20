import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { tempDir } from '../../../testing.js';
import { readDocx } from './read.js';
import { writeDocx } from './write.js';
import { indexXml, WORD } from './xml.js';

const fonts = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:b/></w:rPr>';
const run = (text) => `<w:r>${fonts}<w:t>${text}</w:t></w:r>`;
const field =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ADDIN ZOTERO_ITEM CSL_CITATION {"citationID":"test","citationItems":[{"id":7}]} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  run('(张三，2024)') +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

async function fixture(existingComments) {
  const zip = new JSZip();
  const markers = existingComments
    ? '<w:commentRangeStart w:id="8"/>' +
      run('旧批注') +
      '<w:commentRangeEnd w:id="8"/><w:r><w:commentReference w:id="8"/></w:r>'
    : '';
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="${WORD}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
<w:p w14:paraId="00112233"><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${run('中文结果😀。')}${field}<m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath><w:ins w:id="2" w:author="Original">${run('新增')}</w:ins><w:del w:id="3" w:author="Original"><w:r><w:delText>删除</w:delText></w:r></w:del>${markers}<w:bookmarkStart w:id="9" w:name="bookmark"/>${run('书签')}<w:bookmarkEnd w:id="9"/><w:r><w:footnoteReference w:id="1"/></w:r><w:fldSimple w:instr=" SEQ Figure ">${run('1')}</w:fldSimple><w:r><w:pict><v:shape><v:imagedata r:id="rId1"/></v:shape></w:pict></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p>${run('表格内容')}</w:p></w:tc></w:tr></w:tbl>
<w:sdt><w:sdtPr/><w:sdtContent><w:p>${run('内容控件')}</w:p></w:sdtContent></w:sdt>
<w:p>${run('正文不变')}<w:r><w:pict><v:shape><v:textbox><w:txbxContent><w:p>${run('文本框不作独立块')}</w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>
<w:sectPr/></w:body></w:document>`,
  );
  zip.file('word/styles.xml', '<styles>untouched bytes 中文</styles>');
  zip.file('word/media/image.png', Buffer.from([0, 1, 2, 3, 255]));
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      (existingComments
        ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
        : '') +
      '</Types>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="image" Target="media/image.png"/>' +
      (existingComments
        ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>'
        : '') +
      '</Relationships>',
  );
  if (existingComments)
    zip.file(
      'word/comments.xml',
      `<?xml version="1.0"?><w:comments xmlns:w="${WORD}"><w:comment w:id="8" w:author="Old"><w:p>${run('旧批注原文')}</w:p></w:comment></w:comments>`,
    );
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('edit Chinese text and append a comment while preserving runs, atomic XML, unchanged paragraphs and parts', async () => {
  const temporary = await tempDir('desk-docx');
  try {
    const originalFile = path.join(temporary.dir, 'original.docx');
    await writeFile(originalFile, await fixture(true));
    const bytes = await readFile(originalFile);
    const before = await readDocx(bytes);
    assert.equal(before.blocks.length, 4);
    assert.equal(before.blocks[1].kind, 'table-cell');
    assert.equal(before.blocks[2].text, '内容控件');
    const block = before.blocks[0];
    assert.equal(block.id, 'p:00112233');
    for (const type of [
      'math',
      'field',
      'image',
      'ins',
      'del',
      'bookmark',
      'comment-start',
      'comment-end',
      'footnote',
      'textbox',
    ])
      assert.ok(
        before.atoms.some((atom) => atom.atom === type),
        type,
      );
    for (const item of before.runs) assert.match(before.raw(item), /^<w:r[ >]/u);
    const inlines = block.inlines.map((inline) =>
      inline.text === '中文结果😀。' ? { ...inline, text: '中文结果已核实😀。' } : inline,
    );
    const output = await writeDocx(
      bytes,
      { [block.id]: inlines },
      {
        comments: [
          { blockId: block.id, from: 0, to: 1, text: '核对 & 说明', author: 'ScienceScope · 专家' },
        ],
      },
    );
    await writeFile(path.join(temporary.dir, 'edited.docx'), output);
    const after = await readDocx(output);
    assert.equal(after.comments.length, before.comments.length + 1);
    assert.equal(after.comments[1].author, 'ScienceScope · 专家');
    assert.ok(
      after.commentsXml.includes(
        before.commentsXml.slice(before.comments[0].start, before.comments[0].end),
      ),
    );
    assert.equal(before.xml.slice(0, block.start), after.xml.slice(0, after.blocks[0].start));
    assert.equal(before.xml.slice(block.end), after.xml.slice(after.blocks[0].end));
    assert.ok(after.xml.includes(field));
    for (const inline of block.inlines.filter((item) => item.atom))
      assert.ok(after.xml.includes(before.raw(before.atoms[inline.ref])));
    const newRun = after.runs.find((item) => after.raw(item).includes('中文结果已核实'));
    assert.equal(after.raw(newRun.rPr), fonts);
    assert.match(after.raw(newRun), /<w:t xml:space="preserve">/u);
    for (const [name, entry] of Object.entries(before.zip.files)) {
      if (entry.dir || ['word/document.xml', 'word/comments.xml'].includes(name)) continue;
      assert.deepEqual(
        await after.zip.file(name).async('nodebuffer'),
        await entry.async('nodebuffer'),
        name,
      );
    }
    assert.deepEqual(await writeDocx(bytes, {}), bytes);
  } finally {
    await temporary.cleanup();
  }
});

test('first comment registers package parts once and text inserted at the paragraph start inherits following fonts', async () => {
  const bytes = await fixture(false);
  const before = await readDocx(bytes);
  const block = before.blocks[1];
  const changed = [{ text: '段首新增。' }, ...block.inlines];
  const output = await writeDocx(
    bytes,
    { [block.id]: changed },
    {
      comments: [{ blockId: block.id, from: 0, to: 1, text: '<新增批注>', author: 'User' }],
    },
  );
  const after = await readDocx(output);
  assert.equal(after.comments[0].id, '0');
  assert.equal(
    after.raw(after.runs.find((item) => after.raw(item).includes('段首新增')).rPr),
    fonts,
  );
  const types = await after.zip.file('[Content_Types].xml').async('string');
  const rels = await after.zip.file('word/_rels/document.xml.rels').async('string');
  assert.equal(
    indexXml(types).filter((span) => span.attrs.PartName === '/word/comments.xml').length,
    1,
  );
  assert.equal(indexXml(rels).filter((span) => span.attrs.Target === 'comments.xml').length, 1);
  assert.ok(rels.includes('Id="rId2"'));
  for (const suffix of ['RangeStart', 'RangeEnd', 'Reference'])
    assert.ok(
      after.spans.some((span) => span.tag === 'w:comment' + suffix && span.attrs['w:id'] === '0'),
    );
});
