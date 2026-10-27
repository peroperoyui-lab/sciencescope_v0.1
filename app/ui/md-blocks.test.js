import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EditorState } from 'prosemirror-state';
import {
  blockText,
  linkDefs,
  listItems,
  mapInBlock,
  mdSchema,
  parseMarkdown,
  writeBlock,
} from './md-blocks.js';

const SAMPLE = [
  '# 研究札记',
  '',
  '城市韧性的 __测度__ 仍有争议，见 [综述](https://example.org/review "综述") 与 <https://b.org>。',
  '第二行用 `code` 和 ~~删去~~，还有 $x^2$。',
  '',
  '* 第一条',
  '* 第二条',
  '  * 下一层',
  '',
  '1) 甲',
  '2) 乙',
  '',
  '> 引文 **重点**',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '| 指标 | 权重 |',
  '|---|---|',
  '| 就业 | 0.4 |',
  '',
  '[ref]: https://example.org/ref',
  '',
  '见 [文献][ref] 与 ![图](figs/a.png)',
  '',
  '- [ ] 待办',
  '- [x] 已办',
  '',
  '$$',
  'E = mc^2',
  '$$',
  '',
  '---',
  'Setext',
  '===',
  '',
].join('\n');

/** The page's first block after `edit` runs on a one-block document. */
function edited(node, edit) {
  const state = EditorState.create({ doc: mdSchema.node('doc', null, [node]) });
  const tr = state.tr;
  edit(tr);
  return tr.doc.firstChild;
}

test('blocks add up to the source and every block writes back as it was read', async () => {
  const sources = [
    SAMPLE,
    // docs/ is not pinned to LF, so a Windows checkout reads CRLF; the page gets LF (plain()).
    (await readFile(new URL('../../docs/decisions/DECISIONS.md', import.meta.url), 'utf8')).replace(
      /\r\n?/gu,
      '\n',
    ),
  ];
  for (const source of sources) {
    const { blocks, tail } = parseMarkdown(source);
    assert.equal(blocks.map((entry) => entry.gap + entry.text).join('') + tail, source);
    const defs = linkDefs(blocks);
    for (const entry of blocks)
      assert.ok(writeBlock(entry.node, undefined, defs).exact, entry.text);
  }
  const kinds = parseMarkdown(SAMPLE).blocks.map((entry) => entry.node.type.name);
  assert.deepEqual(kinds, [
    'heading',
    'paragraph',
    'bullet_list',
    'ordered_list',
    'blockquote',
    'code_block',
    'raw',
    'raw',
    'paragraph',
    'bullet_list',
    'math_block',
    'horizontal_rule',
    'heading',
  ]);
});

test('characters map between the page and the source both ways', () => {
  const { blocks } = parseMarkdown(SAMPLE);
  for (const entry of blocks)
    for (const seg of entry.segs) {
      if (seg.len !== seg.srcLen || seg.len < 2) continue;
      const shown = entry.node.textBetween(seg.pm - 1, seg.pm - 1 + seg.len);
      assert.equal(shown, entry.text.slice(seg.src, seg.src + seg.len));
    }
  const paragraph = blocks[1];
  // Inside the bold word, and on either side of its markers.
  const word = paragraph.text.indexOf('测度');
  const at = mapInBlock(paragraph, word + 1, 'src', 1);
  assert.equal(mapInBlock(paragraph, at, 'pm', 1), word + 1);
  assert.equal(paragraph.node.textBetween(at - 2, at), '测度');
  const open = paragraph.text.indexOf('__测度');
  assert.equal(mapInBlock(paragraph, open, 'src', 1), mapInBlock(paragraph, word, 'src', 1));
  // A formula counts as one place standing for its whole source.
  const formula = paragraph.text.indexOf('$x^2$');
  const before = mapInBlock(paragraph, formula, 'src', 1);
  assert.equal(mapInBlock(paragraph, before + 1, 'pm', -1), formula + '$x^2$'.length);
});

test('a changed block keeps how it was written and escapes only what would change it', () => {
  const { blocks } = parseMarkdown(SAMPLE);
  const paragraph = blocks[1].node;
  // Typing at the end keeps __, the titled link and the autolink as written.
  const typed = edited(paragraph, (tr) => tr.insertText('补', paragraph.content.size + 1));
  const written = writeBlock(typed);
  assert.ok(written.exact);
  assert.equal(written.text, `${blocks[1].text}补`);
  // A line that would read as a heading is escaped.
  const heading = edited(paragraph, (tr) => tr.insertText('# ', 1));
  assert.match(writeBlock(heading).text, /^\\# 城市/u);
  // A space typed at the end stays in the text.
  const spaced = writeBlock(
    edited(paragraph, (tr) => tr.insertText(' ', paragraph.content.size + 1)),
  );
  assert.ok(spaced.exact);
  assert.ok(spaced.text.endsWith('。 '));
  // Bold ending on full-width punctuation before a letter closes before it.
  const plain = parseMarkdown('起草下一步提案；全局助手').blocks[0].node;
  const bold = edited(plain, (tr) => tr.addMark(4, 9, mdSchema.marks.strong.create()));
  const tidy = writeBlock(bold);
  assert.equal(tidy.text, '起草下**一步提案**；全局助手');
  assert.equal(tidy.parsed[0].node.child(1).text, '一步提案');
  // Marks that run longer open first.
  const nested = parseMarkdown('~~**甲**乙~~').blocks[0].node;
  assert.equal(blockText(nested, 0), '~~**甲**乙~~');
});

test('a changed list keeps the items that did not change', () => {
  const { blocks } = parseMarkdown(SAMPLE);
  const entry = blocks[2];
  const known = new WeakMap(listItems(entry));
  const list = edited(entry.node, (tr) => {
    // The end of the first item's paragraph: list, item and paragraph opened before it.
    const end = 1 + entry.node.child(0).nodeSize - 2;
    tr.insertText('甲', end);
  });
  const written = writeBlock(list, known);
  assert.equal(written.text, '* 第一条甲\n* 第二条\n  * 下一层');
  assert.ok(written.exact);
});

test('task boxes are not text, and new items are spaced like their neighbours', () => {
  // One loose list to Markdown: a blank line splits the task group from the plain one.
  const source = '- [ ] 核对样本\n- [ ] 复核权重\n\n- 第一条\n- 第二条';
  const { blocks } = parseMarkdown(source);
  const entry = blocks[0];
  assert.equal(entry.node.attrs.loose, true);
  assert.equal(entry.node.child(0).textContent, '核对样本');
  const known = new WeakMap(listItems(entry));
  // Ticking the first task writes one box.
  const ticked = edited(entry.node, (tr) => tr.setNodeMarkup(1, null, { checked: true }));
  assert.equal(
    writeBlock(ticked, known).text,
    '- [x] 核对样本\n- [ ] 复核权重\n\n- 第一条\n- 第二条',
  );
  // An item added after the last one gets no blank line before it.
  const item = mdSchema.nodes.list_item.create(null, [
    mdSchema.nodes.paragraph.create(null, mdSchema.text('第三条')),
  ]);
  const added = edited(entry.node, (tr) => tr.insert(entry.node.content.size + 1, item));
  assert.equal(writeBlock(added, known).text, `${source}\n- 第三条`);
});
