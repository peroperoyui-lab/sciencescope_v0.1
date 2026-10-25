import test from 'node:test';
import assert from 'node:assert/strict';
import { diffVersions } from '../services/desk/diff.js';
import { publicBlock } from '../services/desk/model.js';
import { compareModel, formatTip, hunks, pieces, scrollMap } from './desk-compare.js';

const para = (id, text, marks = []) =>
  publicBlock({ id, kind: 'paragraph', style: '', level: null, inlines: [{ text, marks }] });
const heading = (id, text) =>
  publicBlock({ id, kind: 'heading', style: 'Heading1', level: 1, inlines: [{ text, marks: [] }] });

/** What the version diff endpoint returns for two block lists. */
const compared = (before, after) => ({
  format: 'docx',
  old: { blocks: before },
  new: { blocks: after },
  diff: diffVersions(before, after),
});

test('a replaced word is one change with both sides marked', () => {
  const result = compared(
    [heading('a', '标题'), para('b', '研究发现经济发展很快。')],
    [heading('a', '标题'), para('b', '研究发现社会发展很快。')],
  );
  const model = compareModel(result);
  assert.equal(model.stops.length, 1);
  assert.deepEqual(model.stops[0], { old: 1, new: 1 });
  const [del] = model.old[1].marks;
  const [ins] = model.new[1].marks;
  assert.equal(result.old.blocks[1].text.slice(del.from, del.to), '经济');
  assert.equal(result.new.blocks[1].text.slice(ins.from, ins.to), '社会');
  assert.deepEqual(model.anchors, [
    [0, 0],
    [1, 1],
  ]);
});

test('removed paragraphs leave one gap; added ones and formatting are their own changes', () => {
  const result = compared(
    [para('a', '保留第一段。'), para('b', '这一段会被删掉。'), para('c', '格式会变。')],
    [para('a', '保留第一段。'), para('c', '格式会变。', ['b']), para('d', '新加一段。')],
  );
  const model = compareModel(result);
  assert.equal(model.stops.length, 3);
  // The gap sits after the paragraph before the removed one.
  assert.equal(model.new[0].gapEnd.tip, '这里删了一段');
  assert.deepEqual(
    model.old[1].marks.map((mark) => [mark.kind, mark.from, mark.to]),
    [['del', 0, 8]],
  );
  assert.equal(model.new[1].marks[0].kind, 'fmt');
  assert.equal(model.new[1].marks[0].tip, '格式：加粗');
  assert.equal(model.new[2].marks[0].kind, 'ins');
  assert.deepEqual(
    model.stops.map((stop) => [stop.old, stop.new]),
    [
      [1, 0],
      [2, 1],
      [2, 2],
    ],
  );
});

test('an unchanged comparison still lines the pages up paragraph by paragraph', () => {
  const blocks = [para('a', '甲'), para('b', '乙')];
  const model = compareModel(compared(blocks, structuredClone(blocks)));
  assert.equal(model.stops.length, 0);
  assert.deepEqual(model.anchors, [
    [0, 0],
    [1, 1],
  ]);
});

test('hunks join a deletion with the insertion at the same place', () => {
  // old "abXcdY", new "abZcd": X→Z is one hunk, Y deleted at the end another.
  const found = hunks(
    [
      { from: 2, to: 3 },
      { from: 5, to: 6 },
    ],
    [{ from: 2, to: 3 }],
    [],
  );
  assert.deepEqual(
    found.map((hunk) => [hunk.del.length, hunk.ins.length, hunk.at]),
    [
      [1, 1, 2],
      [1, 0, 5],
    ],
  );
});

test('pieces cut inlines at mark edges and keep atoms whole', () => {
  const inlines = [
    { text: '研究', marks: ['b'] },
    { atom: 'math', ref: 0, display: 'x' },
    { text: '发现', marks: [] },
  ];
  const marks = [{ from: 1, to: 4, kind: 'ins', stops: [0] }];
  assert.deepEqual(
    pieces(inlines, marks).map((piece) => [piece.text, piece.marks.length]),
    [
      ['研', 0],
      ['究', 1],
      ['x', 1],
      ['发', 1],
      ['现', 0],
    ],
  );
});

test('the scroll map stretches what only one page has', () => {
  // Paragraph 1 is 100px on the left and 300px on the right.
  const map = scrollMap([
    [0, 0],
    [0, 0],
    [100, 300],
    [100, 300],
    [200, 400],
  ]);
  assert.equal(map.toRight(50), 150);
  assert.equal(map.toLeft(150), 50);
  assert.equal(map.toRight(150), 350);
  assert.equal(map.toRight(250), 450);
});

test('format tips name styles and removed marks', () => {
  assert.equal(
    formatTip({
      before: { kind: 'heading', style: 'Heading2', level: 2 },
      after: { kind: 'paragraph', style: '', level: null },
    }),
    '格式：标题 2 → 普通段落',
  );
  assert.equal(formatTip({ before: ['b', 'i'], after: ['b'] }), '格式：去掉斜体');
});
