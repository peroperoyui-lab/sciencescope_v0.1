import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { tempDir } from '../../../testing.js';
import { readDocx } from './read.js';
import { writeDocx } from './write.js';
import { indexXml, WORD } from './xml.js';
import { WORD14 } from './ids.js';

const fonts = '<w:rPr><w:rFonts w:eastAsia="宋体"/><w:b/></w:rPr>';
const properties = '<w:pPr><w:pStyle w:val="Normal"/><w:spacing w:after="120"/></w:pPr>';
const run = (text) => `<w:r>${fonts}<w:t>${text}</w:t></w:r>`;
const paragraph = (id, text, pPr = properties) =>
  `<w:p w14:paraId="${id}">${pPr}${run(text)}</w:p>`;
const markers =
  '<w:commentRangeStart w:id="1"/><w:bookmarkStart w:id="9" w:name="Target"/>' +
  run('有批注') +
  '<w:bookmarkEnd w:id="9"/><w:commentRangeEnd w:id="1"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>';

async function fixture(t, body, threaded = false, word14 = true) {
  const temporary = await tempDir('docx-blocks-comments');
  t.after(() => temporary.cleanup());
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${WORD}"${word14 ? ` xmlns:w14="${WORD14}"` : ''}><w:body>${body}<w:sectPr/></w:body></w:document>`,
  );
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  zip.file('word/styles.xml', '<styles>unchanged</styles>');
  zip.file(
    'word/header1.xml',
    `<w:hdr xmlns:w="${WORD}" xmlns:w14="${WORD14}">${paragraph('00000001', '页眉')}</w:hdr>`,
  );
  if (threaded) {
    zip.file(
      'word/comments.xml',
      `<w:comments xmlns:w="${WORD}" xmlns:w14="${WORD14}"><w:comment w:id="1" w:author="同事" w:initials="TS" w:date="2026-10-21T00:00:00Z">${paragraph('00000101', '第一行')}${paragraph('00000102', '第二行')}</w:comment><w:comment w:id="2" w:author="回复者">${paragraph('00000201', '回复')}</w:comment><w:comment w:id="3" w:author="第三人">${paragraph('00000301', '继续回复')}</w:comment><w:comment w:id="8" w:author="保留">${paragraph('00000801', '原样保留')}</w:comment></w:comments>`,
    );
    zip.file(
      'word/commentsExtended.xml',
      '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:commentEx w15:paraId="00000102" w15:done="1"/><w15:commentEx w15:paraId="00000201" w15:paraIdParent="00000102"/><w15:commentEx w15:paraId="00000301" w15:paraIdParent="00000201"/><w15:commentEx w15:paraId="00000801"/></w15:commentsEx>',
    );
    zip.file(
      'word/commentsIds.xml',
      '<w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid">' +
        [1, 2, 3, 8]
          .map(
            (n) =>
              `<w16cid:commentId w16cid:paraId="00000${n}0${n === 1 ? 2 : 1}" w16cid:durableId="0000000${n}"/>`,
          )
          .join('') +
        '</w16cid:commentsIds>',
    );
    zip.file(
      'word/commentsExtensible.xml',
      '<w16cex:commentsExtensible xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex">' +
        [1, 2, 3, 8]
          .map((n) => `<w16cex:commentExtensible w16cex:durableId="0000000${n}"/>`)
          .join('') +
        '</w16cex:commentsExtensible>',
    );
  }
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const file = path.join(temporary.dir, 'original.docx');
  await writeFile(file, bytes);
  return { bytes, file, before: await readDocx(bytes) };
}

test('split a paragraph, inherit paragraph/run formatting, and allocate package-wide identities', async (t) => {
  const { bytes, before } = await fixture(
    t,
    paragraph('00112233', '第一句。第二句。') + paragraph('00112234', '不改'),
    true,
  );
  const first = before.blocks[0];
  const result = await writeDocx(
    bytes,
    { [first.id]: [{ ...first.inlines[0], text: '第一句。' }] },
    {
      inserted: [{ after: first.id, id: 'new-part', inlines: [{ text: '第二句。' }] }],
    },
  );
  const after = await readDocx(result.bytes);
  assert.equal(after.blocks[1].id, result.inserted['new-part']);
  assert.equal(after.blocks[0].text, '第一句。');
  assert.equal(after.blocks[1].text, '第二句。');
  assert.equal(after.raw(after.blocks[0].pPr), after.raw(after.blocks[1].pPr));
  assert.equal(after.raw(after.runs[1].rPr), fonts);
  assert.equal(before.raw(before.blocks[1]), after.raw(after.blocks[2]));
  const ids = [];
  for (const entry of Object.values(after.zip.files)) {
    if (entry.name.endsWith('.xml'))
      ids.push(
        ...indexXml(await entry.async('string'))
          .map((span) => span.attrs['w14:paraId'])
          .filter(Boolean),
      );
  }
  assert.equal(new Set(ids).size, ids.length);
  const generated = result.inserted['new-part'].slice(2);
  assert.match(generated, /^[0-7][0-9A-F]{7}$/u);
  assert.ok(after.spans.find((span) => span.attrs['w14:paraId'] === generated).attrs['w14:textId']);
  for (const [name, entry] of Object.entries(before.zip.files))
    if (!entry.dir && name !== 'word/document.xml')
      assert.deepEqual(
        await after.zip.file(name).async('nodebuffer'),
        await entry.async('nodebuffer'),
      );
});

