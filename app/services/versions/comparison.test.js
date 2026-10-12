import test from 'node:test';
import assert from 'node:assert/strict';
import { compareText, changeSummary } from './comparison.js';

function comparison(before, after) {
  return {
    previous: { blocks: before.map((text) => ({ text })) },
    current: { blocks: after.map((text) => ({ text })) },
    changes: compareText(before.join('\n\n'), after.join('\n\n')),
  };
}

test('change text preserves every changed span, exact paragraph ranges and neighbouring sentences without unchanged paragraphs', () => {
  const before = [
    '完整未改段落不应发送。',
    '背景第一句。背景第二句。研究使用社会刺激。用户画像分析。最后一句。',
    '另一个完整未改段落。',
  ];
  const after = [
    before[0],
    '背景第一句。背景第二句。研究使用环境刺激。用户聚类情况。最后一句。',
    before[2],
  ];
  const summary = changeSummary(comparison(before, after));
  assert.equal(summary.count, 1);
  assert.match(summary.text, /共 1 处改动/u);
  assert.match(summary.text, /旧第 2–2 段 → 新第 2–2 段/u);
  assert.match(summary.text, /\[-社会-\]\{\+环境\+\}/u);
  assert.match(summary.text, /\[-画像分析-\]\{\+聚类情况\+\}/u);
  assert.match(summary.text, /背景第二句。研究使用/u);
  assert.match(summary.text, /其余旧第 1、3 段、新第 1、3 段未改动/u);
  assert.ok(!summary.text.includes(before[0]));
  assert.ok(!summary.text.includes(before[2]));
  assert.match(summary.text, /offset=段落号-1/);
});

test('hundreds of changes have no omissions or repeated changed words and metadata never becomes comparison text', () => {
  const before = Array.from({ length: 150 }, (_, index) => `第${index}段前文。old${index}。后文。`);
  const after = before.map((text, index) => text.replace(`old${index}`, `new${index}`));
  const data = {
    ...comparison(before, after),
    name: '文件…名.pdf',
    originalPath: 'metadata/文件名.pdf',
  };
  const summary = changeSummary(data);
  assert.equal(summary.count, 150);
  for (const part of data.changes.filter((entry) => entry.type !== 'unchanged')) {
    const marked = part.type === 'added' ? `{+${part.text}+}` : `[-${part.text}-]`;
    assert.ok(summary.text.includes(marked));
  }
  const actual = [...summary.text.matchAll(/\[-([\s\S]*?)-\]|\{\+([\s\S]*?)\+\}/g)]
    .filter((match) => match[1] !== ' ' && match[2] !== ' ')
    .map((match) => ({
      type: match[1] !== undefined ? 'removed' : 'added',
      text: match[1] ?? match[2],
    }));
  assert.deepEqual(
    actual,
    data.changes.filter((entry) => entry.type !== 'unchanged'),
  );
  assert.equal((summary.text.match(/^变化 \d+/gm) ?? []).length, 150);
  assert.ok(!summary.text.includes(data.name));
  assert.ok(!summary.text.includes(data.originalPath));
  assert.equal(changeSummary({ ...data, previous: null }).count, 0);
});
