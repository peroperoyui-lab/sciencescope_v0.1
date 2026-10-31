import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';
import { tempDir } from '../../testing.js';
import { readDiffBlocks } from './diff-blocks.js';
import { diffVersions } from './diff.js';
import { bigrams, dice } from './compare.js';
import { WORD } from './docx/xml.js';

const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PICTURE = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const run = (text, bold = false) =>
  `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t>${text}</w:t></w:r>`;
const paragraph = (content) => `<w:p>${content}</w:p>`;
const commentRange = (content, id) =>
  `<w:commentRangeStart w:id="${id}"/>${content}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;

function picture(rid) {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="190500" cy="190500"/><wp:docPr id="1" name="合成图示"/>
    <a:graphic><a:graphicData uri="${PICTURE}"><pic:pic>
    <pic:nvPicPr><pic:cNvPr id="0" name="合成图示"/><pic:cNvPicPr/></pic:nvPicPr>
    <pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
    <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="190500" cy="190500"/></a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
    </pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function png(color) {
  const canvas = createCanvas(2, 2);
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, 2, 2);
  return canvas.toBuffer('image/png');
}

/** @param {any} t @param {string} body @param {any} [options] */
async function docx(t, body, options = {}) {
  const temporary = await tempDir('diff-comments');
  t.after(() => temporary.cleanup());
  const zip = new JSZip();
  const documentXml = `<w:document xmlns:w="${WORD}" xmlns:r="${RELATIONSHIPS}" xmlns:a="${DRAWING}" xmlns:pic="${PICTURE}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  const relationshipsXml = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${options.image ? `<Relationship Id="${options.rid}" Type="${RELATIONSHIPS}/image" Target="media/image.png"/>` : ''}${options.comment ? `<Relationship Id="comment-part" Type="${RELATIONSHIPS}/comments" Target="comments.xml"/>` : ''}</Relationships>`;
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', relationshipsXml);
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="${RELATIONSHIPS}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${options.comment ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ''}</Types>`,
  );
  if (options.comment)
    zip.file(
      'word/comments.xml',
      `<w:comments xmlns:w="${WORD}"><w:comment w:id="${options.comment.id}" w:author="合成作者" w:date="2026-10-31T00:00:00Z">${paragraph(run(options.comment.text))}</w:comment></w:comments>`,
    );
  if (options.image) zip.file('word/media/image.png', options.image);
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const file = path.join(temporary.dir, '公开合成稿.docx');
  await writeFile(file, bytes);
  const read = await readDiffBlocks({ file, name: '公开合成稿.docx' });
  const saved = await JSZip.loadAsync(bytes);
  return {
    ...read,
    file,
    documentXml: await saved.file('word/document.xml').async('string'),
    relationshipsXml: await saved.file('word/_rels/document.xml.rels').async('string'),
    imageBytes: options.image ? await saved.file('word/media/image.png').async('nodebuffer') : null,
  };
}

/** @param {any} t @param {string} scenario @param {any} before @param {any} after */
function compare(t, scenario, before, after) {
  const diff = diffVersions(before.items, after.items);
  t.diagnostic(
    'P5_DIFF_COMMENTS ' +
      JSON.stringify({
        scenario,
        algorithm: diff.algorithm,
        status: diff.status,
        counts: diff.counts,
        pairs: diff.pairs,
        beforeKeyLengths: before.items.map((item) => item.key.length),
        afterKeyLengths: after.items.map((item) => item.key.length),
        beforeMatchingTextLengths: before.items.map((item) => item.matchingText?.length ?? null),
        afterMatchingTextLengths: after.items.map((item) => item.matchingText?.length ?? null),
        matchingScore: dice(
          bigrams(before.items[0].matchingText ?? before.items[0].key),
          bigrams(after.items[0].matchingText ?? after.items[0].key),
        ),
      }),
  );
  return diff;
}

test('two separate deletions, one retained bold phrase and a new comment remain a paired paragraph', async (t) => {
  const prefix = '本段只用于编辑台验收：';
  const newText = '样本量为1,284家合成企业，方法组均值为8.4，基线均值为7.9。未做显著性检验。';
  const suffix = '结果表明该方法显著优于基线。';
  const oldText = prefix + newText + suffix;
  const before = await docx(t, paragraph(run(oldText)));
  const after = await docx(
    t,
    paragraph(
      run('样本量为1,284家') +
        commentRange(run('合成企业', true), '1') +
        run('，方法组均值为8.4，基线均值为7.9。未做显著性检验。'),
    ),
    { comment: { id: '1', text: '请复核合成资料的口径。' } },
  );
  assert.equal(before.items[0].block.text, oldText);
  assert.equal(after.items[0].block.text, newText);
  const diff = compare(t, 'deletions-bold-comment', before, after);
  assert.deepEqual(diff.pairs, [{ old: 0, new: 0 }]);
  assert.deepEqual(diff.counts, { deleted: 2, inserted: 0, format: 1 });
  assert.deepEqual(diff.deleted, [
    { block: 0, from: 0, to: prefix.length },
    { block: 0, from: prefix.length + newText.length, to: oldText.length },
  ]);
  assert.deepEqual(diff.inserted, []);
  const from = newText.indexOf('合成企业');
  assert.deepEqual(diff.format, [{ block: 0, from, to: from + 4, before: [], after: ['b'] }]);
});

