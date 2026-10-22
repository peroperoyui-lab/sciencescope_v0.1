import { diffChars } from 'diff';
import { AppError } from '../../core/errors.js';

/**
 * Comment delimiters have no visible width; other atoms retain their display.
 * @param {any} block
 * @returns {string}
 */
export function annotationText(block) {
  return block.inlines
    ? block.inlines.map((part) => part.text ?? part.display ?? '\uFFFC').join('')
    : block.text;
}

/**
 * @param {string} text
 * @param {number} from
 * @param {number} to
 * @returns {{exact:string,prefix:string,suffix:string}}
 */
export function quoteAt(text, from, to) {
  return {
    exact: text.slice(from, to),
    prefix: Array.from(text.slice(0, from)).slice(-32).join(''),
    suffix: Array.from(text.slice(to)).slice(0, 32).join(''),
  };
}

/**
 * Track surviving original characters. Insertions between them extend the mark;
 * replacing its last original character removes it, even if new text is added.
 * @param {string} before
 * @param {string} after
 * @param {{from:number,to:number}} range
 * @returns {{from:number,to:number}|null}
 */
export function mapRange(before, after, range) {
  let oldOffset = 0,
    newOffset = 0;
  let from = null,
    to = null;
  for (const part of diffChars(before, after)) {
    const length = part.value.length;
    if (!part.added && !part.removed) {
      const start = Math.max(oldOffset, range.from);
      const end = Math.min(oldOffset + length, range.to);
      if (start < end) {
        from ??= newOffset + start - oldOffset;
        to = newOffset + end - oldOffset;
      }
    }
    if (!part.added) oldOffset += length;
    if (!part.removed) newOffset += length;
  }
  return from == null ? null : { from, to };
}

/**
 * @param {any[]} blocks
 * @param {any} item
 * @param {boolean} forceSearch
 * @returns {any|null}
 */
export function relocate(blocks, item, forceSearch = false) {
  const exact = item.quote.exact;
  if (!exact) return null;
  const original = blocks.find((block) => block.id === item.blockId);
  if (!forceSearch && original && annotationText(original).slice(item.from, item.to) === exact)
    return { blockId: item.blockId, from: item.from, to: item.to };
  const hits = [];
  for (const block of blocks) {
    const text = annotationText(block);
    for (let from = text.indexOf(exact); from >= 0; from = text.indexOf(exact, from + 1)) {
      const to = from + exact.length;
      hits.push({ blockId: block.id, from, to, text });
    }
  }
  const contextual =
    hits.length > 1
      ? hits.filter(
          (hit) =>
            (!item.quote.prefix || hit.text.slice(0, hit.from).endsWith(item.quote.prefix)) &&
            (!item.quote.suffix || hit.text.slice(hit.to).startsWith(item.quote.suffix)),
        )
      : hits;
  if (contextual.length !== 1) return null;
  const { blockId, from, to } = contextual[0];
  return { blockId, from, to };
}

/**
 * Split editable text at UTF-16 boundaries, never split an indivisible atom.
 * @param {any[]} inlines
 * @param {number[]} boundaries
 * @returns {any[]}
 */
export function splitInlines(inlines, boundaries) {
  let offset = 0;
  return inlines.flatMap((inline) => {
    const text = inline.text ?? inline.display ?? '\uFFFC';
    const cuts = boundaries.filter((at) => at > offset && at < offset + text.length);
    if (inline.atom && cuts.length)
      throw new AppError('DESK_ATOM_CHANGED', '批注或索引的范围不能切开公式、引文或图片。');
    const start = offset;
    offset += text.length;
    if (inline.atom || !cuts.length) return [inline];
    return [start, ...cuts, offset].slice(0, -1).map((at, index) => ({
      ...inline,
      text: text.slice(at - start, [...cuts, offset][index] - start),
    }));
  });
}
