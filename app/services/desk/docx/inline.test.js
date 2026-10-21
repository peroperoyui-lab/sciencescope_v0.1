import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { tempDir } from '../../../testing.js';
import { readDocx } from './read.js';
import { writeDocx } from './write.js';
import { WORD } from './xml.js';

const fonts = '<w:rPr><w:rFonts w:eastAsia="宋体"/><w:color w:val="123456"/></w:rPr>';
const run = (text, properties = fonts) => `<w:r>${properties}<w:t>${text}</w:t></w:r>`;

async function fixture(t, body) {
  const temporary = await tempDir('docx-inline');
  t.after(() => temporary.cleanup());
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="${WORD}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body><w:p>${body}</w:p><w:p>${run('其余段落原样保留')}</w:p><w:sectPr/></w:body></w:document>`,
  );
  zip.file('word/styles.xml', '<styles>untouched</styles>');
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/paper" TargetMode="External"/></Relationships>',
  );
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(path.join(temporary.dir, 'original.docx'), bytes);
  return { bytes, before: await readDocx(bytes) };
}

async function changed(bytes, before, inlines) {
  const block = before.blocks[0];
  const after = await readDocx(await writeDocx(bytes, { [block.id]: inlines }));
  assert.equal(before.xml.slice(0, block.start), after.xml.slice(0, after.blocks[0].start));
  assert.equal(before.xml.slice(block.end), after.xml.slice(after.blocks[0].end));
  for (const [name, entry] of Object.entries(before.zip.files)) {
    if (entry.dir || name === 'word/document.xml') continue;
    assert.deepEqual(
      await entry.async('nodebuffer'),
      await after.zip.file(name).async('nodebuffer'),
      name,
    );
  }
  return after;
}

for (const [element, atom, display] of [
  ['<w:tab/>', 'tab', '\t'],
  ['<w:br w:type="textWrapping"/>', 'break', '\n'],
  ['<w:cr/>', 'break', '\n'],
  ['<w:noBreakHyphen/>', 'symbol', '\u2011'],
  ['<w:softHyphen/>', 'symbol', '\u00AD'],
  ['<w:sym w:font="Symbol" w:char="03B1"/>', 'symbol', 'α'],
]) {
  test(`edit text around ${element} without losing its run, character or untouched bytes`, async (t) => {
    const source = `<w:r w:rsidR="ABCDEF00">${fonts}<w:t>前文</w:t>${element}<w:lastRenderedPageBreak/><w:t>后文</w:t></w:r>`;
    const { bytes, before } = await fixture(t, source + run('邻段'));
    const block = before.blocks[0];
    assert.equal(block.text, '前文' + display + '后文邻段');
    assert.deepEqual(
      block.inlines.slice(0, 3).map((inline) => inline.run),
      [0, 0, 0],
    );
    assert.equal(block.inlines[1].atom, atom);
    assert.equal(block.inlines[1].display, display);
    const edited = block.inlines.map((inline) =>
      inline.text === '前文' ? { ...inline, text: '修改前文' } : inline,
    );
    const after = await changed(bytes, before, edited);
    assert.equal(after.blocks[0].text, '修改前文' + display + '后文邻段');
    assert.equal(after.runs.length, before.runs.length);
    assert.equal(after.raw(after.runs[0].rPr), fonts);
    assert.ok(after.raw(after.runs[0]).includes(element));
    assert.ok(!after.raw(after.runs[0]).includes('lastRenderedPageBreak'));
    const neighbourOnly = block.inlines.map((inline) =>
      inline.text === '邻段' ? { ...inline, text: '另改邻段' } : inline,
    );
    assert.ok((await changed(bytes, before, neighbourOnly)).xml.includes(source));
  });
}

test('page-break layout caches add no inline; unknown run children stay atomic', async (t) => {
  const unknown = [
    '<w:object/>',
    '<w:ruby><w:rt>' + run('注音') + '</w:rt></w:ruby>',
    '<mc:AlternateContent/>',
  ];
  const { bytes, before } = await fixture(
    t,
    `<w:r>${fonts}<w:t>可改</w:t><w:lastRenderedPageBreak/><w:t>末尾</w:t></w:r>` +
      unknown.map((xml) => `<w:r><w:t>保留</w:t>${xml}</w:r>`).join(''),
  );
  assert.deepEqual(
    before.blocks[0].inlines.slice(0, 2).map((inline) => inline.text),
    ['可改', '末尾'],
  );
  assert.equal(before.blocks[0].inlines.filter((inline) => inline.atom).length, 3);
  const after = await changed(
    bytes,
    before,
    before.blocks[0].inlines.map((inline) =>
      inline.text === '可改' ? { ...inline, text: '已改' } : inline,
    ),
  );
  assert.ok(!after.xml.includes('lastRenderedPageBreak'));
  for (const xml of unknown) assert.ok(after.xml.includes(`<w:r><w:t>保留</w:t>${xml}</w:r>`));
});