test('insert at the body start without an existing w14 declaration, and chain new paragraphs', async (t) => {
  const { bytes } = await fixture(t, `<w:p>${run('原文')}</w:p>`, false, false);
  const result = await writeDocx(
    bytes,
    {},
    {
      inserted: [
        { after: '^', id: 'a', inlines: [{ text: '开头' }] },
        { after: 'a', id: 'b', inlines: [{ text: '接续' }] },
      ],
    },
  );
  const after = await readDocx(result.bytes);
  assert.deepEqual(
    after.blocks.map((block) => block.text),
    ['开头', '接续', '原文'],
  );
  assert.ok(!after.xml.includes('textId='));
  assert.equal(after.blocks[0].id, result.inserted.a);
  const empty = await fixture(t, '', false, false);
  const first = await writeDocx(
    empty.bytes,
    {},
    {
      inserted: [{ after: '^', id: 'first', inlines: [{ text: '从空文档开始' }] }],
    },
  );
  assert.equal((await readDocx(first.bytes)).blocks[0].text, '从空文档开始');
});

test('insert and replace a paragraph inside its table cell, but never remove its last paragraph', async (t) => {
  const { bytes, before, file } = await fixture(
    t,
    `<w:tbl><w:tr><w:tc>${paragraph('00000010', '单元格')}</w:tc></w:tr></w:tbl>`,
  );
  const id = before.blocks[0].id;
  await assert.rejects(writeDocx(bytes, {}, { removed: [id] }), {
    code: 'DOCX_LAST_CELL_PARAGRAPH',
  });
  assert.deepEqual(await readFile(file), bytes);
  const result = await writeDocx(
    bytes,
    {},
    { removed: [id], inserted: [{ after: id, id: 'replacement', inlines: [{ text: '新段' }] }] },
  );
  const after = await readDocx(result.bytes);
  assert.equal(after.blocks.length, 1);
  assert.equal(after.blocks[0].kind, 'table-cell');
  assert.equal(after.spans[after.blocks[0].parent].tag, 'w:tc');
  assert.equal(after.blocks[0].text, '新段');
});

test('deleting paragraphs relocates bookmarks and comment markers to the next paragraph or previous end', async (t) => {
  const { bytes, before } = await fixture(
    t,
    paragraph('00000010', '前') +
      `<w:p w14:paraId="00000011">${markers}</w:p>` +
      paragraph('00000012', '后'),
    true,
  );
  const result = await writeDocx(bytes, {}, { removed: [before.blocks[1].id] });
  const after = await readDocx(result.bytes);
  assert.equal(after.blocks.length, 2);
  for (const tag of [
    'commentRangeStart',
    'commentRangeEnd',
    'commentReference',
    'bookmarkStart',
    'bookmarkEnd',
  ]) {
    const matches = after.spans.filter((span) => span.tag === 'w:' + tag);
    assert.equal(matches.length, 1);
    assert.ok(matches[0].start >= after.blocks[1].start && matches[0].end <= after.blocks[1].end);
  }
  assert.equal(after.comments[0].range.from.blockId, after.blocks[1].id);
  const final = await readDocx(
    (await writeDocx(result.bytes, {}, { removed: [after.blocks[1].id] })).bytes,
  );
  assert.ok(
    final.raw(final.blocks[0]).indexOf('commentRangeStart') >
      final.raw(final.blocks[0]).indexOf('前'),
  );
  const emptyTarget = await fixture(t, `<w:p>${markers}</w:p><w:p/>`, true);
  const relocated = await readDocx(
    (
      await writeDocx(
        emptyTarget.bytes,
        {},
        {
          removed: [emptyTarget.before.blocks[0].id],
        },
      )
    ).bytes,
  );
  assert.equal(relocated.blocks.length, 1);
  assert.ok(relocated.xml.includes('bookmarkStart'));
});

