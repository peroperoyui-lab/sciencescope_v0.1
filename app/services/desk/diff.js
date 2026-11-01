import { compareText } from '../versions/comparison.js';
import { describeBlock, MARKS } from './diff-blocks.js';
import { pairBlocks } from './diff-pairs.js';

export const DIFF_ALGORITHM = 4;
const marks = (mask) => MARKS.filter((_, index) => mask & (1 << index));

function addFormat(result, block, from, to, before, after) {
  if (from >= to) return;
  const last = result.format.at(-1);
  if (
    last?.block === block &&
    last.to === from &&
    JSON.stringify(last.before) === JSON.stringify(before) &&
    JSON.stringify(last.after) === JSON.stringify(after)
  )
    last.to = to;
  else result.format.push({ block, from, to, before, after });
}

function mergeRanges(ranges) {
  const merged = [];
  ranges.sort((left, right) => left.block - right.block || left.from - right.from);
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last?.block === range.block && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function characterFormats(old, next, oldStart, newStart, length, block, result) {
  let i = old.runs.findIndex((run) => run.to > oldStart);
  let j = next.runs.findIndex((run) => run.to > newStart);
  let offset = 0;
  while (offset < length && i >= 0 && j >= 0) {
    const before = old.runs[i];
    const after = next.runs[j];
    const count = Math.min(
      before.to - oldStart - offset,
      after.to - newStart - offset,
      length - offset,
    );
    if (before.mask !== after.mask) {
      let from = newStart + offset;
      const to = from + count;
      // A semantic atom replacement is a content change, not unchanged text.
      const beforeMarks = marks(before.mask);
      const afterMarks = marks(after.mask);
      const replaced = result.inserted
        .filter((range) => range.block === block && range.from < to && range.to > from)
        .sort((left, right) => left.from - right.from);
      for (const range of replaced) {
        addFormat(result, block, from, range.from, beforeMarks, afterMarks);
        from = Math.max(from, range.to);
      }
      addFormat(result, block, from, to, beforeMarks, afterMarks);
    }
    offset += count;
    if (oldStart + offset >= before.to) i++;
    if (newStart + offset >= after.to) j++;
  }
}

function compareAtoms(old, next, region, pair, result) {
  const groups = new Map();
  const collect = (atoms, start, side) => {
    for (const atom of atoms) {
      if (atom.to <= atom.from || atom.from < start || atom.to > start + region.length) continue;
      const from = atom.from - start;
      const to = atom.to - start;
      const key = `${from}:${to}`;
      if (!groups.has(key)) groups.set(key, { from, to, before: [], after: [] });
      groups.get(key)[side].push(atom.key);
    }
  };
  collect(old.atoms, region.old, 'before');
  collect(next.atoms, region.new, 'after');
  for (const { from, to, before, after } of groups.values()) {
    // Compare the whole ordered group: reusing the first equal-position atom
    // loses duplicates, while matching by identity alone hides reorderings.
    if (before.length === after.length && before.every((key, index) => key === after[index]))
      continue;
    result.deleted.push({ block: pair.old, from: region.old + from, to: region.old + to });
    result.inserted.push({ block: pair.new, from: region.new + from, to: region.new + to });
  }
}

function comparePair(old, next, pair, result) {
  const oldText = old.block.text;
  const newText = next.block.text;
  const parts =
    oldText === newText ? [{ type: 'unchanged', text: oldText }] : compareText(oldText, newText);
  const unchanged = [];
  let oldOffset = 0;
  let newOffset = 0;
  for (const part of parts) {
    const length = part.text.length;
    if (part.type === 'removed')
      result.deleted.push({ block: pair.old, from: oldOffset, to: oldOffset + length });
    else if (part.type === 'added')
      result.inserted.push({ block: pair.new, from: newOffset, to: newOffset + length });
    else unchanged.push({ old: oldOffset, new: newOffset, length });
    if (part.type !== 'added') oldOffset += length;
    if (part.type !== 'removed') newOffset += length;
  }
  for (const region of unchanged) {
    compareAtoms(old, next, region, pair, result);
    characterFormats(old, next, region.old, region.new, region.length, pair.new, result);
  }
  const style = (item) => ({
    kind: item.kind,
    ...(item.inlines ? { style: item.style ?? '' } : {}),
    level: item.level ?? null,
  });
  const before = style(old.block);
  const after = style(next.block);
  if (JSON.stringify(before) !== JSON.stringify(after))
    result.format.push({ block: pair.new, from: 0, to: newText.length, before, after });
}

/**
 * Positions are UTF-16 offsets in original block text, never normalized text.
 * Private descriptors carry atom XML hashes; ordinary block lists also work.
 * @param {any[]} before
 * @param {any[]} after
 * @param {{gapLimit?:number}} [options]
 * @returns {any}
 */
export function diffVersions(before, after, { gapLimit = 250000 } = {}) {
  const items = (blocks) => blocks.map((block) => (block.block ? block : describeBlock(block)));
  const old = items(before);
  const next = items(after);
  const aligned = pairBlocks(old, next, gapLimit);
  const result = {
    algorithm: DIFF_ALGORITHM,
    status: 'ready',
    pairs: aligned.pairs,
    deleted: [],
    inserted: [],
    format: [],
    removedAt: [],
    counts: { deleted: 0, inserted: 0, format: 0 },
    limited: aligned.limited,
  };
  let preceding = -1;
  for (const pair of aligned.pairs) {
    if (pair.new === null) {
      result.deleted.push({ block: pair.old, from: 0, to: old[pair.old].block.text.length });
      result.removedAt.push({ old: pair.old, after: preceding });
    } else {
      if (pair.old === null)
        result.inserted.push({ block: pair.new, from: 0, to: next[pair.new].block.text.length });
      else comparePair(old[pair.old], next[pair.new], pair, result);
      preceding = pair.new;
    }
  }
  result.deleted = mergeRanges(result.deleted);
  result.inserted = mergeRanges(result.inserted);
  result.counts = {
    deleted: result.deleted.length,
    inserted: result.inserted.length,
    format: result.format.length,
  };
  if (!result.counts.deleted && !result.counts.inserted && !result.counts.format) {
    result.status = 'unchanged';
    result.pairs = [];
  }
  return result;
}