for (const [name, open, close] of [
  ['hyperlink', '<w:hyperlink r:id="rId7" w:history="1">', '</w:hyperlink>'],
  ['smartTag', '<w:smartTag w:uri="urn:term" w:element="term"><w:smartTagPr/>', '</w:smartTag>'],
  [
    'customXml',
    '<w:customXml w:uri="urn:custom" w:element="content"><w:customXmlPr/>',
    '</w:customXml>',
  ],
  [
    'content control',
    '<w:sdt><w:sdtPr><w:alias w:val="普通内容"/><w:tag w:val="user-note"/></w:sdtPr><w:sdtContent>',
    '</w:sdtContent></w:sdt>',
  ],
]) {
  test(`edit and empty an inline ${name} while retaining its original wrapper and target`, async (t) => {
    const { bytes, before } = await fixture(
      t,
      run('之前') + open + run('链接文字') + close + run('之后'),
    );
    const text = before.blocks[0].inlines.find((inline) => inline.text === '链接文字');
    assert.equal(typeof text.wrap, 'number');
    const after = await changed(
      bytes,
      before,
      before.blocks[0].inlines.map((inline) =>
        inline === text ? { ...inline, text: '修改链接文字' } : inline,
      ),
    );
    assert.ok(after.xml.includes(open));
    assert.ok(after.xml.includes(close));
    assert.equal(after.blocks[0].text, '之前修改链接文字之后');
    const emptied = await changed(
      bytes,
      before,
      before.blocks[0].inlines.filter((inline) => inline.wrap !== text.wrap),
    );
    assert.equal(emptied.blocks[0].text, '之前之后');
    assert.ok(!emptied.xml.includes(open));
    const blank = await changed(
      bytes,
      before,
      before.blocks[0].inlines.map((inline) =>
        inline === text ? { ...inline, text: '' } : inline,
      ),
    );
    assert.ok(!blank.xml.includes(open));
  });
}

test('nested containers and unchanged mixed runs retain their own XML boundaries', async (t) => {
  const cached = `<w:r>${fonts}<w:t>不改</w:t><w:tab/><w:lastRenderedPageBreak/><w:t>原样</w:t></w:r>`;
  const { bytes, before } = await fixture(
    t,
    `<w:sdt><w:sdtPr><w:alias w:val="普通"/></w:sdtPr><w:sdtContent>${cached}<w:hyperlink r:id="rId7">${run('内层文字')}</w:hyperlink></w:sdtContent></w:sdt>`,
  );
  const after = await changed(
    bytes,
    before,
    before.blocks[0].inlines.map((inline) =>
      inline.text === '内层文字' ? { ...inline, text: '内层改字' } : inline,
    ),
  );
  assert.equal(after.wraps.length, 2);
  assert.ok(after.xml.includes(cached));
  assert.equal(after.blocks[0].text, '不改\t原样内层改字');
});

test('citation controls stay atomic and display cached citation text', async (t) => {
  const properties = [
    '<w:citation/>',
    '<w:bibliography/>',
    '<w:tag w:val="CSL_CITATION"/>',
    '<w:alias w:val="Mendeley citation"/>',
    '<w:tag w:val="Citavi"/>',
    '<w:alias w:val="EndNote"/>',
  ];
  const controls = properties.map(
    (property) =>
      `<w:sdt><w:sdtPr>${property}</w:sdtPr><w:sdtContent>${run('(Zhang, 2024)')}</w:sdtContent></w:sdt>`,
  );
  const { bytes, before } = await fixture(t, run('可改') + controls.join(''));
  assert.equal(before.blocks[0].inlines.filter((inline) => inline.atom === 'field').length, 6);
  assert.equal(before.wraps.length, 0);
  assert.equal(before.blocks[0].text, '可改' + '(Zhang, 2024)'.repeat(6));
  const after = await changed(
    bytes,
    before,
    before.blocks[0].inlines.map((inline) =>
      inline.text === '可改' ? { ...inline, text: '改字' } : inline,
    ),
  );
  for (const control of controls) assert.ok(after.xml.includes(control));
});

