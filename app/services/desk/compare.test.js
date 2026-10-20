import test from 'node:test';
import assert from 'node:assert/strict';
import { alignVersions } from './compare.js';

function verifyProjection(rows, left, right) {
  assert.equal(rows.map((item) => item.left ?? '').join(''), left.join(''));
  assert.equal(rows.map((item) => item.right ?? '').join(''), right.join(''));
  for (const item of rows) {
    assert.equal(
      item.parts
        .filter((part) => part.type !== 'added')
        .map((part) => part.text)
        .join(''),
      item.left ?? '',
    );
    assert.equal(
      item.parts
        .filter((part) => part.type !== 'removed')
        .map((part) => part.text)
        .join(''),
      item.right ?? '',
    );
  }
}

test('one Chinese sentence changes while normalized anchors preserve original text and block ids', () => {
  const left = ['研究背景。', '样本覆盖２０２０年。就业韧性上升。研究结论稳定。', '后文没有修改。'];
  const right = [
    '研究背景。',
    '样本覆盖2020年。就业韧性显著上升。研究结论稳定。',
    '后文没有修改。',
  ];
  const rows = alignVersions(
    left.map((text, index) => ({ id: `old:${index}`, text })),
    right.map((text, index) => ({ id: `new:${index}`, text })),
  );
  verifyProjection(rows, left, right);
  const edits = rows.filter((item) => item.type !== 'same');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].type, 'changed');
  assert.equal(edits[0].left, '就业韧性上升。');
  assert.equal(edits[0].right, '就业韧性显著上升。');
  assert.equal(edits[0].leftBlock, 'old:1');
  assert.equal(edits[0].rightBlock, 'new:1');
});

test('inserting a paragraph marks only its sentence and preserves later paragraph alignment', () => {
  const left = ['研究背景。', '测度方法保持不变。', '结果讨论保持不变。'];
  const right = [left[0], '新增稳健性检验说明。', ...left.slice(1)];
  const rows = alignVersions(left, right);
  verifyProjection(rows, left, right);
  const edits = rows.filter((item) => item.type !== 'same');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].type, 'added');
  assert.equal(edits[0].right, right[1]);
  assert.equal(edits[0].leftBlock, null);
  assert.equal(edits[0].rightBlock, 1);
  assert.equal(rows.at(-1).type, 'same');
});

test('deleting a paragraph marks only its sentence and preserves later paragraph alignment', () => {
  const left = ['研究背景。', '这一段将被删除。', '测度方法保持不变。', '结果讨论保持不变。'];
  const right = [left[0], ...left.slice(2)];
  const rows = alignVersions(left, right);
  verifyProjection(rows, left, right);
  const edits = rows.filter((item) => item.type !== 'same');
  assert.equal(edits.length, 1);
  assert.equal(edits[0].type, 'removed');
  assert.equal(edits[0].left, left[1]);
  assert.equal(edits[0].leftBlock, 1);
  assert.equal(edits[0].rightBlock, null);
  assert.equal(rows.at(-1).type, 'same');
});

test('splitting a paragraph inside a sentence recovers its unchanged text', () => {
  const left = ['研究背景。', '本研究考察就业韧性。样本涵盖二十座城市。', '后文没有修改。'];
  const right = [left[0], '本研究考察就业', '韧性。样本涵盖二十座城市。', left[2]];
  const rows = alignVersions(left, right);
  verifyProjection(rows, left, right);
  assert.ok(rows.every((item) => item.type === 'same'));
  const sentence = rows.find((item) => item.left === '本研究考察就业韧性。');
  assert.equal(sentence.leftBlock, 1);
  assert.equal(sentence.rightBlock, 1);
});

test('swapping paragraphs stays local as deletion and addition without changing the rest', () => {
  const left = [
    '研究背景。',
    '方法包括空间分析。采用城市样本。',
    '结果呈现区域差异。',
    '后文结论稳定。',
  ];
  const right = [left[0], left[2], left[1], left[3]];
  const rows = alignVersions(left, right);
  verifyProjection(rows, left, right);
  assert.ok(rows.every((item) => item.type !== 'changed'));
  const removed = rows
    .filter((item) => item.type === 'removed')
    .map((item) => item.left)
    .join('');
  const added = rows
    .filter((item) => item.type === 'added')
    .map((item) => item.right)
    .join('');
  assert.equal(removed, added);
  assert.ok([left[1], left[2]].includes(removed));
  assert.equal(rows[0].type, 'same');
  assert.equal(rows.at(-1).type, 'same');
  assert.equal(rows.at(-1).left, left[3]);
});
