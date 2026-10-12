// Compare parser text, never original bytes. Segmenter preserves Chinese words;
// whitespace is retained so joining the projection reconstructs each text.
import { diffArrays } from 'diff';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

/**
 * @param {string} before
 * @param {string} after
 */
export function compareText(before, after) {
  const words = (text) => Array.from(segmenter.segment(text), (entry) => entry.segment);
  return diffArrays(words(before), words(after)).map((part) => ({
    type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
    text: part.value.join(''),
  }));
}

const sentences = new Intl.Segmenter('zh', { granularity: 'sentence' });

function paragraphIndex(blocks) {
  let offset = 0;
  return blocks.map((block, index) => {
    const start = offset;
    offset += block.text.length + 2;
    return { number: index + 1, start, end: offset - 2 };
  });
}

function paragraphAt(index, offset) {
  let left = 0;
  let right = index.length - 1;
  while (left < right) {
    const middle = Math.ceil((left + right) / 2);
    if (index[middle].start <= offset) left = middle;
    else right = middle - 1;
  }
  return index[left]?.number ?? 0;
}

function ranges(numbers) {
  const result = [];
  for (const number of [...numbers].sort((a, b) => a - b)) {
    const last = result.at(-1);
    if (last && number === last.end + 1) last.end = number;
    else result.push({ start: number, end: number });
  }
  return (
    result
      .map(({ start, end }) => (start === end ? String(start) : `${start}–${end}`))
      .join('、') || '无'
  );
}

/**
 * Every non-unchanged part appears exactly once. Context is up to two neighbouring
 * sentences, not an arbitrary character budget; paragraph IDs use the same
 * parser blocks and zero-based offsets as workspace_read.
 * @param {{changes:{type:string,text:string}[],current:{blocks:{text:string}[]},previous:{blocks:{text:string}[]}|null}} compared
 * @returns {{text:string,count:number,locations:string}}
 */
export function changeSummary(compared) {
  const currentIndex = paragraphIndex(compared.current.blocks);
  if (!compared.previous)
    return {
      count: 0,
      locations: '无',
      text: `首版导入，无比较基线，不代表发生了修改。共 0 处改动。当前第 1–${currentIndex.length} 段原文可用 workspace_read 按段读取。`,
    };
  const oldIndex = paragraphIndex(compared.previous.blocks);
  const touchedOld = new Set();
  const touchedNew = new Set();
  const hunks = [];
  let oldOffset = 0;
  let newOffset = 0;
  for (let position = 0; position < compared.changes.length;) {
    const part = compared.changes[position];
    if (part.type === 'unchanged') {
      oldOffset += part.text.length;
      newOffset += part.text.length;
      position++;
      continue;
    }
    const oldStart = oldOffset;
    const newStart = newOffset;
    const before = compared.changes[position - 1]?.text ?? '';
    const content = [];
    while (position < compared.changes.length && compared.changes[position].type !== 'unchanged') {
      const changed = compared.changes[position++];
      if (changed.type === 'removed') {
        oldOffset += changed.text.length;
        content.push(`[-${changed.text}-]`);
      } else {
        newOffset += changed.text.length;
        content.push(`{+${changed.text}+}`);
      }
    }
    const oldFirst = paragraphAt(oldIndex, oldStart);
    const oldLast = paragraphAt(oldIndex, Math.max(oldStart, oldOffset - 1));
    const newFirst = paragraphAt(currentIndex, newStart);
    const newLast = paragraphAt(currentIndex, Math.max(newStart, newOffset - 1));
    for (let number = oldFirst; number <= oldLast; number++) touchedOld.add(number);
    for (let number = newFirst; number <= newLast; number++) touchedNew.add(number);
    const after = compared.changes[position]?.text ?? '';
    const availableBefore = Math.min(
      oldStart - (oldIndex[oldFirst - 1]?.start ?? 0),
      newStart - (currentIndex[newFirst - 1]?.start ?? 0),
    );
    const localBefore = before.slice(Math.max(0, before.length - availableBefore));
    const prefix = [...sentences.segment(localBefore)]
      .slice(-2)
      .map((entry) => entry.segment)
      .join('');
    const availableAfter = Math.max(
      0,
      Math.min(
        (oldIndex[oldLast - 1]?.end ?? oldOffset) - oldOffset,
        (currentIndex[newLast - 1]?.end ?? newOffset) - newOffset,
      ),
    );
    const suffix = [...sentences.segment(after.slice(0, availableAfter))]
      .slice(0, 2)
      .map((entry) => entry.segment)
      .join('');
    const last = hunks.at(-1);
    if (last && oldFirst <= last.oldLast && newFirst <= last.newLast) {
      last.content += before + content.join('');
      last.oldLast = oldLast;
      last.newLast = newLast;
      last.suffix = suffix;
    } else
      hunks.push({
        oldFirst,
        oldLast,
        newFirst,
        newLast,
        prefix,
        content: content.join(''),
        suffix,
      });
  }
  const rendered = hunks.map(
    (hunk, index) =>
      `变化 ${index + 1} · 旧第 ${hunk.oldFirst}–${hunk.oldLast} 段 → 新第 ${hunk.newFirst}–${hunk.newLast} 段\n${hunk.prefix}${hunk.content}${hunk.suffix}`,
  );

  const locations = `旧第 ${ranges(touchedOld)} 段；新第 ${ranges(touchedNew)} 段`;
  const untouched = (index, touched) =>
    ranges(
      new Set(index.filter((entry) => !touched.has(entry.number)).map((entry) => entry.number)),
    );
  return {
    count: hunks.length,
    locations,
    text: `共 ${hunks.length} 处改动，位于${locations}。以下一处不少；[- -] 为删除，{+ +} 为新增，连在一起为替换。\n\n${rendered.join('\n\n')}\n\n其余旧第 ${untouched(oldIndex, touchedOld)} 段、新第 ${untouched(currentIndex, touchedNew)} 段未改动。正文不重复发送，可用 workspace_read target=versions 按段读取，offset=段落号-1，limit=所需段落数。`,
  };
}
