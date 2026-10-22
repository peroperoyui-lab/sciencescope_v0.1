import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { tempDir } from '../../testing.js';
import { diffVersions } from './diff.js';
import { readDiffBlocks, describeBlock } from './diff-blocks.js';
import { WORD } from './docx/xml.js';

const block = (text, extra = {}) => ({ id: 'b', kind: 'paragraph', text, ...extra });
const paragraphs = (...texts) => texts.map((text) => block(text));
const run = (text, properties = '') => `<w:r>${properties}<w:t>${text}</w:t></w:r>`;
const p = (content, properties = '') => `<w:p>${properties}${content}</w:p>`;

async function docx(t, body) {
  const temporary = await tempDir('diff-docx');
  t.after(() => temporary.cleanup());
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${WORD}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  );
  const file = path.join(temporary.dir, '稿件.docx');
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return readDiffBlocks({ file, name: '稿件.docx' });
}

test('DOCX Chinese word changes use original UTF-16 offsets; unchanged documents have empty arrays', async (t) => {
  const old = await docx(t, p(run('😀研究发现经济发展。')));
  const next = await docx(t, p(run('😀研究发现社会发展。')));
  const diff = diffVersions(old.items, next.items);
  assert.deepEqual(diff.deleted, [{ block: 0, from: 6, to: 8 }]);
  assert.deepEqual(diff.inserted, [{ block: 0, from: 6, to: 8 }]);
  assert.deepEqual(diff.counts, { deleted: 1, inserted: 1, format: 0 });
  const same = diffVersions(old.items, old.items);
  assert.equal(same.status, 'unchanged');
  for (const field of ['pairs', 'deleted', 'inserted', 'format', 'removedAt'])
    assert.deepEqual(same[field], []);
});

test('whole paragraph removal/insertion retains document order and the preceding new block', () => {
  const old = paragraphs('开头要删', '保留甲', '中间要删', '保留乙', '末尾要删');
  const next = paragraphs('保留甲', '保留乙', '新增段落');
  const diff = diffVersions(old, next);
  assert.deepEqual(diff.removedAt, [
    { old: 0, after: -1 },
    { old: 2, after: 0 },
    { old: 4, after: 1 },
  ]);
  assert.deepEqual(
    diff.deleted,
    [0, 2, 4].map((index) => ({ block: index, from: 0, to: old[index].text.length })),
  );
  assert.deepEqual(diff.inserted, [{ block: 2, from: 0, to: 4 }]);
});

test('split and merge select the more similar part without a whole-paragraph delete/add', () => {
  const whole = paragraphs('研究发现经济发展显著提高居民生活质量。补充。');
  const split = paragraphs('研究发现经济发展显著提高居民生活质量。', '补充。');
  const forward = diffVersions(whole, split);
  assert.deepEqual(forward.pairs, [
    { old: 0, new: 0 },
    { old: null, new: 1 },
  ]);
  assert.deepEqual(forward.removedAt, []);
  const reverse = diffVersions(split, whole);
  assert.deepEqual(reverse.pairs, [
    { old: 0, new: 0 },
    { old: 1, new: null },
  ]);
  const shortFirst = diffVersions(whole, [split[1], split[0]]);
  assert.deepEqual(shortFirst.pairs, [
    { old: null, new: 0 },
    { old: 0, new: 1 },
  ]);
});

test('DOCX bold marks apply only to unchanged characters, and heading changes are block formats', async (t) => {
  const old = await docx(t, p(run('研究发现经济发展。')));
  const bold = await docx(
    t,
    p(run('研究发现') + run('经济', '<w:rPr><w:b/></w:rPr>') + run('发展。')),
  );
  const diff = diffVersions(old.items, bold.items);
  assert.deepEqual(diff.format, [{ block: 0, from: 4, to: 6, before: [], after: ['b'] }]);
  assert.deepEqual(diff.counts, { deleted: 0, inserted: 0, format: 1 });
  const changed = await docx(
    t,
    p(run('研究发现') + run('社会', '<w:rPr><w:b/></w:rPr>') + run('发展。')),
  );
  assert.deepEqual(diffVersions(old.items, changed.items).format, []);
  const heading = await docx(
    t,
    p(
      run('研究发现经济发展。'),
      '<w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/></w:pPr>',
    ),
  );
  const style = diffVersions(old.items, heading.items);
  assert.equal(style.format.length, 1);
  assert.equal(style.format[0].from, 0);
  assert.equal(style.format[0].to, old.items[0].block.text.length);
  assert.equal(style.format[0].after.level, 1);
  assert.equal(style.format[0].after.kind, 'heading');
});

