// Paragraph anchors contain each edit. Sentence anchors then recover splits
// and joins; Dice pairing only examines the remaining local sentence gaps.
import { diffArrays } from 'diff';
import { compareText } from '../versions/comparison.js';

const sentenceSegmenter = new Intl.Segmenter('zh', { granularity: 'sentence' });
const normalize = (text) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();

/**
 * @typedef {{text:string,block:string|number}} Item
 * @typedef {{type:'same'|'changed'|'added'|'removed',left:string|null,right:string|null,
 * parts:{type:string,text:string}[],leftBlock:string|number|null,rightBlock:string|number|null}} Row
 */

function row(left, right) {
  let type = 'same';
  if (!left) type = 'added';
  else if (!right) type = 'removed';
  else if (normalize(left.text) !== normalize(right.text)) type = 'changed';
  return {
    type,
    left: left?.text ?? null,
    right: right?.text ?? null,
    parts: compareText(left?.text ?? '', right?.text ?? ''),
    leftBlock: left?.block ?? null,
    rightBlock: right?.block ?? null,
  };
}

function alignAnchors(left, right, alignGap) {
  const rows = [];
  let leftIndex = 0;
  let rightIndex = 0;
  let pendingLeft = [];
  let pendingRight = [];
  for (const part of diffArrays(left, right, {
    comparator: (before, after) => normalize(before.text) === normalize(after.text),
  })) {
    const count = part.value.length;
    if (part.removed) {
      pendingLeft.push(...left.slice(leftIndex, leftIndex + count));
      leftIndex += count;
    } else if (part.added) {
      pendingRight.push(...right.slice(rightIndex, rightIndex + count));
      rightIndex += count;
    } else {
      rows.push(...alignGap(pendingLeft, pendingRight));
      pendingLeft = [];
      pendingRight = [];
      for (let index = 0; index < count; index++)
        rows.push(row(left[leftIndex++], right[rightIndex++]));
    }
  }
  return rows.concat(alignGap(pendingLeft, pendingRight));
}

function sentenceItems(blocks) {
  let offset = 0;
  const ranges = blocks.map((block) => {
    const start = offset;
    offset += block.text.length;
    return { ...block, start, end: offset };
  });
  const text = blocks.map((block) => block.text).join('');
  let blockIndex = 0;
  return Array.from(sentenceSegmenter.segment(text), ({ segment, index }) => {
    while (blockIndex + 1 < ranges.length && ranges[blockIndex].end <= index) blockIndex++;
    return { text: segment, block: ranges[blockIndex].block };
  });
}

/**
 * @param {string} text
 * @returns {{counts:Map<string,number>,size:number}}
 */
export function bigrams(text) {
  const letters = Array.from(normalize(text));
  const counts = new Map();
  for (let index = 1; index < letters.length; index++) {
    const pair = letters[index - 1] + letters[index];
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return { counts, size: Math.max(0, letters.length - 1) };
}

/**
 * @param {ReturnType<typeof bigrams>} left
 * @param {ReturnType<typeof bigrams>} right
 * @returns {number}
 */
export function dice(left, right) {
  const total = left.size + right.size;
  if (!total) return 0;
  let overlap = 0;
  for (const [pair, count] of left.counts) overlap += Math.min(count, right.counts.get(pair) ?? 0);
  return (2 * overlap) / total;
}

function alignSimilar(left, right, threshold) {
  const leftPairs = left.map((item) => bigrams(item.text));
  const rightPairs = right.map((item) => bigrams(item.text));
  const scores = leftPairs.map((before) => rightPairs.map((after) => dice(before, after)));
  const best = Array.from({ length: left.length + 1 }, () => new Float64Array(right.length + 1));
  // A weighted, monotone pairing keeps both document orders. A moved paragraph
  // remains a local deletion/addition rather than reordering the whole view.
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      const score = scores[i][j];
      const paired = score >= threshold && score > 0 ? score + best[i + 1][j + 1] : 0;
      best[i][j] = Math.max(paired, best[i + 1][j], best[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    const score = scores[i]?.[j] ?? 0;
    if (
      i < left.length &&
      j < right.length &&
      score >= threshold &&
      score > 0 &&
      best[i][j] === score + best[i + 1][j + 1]
    ) {
      rows.push(row(left[i++], right[j++]));
    } else if (i < left.length && (j === right.length || best[i + 1][j] >= best[i][j + 1])) {
      rows.push(row(left[i++], null));
    } else {
      rows.push(row(null, right[j++]));
    }
  }
  return rows;
}

/**
 * Normalize only for matching; all displayed text retains its original form.
 * Block references are caller ids or zero-based input indices. A sentence
 * crossing a paragraph split points to the first block containing its text.
 * @param {(string|{text:string,id?:string})[]} left
 * @param {(string|{text:string,id?:string})[]} right
 * @param {{threshold?:number}} [options]
 * @returns {Row[]}
 */
export function alignVersions(left, right, { threshold = 0.5 } = {}) {
  const items = (blocks) =>
    blocks.map((block, index) => ({
      text: typeof block === 'string' ? block : block.text,
      block: typeof block === 'string' ? index : (block.id ?? index),
    }));
  return alignAnchors(items(left), items(right), (before, after) =>
    alignAnchors(sentenceItems(before), sentenceItems(after), (oldSentences, newSentences) =>
      alignSimilar(oldSentences, newSentences, threshold),
    ),
  );
}
