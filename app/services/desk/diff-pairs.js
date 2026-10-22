import { diffArrays } from 'diff';
import { bigrams, dice } from './compare.js';

function similar(left, right, before, after, limit) {
  const pairs = [];
  if (left.length * right.length > limit || !left.length || !right.length) {
    left.forEach((_, index) => pairs.push({ old: before + index, new: null }));
    right.forEach((_, index) => pairs.push({ old: null, new: after + index }));
    return { pairs, limited: left.length * right.length > limit };
  }
  const oldGrams = left.map((item) => bigrams(item.key));
  const newGrams = right.map((item) => bigrams(item.key));
  const scores = oldGrams.map((old) => Float64Array.from(newGrams, (next) => dice(old, next)));
  const best = Array.from({ length: left.length + 1 }, () => new Float64Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--)
    for (let j = right.length - 1; j >= 0; j--) {
      const paired = scores[i][j] >= 0.4 ? scores[i][j] + best[i + 1][j + 1] : 0;
      best[i][j] = Math.max(paired, best[i + 1][j], best[i][j + 1]);
    }
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    const score = scores[i]?.[j] ?? 0;
    if (
      i < left.length &&
      j < right.length &&
      score >= 0.4 &&
      best[i][j] === score + best[i + 1][j + 1]
    )
      pairs.push({ old: before + i++, new: after + j++ });
    else if (i < left.length && (j === right.length || best[i + 1][j] >= best[i][j + 1]))
      pairs.push({ old: before + i++, new: null });
    else pairs.push({ old: null, new: after + j++ });
  }
  return { pairs, limited: false };
}

/**
 * Exact anchors first; bound only the quadratic local Dice table, not content.
 * @param {any[]} left
 * @param {any[]} right
 * @param {number} limit
 * @returns {{pairs:{old:number|null,new:number|null}[],limited:boolean}}
 */
export function pairBlocks(left, right, limit) {
  const pairs = [];
  let limited = false;
  let oldIndex = 0;
  let newIndex = 0;
  let oldGap = 0;
  let newGap = 0;
  const flush = () => {
    const gap = similar(
      left.slice(oldIndex - oldGap, oldIndex),
      right.slice(newIndex - newGap, newIndex),
      oldIndex - oldGap,
      newIndex - newGap,
      limit,
    );
    pairs.push(...gap.pairs);
    limited ||= gap.limited;
    oldGap = 0;
    newGap = 0;
  };
  for (const part of diffArrays(left, right, { comparator: (old, next) => old.key === next.key })) {
    if (part.removed) {
      oldGap += part.count;
      oldIndex += part.count;
    } else if (part.added) {
      newGap += part.count;
      newIndex += part.count;
    } else {
      flush();
      for (let index = 0; index < part.count; index++)
        pairs.push({ old: oldIndex++, new: newIndex++ });
    }
  }
  flush();
  return { pairs, limited };
}