test('same-display formula atoms match XML identity, not their displayed linear string', async (t) => {
  const formula = (prop) => `<m:oMath><m:r>${prop}<m:t>x</m:t></m:r></m:oMath>`;
  const old = await docx(t, p(run('公式相同文字') + formula('<m:rPr><m:sty m:val="p"/></m:rPr>')));
  const next = await docx(t, p(run('公式相同文字') + formula('<m:rPr><m:sty m:val="b"/></m:rPr>')));
  assert.equal(old.items[0].block.text, next.items[0].block.text);
  assert.notEqual(old.items[0].key, next.items[0].key);
  const diff = diffVersions(old.items, next.items);
  assert.equal(diff.status, 'ready');
  assert.ok(diff.deleted.length && diff.inserted.length);
  assert.equal(diffVersions(old.items, old.items).status, 'unchanged');
});

test('NFKC and whitespace normalization anchors retain raw text offsets', () => {
  const diff = diffVersions(paragraphs('  Ａ   研究  '), paragraphs('A 研究'));
  assert.deepEqual(diff.pairs, [{ old: 0, new: 0 }]);
  assert.equal(diff.removedAt.length, 0);
  assert.ok(diff.deleted.every((range) => range.to <= 10));
  assert.equal(diff.status, 'ready');
});

test('formatting around a replaced same-display atom is kept on both sides', () => {
  const prefix = '研究结论需要保留可核验的证据。'.repeat(8);
  const suffix = '保留后文';
  const old = describeBlock(
    block(prefix + 'x' + suffix, {
      inlines: [{ text: prefix }, { atom: 'math', ref: 0, display: 'x' }, { text: suffix }],
    }),
    { xml: 'old', atoms: [{ start: 0, end: 3 }] },
  );
  const next = describeBlock(
    block(prefix + 'x' + suffix, {
      inlines: [
        { text: prefix, marks: ['b'] },
        { atom: 'math', ref: 0, display: 'x', marks: ['b'] },
        { text: suffix, marks: ['b'] },
      ],
    }),
    { xml: 'new', atoms: [{ start: 0, end: 3 }] },
  );
  const diff = diffVersions([old], [next]);
  assert.deepEqual(diff.deleted, [{ block: 0, from: prefix.length, to: prefix.length + 1 }]);
  assert.deepEqual(diff.inserted, diff.deleted);
  assert.deepEqual(diff.format, [
    { block: 0, from: 0, to: prefix.length, before: [], after: ['b'] },
    {
      block: 0,
      from: prefix.length + 1,
      to: prefix.length + 1 + suffix.length,
      before: [],
      after: ['b'],
    },
  ]);
});

test('MD/TeX readers compare original text and markdown heading levels; PDF text is comparable', async (t) => {
  const temporary = await tempDir('diff-formats');
  t.after(() => temporary.cleanup());
  for (const extension of ['md', 'tex']) {
    const file = path.join(temporary.dir, `稿件.${extension}`);
    await writeFile(file, '研究发现经济发展。');
    const old = await readDiffBlocks({ file, name: file });
    await writeFile(file, '研究发现社会发展。');
    const next = await readDiffBlocks({ file, name: file });
    assert.deepEqual(diffVersions(old.items, next.items).counts, {
      deleted: 1,
      inserted: 1,
      format: 0,
    });
  }
  const md = path.join(temporary.dir, '稿件.md');
  await writeFile(md, '# 研究结论');
  const old = await readDiffBlocks({ file: md, name: md });
  await writeFile(md, '## 研究结论');
  const next = await readDiffBlocks({ file: md, name: md });
  assert.equal(diffVersions(old.items, next.items).format[0].after.level, 2);
  const pdfs = [];
  for (const text of ['The research studies economics.', 'The research studies society.']) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText(text, { x: 40, y: 700, font });
    const file = path.join(temporary.dir, `version-${pdfs.length}.pdf`);
    await writeFile(file, await pdf.save());
    pdfs.push(await readDiffBlocks({ file, name: file }));
  }
  const pdfDiff = diffVersions(pdfs[0].items, pdfs[1].items);
  assert.ok(pdfDiff.deleted.length && pdfDiff.inserted.length);
});

test('large unmatched gaps use the injectable Dice bound and retain every block', () => {
  const diff = diffVersions(paragraphs('甲一', '甲二', '甲三'), paragraphs('乙一', '乙二'), {
    gapLimit: 5,
  });
  assert.equal(diff.limited, true);
  assert.equal(diff.pairs.length, 5);
  assert.deepEqual(diff.counts, { deleted: 3, inserted: 2, format: 0 });
});