test('adding or editing only a comment leaves the paragraph content and formatting unchanged', async (t) => {
  const text = '研究需核对合成资料，样本口径待复核。';
  const before = await docx(t, paragraph(run(text)));
  const annotated = (id) =>
    paragraph(run('研究需核对') + commentRange(run('合成资料'), id) + run('，样本口径待复核。'));
  const added = await docx(t, annotated('1'), { comment: { id: '1', text: '请核对合成资料。' } });
  const edited = await docx(t, annotated('9'), {
    comment: { id: '9', text: '请补充核对合成资料的出处。' },
  });
  assert.equal(added.items[0].block.text, text);
  assert.equal(edited.items[0].block.text, text);
  const adding = compare(t, 'comment-only-added', before, added);
  const editing = compare(t, 'comment-only-edited', added, edited);
  for (const diff of [adding, editing]) {
    assert.equal(diff.status, 'unchanged');
    assert.deepEqual(diff.counts, { deleted: 0, inserted: 0, format: 0 });
    assert.deepEqual(diff.deleted, []);
    assert.deepEqual(diff.inserted, []);
    assert.deepEqual(diff.format, []);
  }
});

test('replacing a picture keeps the short surrounding paragraph paired and marks one content replacement', async (t) => {
  const prefix = '合成资料中的图示为';
  const body = (rid) => paragraph(run(prefix) + picture(rid) + run('，供复核口径。'));
  const before = await docx(t, body('image-before'), {
    rid: 'image-before',
    image: png('#cc2222'),
  });
  const after = await docx(t, body('image-after'), { rid: 'image-after', image: png('#2222cc') });
  assert.equal(before.items[0].block.text, after.items[0].block.text);
  const diff = compare(t, 'picture-replaced', before, after);
  assert.deepEqual(diff.pairs, [{ old: 0, new: 0 }]);
  assert.deepEqual(diff.counts, { deleted: 1, inserted: 1, format: 0 });
  const range = [{ block: 0, from: prefix.length, to: prefix.length + 1 }];
  assert.deepEqual(diff.deleted, range);
  assert.deepEqual(diff.inserted, range);
});

test('identical drawing XML and relationship IDs still detect changed embedded image bytes', async (t) => {
  const prefix = '合成资料中的图示为';
  const body = paragraph(run(prefix) + picture('image') + run('，供复核口径。'));
  const before = await docx(t, body, { rid: 'image', image: png('#cc2222') });
  const same = await docx(t, body, { rid: 'image', image: png('#cc2222') });
  const after = await docx(t, body, { rid: 'image', image: png('#2222cc') });
  assert.equal(before.documentXml, after.documentXml);
  assert.equal(before.relationshipsXml, after.relationshipsXml);
  assert.deepEqual(before.imageBytes, same.imageBytes);
  assert.notDeepEqual(before.imageBytes, after.imageBytes);
  const control = compare(t, 'image-bytes-unchanged', before, same);
  const changed = compare(t, 'image-bytes-changed', before, after);
  assert.equal(control.status, 'unchanged');
  assert.deepEqual(control.counts, { deleted: 0, inserted: 0, format: 0 });
  assert.deepEqual(changed.pairs, [{ old: 0, new: 0 }]);
  assert.deepEqual(changed.counts, { deleted: 1, inserted: 1, format: 0 });
  const range = [{ block: 0, from: prefix.length, to: prefix.length + 1 }];
  assert.deepEqual(changed.deleted, range);
  assert.deepEqual(changed.inserted, range);
});

test('a grouped drawing detects replacement of its second embedded picture', async (t) => {
  const fixture = await docx(t, paragraph(run('图示') + picture('image')), {
    rid: 'image',
    image: png('#cc2222'),
  });
  const zip = await JSZip.loadAsync(await readFile(fixture.file));
  zip.file(
    'word/document.xml',
    fixture.documentXml.replace(
      '<a:blip r:embed="image"/>',
      '<a:blip r:embed="image"/><a:blip r:embed="second"/>',
    ),
  );
  zip.file(
    'word/_rels/document.xml.rels',
    fixture.relationshipsXml.replace(
      '</Relationships>',
      `<Relationship Id="second" Type="${RELATIONSHIPS}/image" Target="media/second.png"/></Relationships>`,
    ),
  );
  zip.file('word/media/second.png', png('#22cc22'));
  await writeFile(fixture.file, await zip.generateAsync({ type: 'nodebuffer' }));
  const before = await readDiffBlocks({ file: fixture.file, name: '公开合成稿.docx' });
  const same = await readDiffBlocks({ file: fixture.file, name: '公开合成稿.docx' });
  zip.file('word/media/second.png', png('#2222cc'));
  await writeFile(fixture.file, await zip.generateAsync({ type: 'nodebuffer' }));
  const after = await readDiffBlocks({ file: fixture.file, name: '公开合成稿.docx' });
  assert.deepEqual(compare(t, 'grouped-image-unchanged', before, same).counts, {
    deleted: 0,
    inserted: 0,
    format: 0,
  });
  assert.deepEqual(compare(t, 'grouped-image-second-changed', before, after).counts, {
    deleted: 1,
    inserted: 1,
    format: 0,
  });
});
