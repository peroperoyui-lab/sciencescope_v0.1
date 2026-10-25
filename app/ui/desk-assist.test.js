import test from 'node:test';
import assert from 'node:assert/strict';
import { diffArrays } from 'diff';
import {
  changeRuns,
  changeText,
  deskMark,
  deskReference,
  sentenceAround,
  textBlockAt,
  textBlockStart,
  wordDiff,
} from './desk-assist.js';

test('the sentence around the cursor, and the one before at a paragraph end', () => {
  const text = '第一句。第二句很长！第三句';
  const slice = (range) => text.slice(...range);
  assert.equal(slice(sentenceAround(text, 1)), '第一句。');
  assert.equal(slice(sentenceAround(text, 6)), '第二句很长！');
  assert.equal(slice(sentenceAround(text, text.length)), '第三句');
  assert.deepEqual(sentenceAround('只有一句。', 5), [0, 5]);
  assert.deepEqual(sentenceAround('', 0), [0, 0]);
});

test('source blocks are found by offset and counted like the server', () => {
  const text = '# 标题\n\n第一段，\n接着一行。\n\n第二段。\n';
  const second = text.indexOf('第二段');
  assert.equal(textBlockAt(text, 'md', second + 1)?.index, 2);
  assert.equal(textBlockAt(text, 'md', text.indexOf('接着'))?.index, 1);
  assert.equal(textBlockStart(text, 'md', 2), second);
  assert.equal(textBlockStart(text, 'md', 1), text.indexOf('第一段'));
  assert.equal(textBlockStart(text, 'md', 9), null);
});

test('change records read back as runs with before and after text', () => {
  const records = [
    {
      id: 'c1',
      blockId: 'b:1',
      op: 'edit',
      actorId: 'agent_main',
      before: [{ text: '甲乙' }],
      after: [{ text: '甲丙' }],
    },
    {
      id: 'c2',
      blockId: 'b:1',
      op: 'edit',
      actorId: 'agent_main',
      before: [{ text: '甲丙' }],
      after: [{ text: '甲丙丁' }],
    },
    {
      id: 'c3',
      blockId: 'b:1',
      op: 'edit',
      actorId: 'person_user',
      before: [{ text: '甲丙丁' }],
      after: [{ text: '甲' }],
    },
    {
      id: 'c4',
      blockId: 'b:2',
      op: 'insert-block',
      actorId: 'agent_main',
      before: null,
      after: [{ display: '图' }],
    },
  ];
  const runs = changeRuns(records);
  assert.deepEqual(
    runs.map((run) => [run.ids, run.before, run.after, run.op]),
    [
      [['c1', 'c2'], '甲乙', '甲丙丁', 'edit'],
      [['c3'], '甲丙丁', '甲', 'edit'],
      [['c4'], '', '图', 'insert-block'],
    ],
  );
  assert.equal(changeText('﻿原文\n'), '原文');
  assert.equal(changeText({ inlines: [{ text: '删掉的段' }] }), '删掉的段');
});

test('word diff and the mark a desk selection puts in a chat', () => {
  const parts = wordDiff(diffArrays, '98 个地级市', '98 个城市');
  assert.deepEqual(
    parts.filter((part) => part.type !== 'same').map((part) => [part.type, part.text]),
    [
      ['del', '地级市'],
      ['ins', '城市'],
    ],
  );
  const mark = deskMark({
    version: { id: 'version_1', projectId: 'project_1' },
    groupId: 'vgroup_1',
    title: 'thesis.docx',
    blockId: 'b:4',
    paragraph: 5,
    quote: '研究样本',
    from: 0,
    to: 4,
  });
  assert.equal(mark.manuscriptKey, 'project_1/vgroup_1');
  assert.deepEqual(mark.location.characters, { start: 0, end: 4 });
  assert.equal(deskReference(mark)?.id, 'version_1');
  assert.equal(deskReference({ reference: { schema: 1, kind: 'source', id: 's' } }), null);
});
