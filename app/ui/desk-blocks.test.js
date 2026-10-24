import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockDelta,
  confirmedOf,
  fromDocJSON,
  normalizeInlines,
  textShape,
  toDocJSON,
} from './desk-blocks.js';

const blocks = [
  {
    id: 'p:1',
    kind: 'heading',
    level: null,
    style: 'Heading2',
    inlines: [{ text: '标题', marks: [], run: 0 }],
  },
  {
    id: 'p:2',
    kind: 'paragraph',
    level: null,
    style: null,
    section: true,
    inlines: [
      { text: '粗', marks: ['i', 'b'], run: 1 },
      { text: '', marks: [], run: 2 },
      { atom: 'bookmark', ref: 0, display: '￼' },
      { text: '链', marks: [], run: 3, wrap: 0 },
      { text: '接', marks: [], run: 3, wrap: 0 },
      { atom: 'image', ref: 4, display: '￼', run: 4, media: true },
    ],
  },
  {
    id: 'p:3',
    kind: 'table-cell',
    cell: { table: 20, row: 21, cell: 22 },
    inlines: [{ text: 'A1', marks: [], run: 5 }],
  },
  {
    id: 'p:4',
    kind: 'table-cell',
    cell: { table: 20, row: 21, cell: 26 },
    inlines: [{ text: 'B1', marks: [], run: 6 }],
  },
  {
    id: 'p:5',
    kind: 'table-cell',
    cell: { table: 20, row: 21, cell: 26 },
    inlines: [{ text: 'B2', marks: [], run: 7 }],
  },
  { id: 'p:6', kind: 'opaque', text: '跨段落的域', inlines: [] },
  { id: 'p:7', kind: 'paragraph', style: null, inlines: [{ text: '尾', marks: [], run: 8 }] },
];

test('session blocks become paragraphs and tables, and come back unchanged', () => {
  const doc = toDocJSON(blocks);
  assert.deepEqual(
    doc.content.map((node) => node.type),
    ['para', 'para', 'table', 'opaque', 'para'],
  );
  assert.equal(doc.content[0].attrs.level, 2);
  assert.equal(doc.content[1].attrs.section, true);
  const cells = doc.content[2].content[0].content;
  assert.deepEqual(
    cells.map((cell) => cell.content.length),
    [1, 2],
  );
  // Marks keep the server's order; run and hyperlink travel as one origin mark.
  assert.deepEqual(doc.content[1].content[0].marks, [
    { type: 'b' },
    { type: 'i' },
    { type: 'origin', attrs: { run: 1, wrap: null } },
  ]);
  const back = fromDocJSON(doc);
  assert.deepEqual(
    back.map((block) => [block.id, block.container]),
    [
      ['p:1', 'body'],
      ['p:2', 'body'],
      ['p:3', 'cell:22'],
      ['p:4', 'cell:26'],
      ['p:5', 'cell:26'],
      ['p:6', 'body'],
      ['p:7', 'body'],
    ],
  );
  assert.equal(blockDelta(confirmedOf(blocks), back), null);
});

test('the normal form merges split text of one run and drops display-only fields', () => {
  assert.deepEqual(normalizeInlines(blocks[1].inlines), [
    { text: '粗', marks: ['b', 'i'], run: 1 },
    { atom: 'bookmark', ref: 0, display: '￼' },
    { text: '链接', marks: [], run: 3, wrap: 0 },
    { atom: 'image', ref: 4, display: '￼', run: 4 },
  ]);
});

test('edits, splits and joins become one PATCH body', () => {
  const doc = toDocJSON(blocks);
  // Edit the heading, split the tail paragraph, split a cell, join p:2 into p:1.
  doc.content[0].content[0].text = '新标题';
  const tail = doc.content[4];
  tail.content = [{ type: 'text', text: '尾', marks: [{ type: 'b' }] }];
  doc.content.push({
    type: 'para',
    attrs: { id: 'n:1', kind: 'paragraph', like: 'p:7' },
    content: [{ type: 'text', text: '新段' }],
  });
  doc.content[2].content[0].content[0].content.push({
    type: 'para',
    attrs: { id: 'n:2', kind: 'table-cell', like: 'p:3' },
    content: [{ type: 'text', text: 'A2' }],
  });
  doc.content.splice(1, 1);
  // A new plain paragraph after a heading borrows the nearest plain paragraph.
  doc.content.splice(1, 0, {
    type: 'para',
    attrs: { id: 'n:3', kind: 'paragraph', like: null },
    content: [{ type: 'text', text: '引言' }],
  });
  const delta = blockDelta(confirmedOf(blocks), fromDocJSON(doc));
  assert.deepEqual(delta, {
    blocks: {
      'p:1': [{ text: '新标题', marks: [], run: 0 }],
      'p:7': [{ text: '尾', marks: ['b'] }],
    },
    inserted: [
      { id: 'n:3', after: 'p:1', like: 'p:7', inlines: [{ text: '引言', marks: [] }] },
      { id: 'n:2', after: 'p:3', like: 'p:3', inlines: [{ text: 'A2', marks: [] }] },
      { id: 'n:1', after: 'p:7', like: 'p:7', inlines: [{ text: '新段', marks: [] }] },
    ],
    removed: ['p:2'],
  });
});

test('text files keep their BOM and line endings', () => {
  assert.deepEqual(textShape('﻿a\r\nb\r\n'), {
    bom: true,
    separator: '\r\n',
    body: 'a\r\nb\r\n',
  });
  assert.equal(textShape('a\nb').separator, '\n');
  assert.equal(textShape('a\r\nb\nc').separator, '\n');
});
