import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { readDocx } from './read.js';
import { WORD } from './xml.js';

const style = (id, name, extra = '') =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${extra}</w:style>`;
const para = (id, text) =>
  `<w:p><w:pPr><w:pStyle w:val="${id}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

test('headings in a Chinese Word file are found by their style, not only by its id', async () => {
  const zip = new JSZip();
  zip.file(
    'word/styles.xml',
    `<w:styles xmlns:w="${WORD}">${[
      style('a', 'Normal'),
      // Chinese Word: Heading 1 and 2 have the ids "1" and "2".
      style('1', 'heading 1', '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>'),
      style('2', 'heading 2'),
      // A custom style based on Heading 2; one that turns the level off.
      style('a5', '章节小标题', '<w:basedOn w:val="2"/>'),
      style('a6', '正文无级别', '<w:basedOn w:val="1"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr>'),
    ].join('')}</w:styles>`,
  );
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${WORD}"><w:body>${[
      para('1', '第三章　研究设计'),
      para('2', '3.1　研究方法'),
      para('a5', '指标合成'),
      para('a', '正文。'),
      para('a6', '看着像标题的正文'),
    ].join('')}<w:sectPr/></w:body></w:document>`,
  );
  const document = await readDocx(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.deepEqual(
    document.blocks.map((block) => [block.kind, block.level]),
    [
      ['heading', 1],
      ['heading', 2],
      ['heading', 2],
      ['paragraph', null],
      ['paragraph', null],
    ],
  );
});