test('direct formatting recognizes off values, preserves fonts and supports adding and removing marks', async (t) => {
  const properties =
    '<w:rPr><w:rStyle w:val="NotExpanded"/><w:rFonts w:eastAsia="宋体"/><w:b w:val="0"/><w:i w:val="off"/><w:u w:val="none"/><w:color w:val="123456"/></w:rPr>';
  const { bytes, before } = await fixture(
    t,
    run('取消加粗', properties) +
      run('上标', '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>') +
      run('下标', '<w:rPr><w:vertAlign w:val="subscript"/></w:rPr>') +
      run('关闭', '<w:rPr><w:b w:val="false"/><w:i w:val="0"/></w:rPr>'),
  );
  assert.deepEqual(
    before.blocks[0].inlines.map((inline) => inline.marks),
    [[], ['sup'], ['sub'], []],
  );
  const textOnly = await changed(
    bytes,
    before,
    before.blocks[0].inlines.map((inline, index) =>
      index === 0 ? { ...inline, text: '仅修改文字' } : inline,
    ),
  );
  assert.equal(textOnly.raw(textOnly.runs[0].rPr), properties);
  const added = await changed(
    bytes,
    before,
    before.blocks[0].inlines.map((inline, index) =>
      index === 0 ? { ...inline, marks: ['b', 'i', 'u'] } : inline,
    ),
  );
  assert.deepEqual(added.blocks[0].inlines[0].marks, ['b', 'i', 'u']);
  assert.ok(added.raw(added.runs[0].rPr).includes('<w:rFonts w:eastAsia="宋体"/>'));
  assert.ok(added.raw(added.runs[0].rPr).includes('<w:rStyle w:val="NotExpanded"/>'));
  const removedBytes = await writeDocx(
    await writeDocx(bytes, {
      [before.blocks[0].id]: before.blocks[0].inlines.map((inline, index) =>
        index === 0 ? { ...inline, marks: ['b', 'i', 'u'] } : inline,
      ),
    }),
    {
      [added.blocks[0].id]: added.blocks[0].inlines.map((inline, index) =>
        index === 0 ? { ...inline, marks: [] } : inline,
      ),
    },
  );
  assert.deepEqual((await readDocx(removedBytes)).blocks[0].inlines[0].marks, []);
});

test('formatting part of a mixed run does not change the other text or atomic character', async (t) => {
  const { bytes, before } = await fixture(
    t,
    `<w:r>${fonts}<w:t>加粗</w:t><w:tab/><w:t>保持</w:t></w:r>`,
  );
  const after = await changed(
    bytes,
    before,
    before.blocks[0].inlines.map((inline, index) =>
      index === 0 ? { ...inline, marks: ['b'] } : inline,
    ),
  );
  assert.deepEqual(
    after.blocks[0].inlines.filter((inline) => inline.text).map((inline) => inline.marks),
    [['b'], []],
  );
  assert.equal(after.blocks[0].text, '加粗\t保持');
});

test('projection contains field caches and linear math, never deleted revision text or field instructions', async (t) => {
  const field =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> ADDIN CITATION </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    run('(Zhang, 2024)') +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const { bytes, before } = await fixture(
    t,
    run('前') +
      field +
      '<w:fldSimple w:instr=" SEQ Figure ">' +
      run('图 1') +
      '</w:fldSimple><m:oMath><m:r><m:t>x</m:t></m:r><m:r><m:t>2</m:t></m:r></m:oMath><w:del w:id="1"><w:r><w:delText>删除的文字</w:delText></w:r></w:del><w:ins w:id="2">' +
      run('已有新增') +
      '</w:ins>',
  );
  assert.equal(before.blocks[0].text, '前(Zhang, 2024)图 1x2\uFFFC\uFFFC');
  const after = await changed(
    bytes,
    before,
    before.blocks[0].inlines.map((inline) =>
      inline.text === '前' ? { ...inline, text: '改' } : inline,
    ),
  );
  assert.equal(after.blocks[0].text, '改(Zhang, 2024)图 1x2\uFFFC\uFFFC');
  assert.ok(after.xml.includes(field));
});

test('a complex field crossing a hyperlink boundary stays balanced and exposes only its cache', async (t) => {
  const field =
    '<w:r><w:t>outside cache</w:t><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText>REF target</w:instrText><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:hyperlink r:id="rId7">' +
    run('缓存结果') +
    '<w:r><w:fldChar w:fldCharType="end"/><w:t>after cache</w:t></w:r></w:hyperlink>';
  const { bytes, before } = await fixture(t, run('可改') + field + run('结尾'));
  assert.equal(before.blocks[0].text, '可改缓存结果结尾');
  const after = await changed(
    bytes,
    before,
    before.blocks[0].inlines.map((inline) =>
      inline.text === '可改' ? { ...inline, text: '已改' } : inline,
    ),
  );
  assert.equal(after.blocks[0].text, '已改缓存结果结尾');
  assert.ok(after.xml.includes(field));
});