test('removing a section-break paragraph aborts the whole operation before writing', async (t) => {
  const { bytes, before, file } = await fixture(
    t,
    paragraph('00000010', '分节', '<w:pPr><w:sectPr/></w:pPr>') + paragraph('00000011', '原文'),
  );
  await assert.rejects(
    writeDocx(
      bytes,
      { [before.blocks[1].id]: [{ text: '不应写入' }] },
      { removed: [before.blocks[0].id] },
    ),
    { code: 'DOCX_SECTION_BREAK' },
  );
  assert.deepEqual(await readFile(file), bytes);
});

test('read comment text, authors, anchors, reply relationships and resolved state; edit text retains thread identity and formatting', async (t) => {
  const { bytes, before } = await fixture(t, `<w:p w14:paraId="00000010">${markers}</w:p>`, true);
  const first = before.comments[0];
  assert.equal(first.text, '第一行\n第二行');
  assert.equal(first.author, '同事');
  assert.equal(first.initials, 'TS');
  assert.equal(first.date, '2026-10-21T00:00:00Z');
  assert.equal(first.done, true);
  assert.equal(first.range.from.blockId, before.blocks[0].id);
  assert.ok(first.range.from.index < first.range.to.index);
  assert.equal(before.comments[1].parentId, '1');
  const after = await readDocx(
    (await writeDocx(bytes, {}, { comments: [{ op: 'edit', id: '1', text: '修改 & 说明' }] }))
      .bytes,
  );
  assert.equal(after.comments[0].text, '修改 & 说明');
  assert.equal(after.comments[0].paraId, '00000102');
  assert.equal(after.comments[1].parentId, '1');
  assert.equal(after.comments[0].done, true);
  assert.equal(after.xml, before.xml);
  const edited = after.commentsXml.slice(after.comments[0].start, after.comments[0].end);
  assert.ok(edited.includes(properties));
  assert.ok(edited.includes(fonts));
  assert.equal(indexXml(after.commentsXml).filter((span) => span.tag === 'w:p').length, 4);
  const legacy = await JSZip.loadAsync(bytes);
  legacy.remove('word/commentsExtended.xml');
  legacy.file('word/comments.xml', before.commentsXml.replace(/ w14:paraId="[^"]+"/gu, ''));
  const oldComments = await readDocx(await legacy.generateAsync({ type: 'nodebuffer' }));
  assert.ok(oldComments.comments.every((comment) => comment.parentId === null && !comment.done));
});

test('deleting a comment removes its full reply thread, anchors and all matching extension entries', async (t) => {
  const { bytes, before } = await fixture(t, `<w:p w14:paraId="00000010">${markers}</w:p>`, true);
  const after = await readDocx(
    (await writeDocx(bytes, {}, { comments: [{ op: 'delete', id: '1' }] })).bytes,
  );
  assert.deepEqual(
    after.comments.map((comment) => comment.id),
    ['8'],
  );
  assert.ok(!after.xml.includes('commentRange'));
  assert.ok(!after.xml.includes('commentReference'));
  assert.ok(after.xml.includes('bookmarkStart'));
  assert.ok(
    after.commentsXml.includes(
      before.commentsXml.slice(before.comments[3].start, before.comments[3].end),
    ),
  );
  for (const part of ['commentsExtended.xml', 'commentsIds.xml', 'commentsExtensible.xml']) {
    const spans = indexXml(await after.zip.file('word/' + part).async('string'));
    assert.equal(spans.length, 2, part);
    assert.ok(
      Object.values(spans[1].attrs).some((value) => value === '00000801' || value === '00000008'),
    );
  }
});

test('adding a comment to an inserted paragraph records caller initials and valid existing extension links', async (t) => {
  const { bytes, before } = await fixture(t, paragraph('00000010', '正文'), true);
  const result = await writeDocx(
    bytes,
    {},
    {
      inserted: [{ after: before.blocks[0].id, id: 'new', inlines: [{ text: '可批注' }] }],
      comments: [
        {
          op: 'add',
          blockId: 'new',
          from: 0,
          to: 1,
          author: 'ScienceScope · 主专家',
          initials: 'SS',
          text: '核对',
        },
      ],
    },
  );
  const after = await readDocx(result.bytes);
  const comment = after.comments.at(-1);
  assert.equal(comment.author, 'ScienceScope · 主专家');
  assert.equal(comment.initials, 'SS');
  assert.equal(comment.text, '核对');
  assert.equal(comment.range.from.blockId, result.inserted.new);
  assert.equal(comment.parentId, null);
  assert.equal(comment.done, false);
  for (const part of ['commentsExtended.xml', 'commentsIds.xml'])
    assert.ok((await after.zip.file('word/' + part).async('string')).includes(comment.paraId));
});
