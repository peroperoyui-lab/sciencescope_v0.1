// The side-by-side comparison of two versions (U3), worked out from the
// version diff (GET /api/versions/:id/diff): which characters of each page are
// marked, where removed paragraphs leave a gap, the changes 上一处 / 下一处
// steps through, and how one page's scroll position maps onto the other's.
import { t } from './i18n/index.js';

const MARK_NAMES = { b: '加粗', i: '斜体', u: '下划线', sup: '上标', sub: '下标' };

/** The text one inline takes in the diff's offsets. @param {any} inline */
export const inlineText = (inline) => inline.text ?? inline.display ?? '￼';

/** A block's inlines; Markdown and TeX blocks are one run of source text. @param {any} block */
export const inlinesOf = (block) => block.inlines ?? [{ text: block.text ?? '', marks: [] }];

/** @param {any} style */
function styleName(style) {
  if (style.kind === 'heading') return t('标题 {n}', { n: style.level ?? 1 });
  if (style.kind === 'list-item') return t('列表');
  if (style.kind === 'table-cell') return t('表格');
  return style.style || t('普通段落');
}

/** "格式：加粗", "格式：去掉斜体", "格式：标题 2 → 正文". @param {any} change */
export function formatTip(change) {
  if (!Array.isArray(change.before))
    return t('格式：{before} → {after}', {
      before: styleName(change.before),
      after: styleName(change.after),
    });
  const added = change.after.filter((mark) => !change.before.includes(mark));
  const removed = change.before.filter((mark) => !change.after.includes(mark));
  const names = [
    ...added.map((mark) => t(MARK_NAMES[mark] ?? mark)),
    ...removed.map((mark) => t('去掉{name}', { name: t(MARK_NAMES[mark] ?? mark) })),
  ];
  return t('格式：{names}', { names: names.join(t('、')) });
}

/** @param {any[]} ranges @param {number} block */
const of = (ranges, block) =>
  ranges.filter((range) => range.block === block).sort((a, b) => a.from - b.from);

/**
 * The changes inside one paired paragraph, in reading order. Unchanged text is
 * the same on both sides, so walking both pages together lines a deletion up
 * with the insertion at the same place (one 处 for a replaced word).
 * @param {any[]} deleted @param {any[]} inserted @param {any[]} format
 */
export function hunks(deleted, inserted, format) {
  const result = [];
  let i = 0;
  let j = 0;
  let oldAt = 0;
  let newAt = 0;
  while (i < deleted.length || j < inserted.length) {
    const toDelete = i < deleted.length ? deleted[i].from - oldAt : Infinity;
    const toInsert = j < inserted.length ? inserted[j].from - newAt : Infinity;
    const step = Math.max(0, Math.min(toDelete, toInsert));
    oldAt += step;
    newAt += step;
    const hunk = { del: [], ins: [], fmt: [], at: newAt };
    for (;;) {
      if (i < deleted.length && deleted[i].from <= oldAt) {
        hunk.del.push(deleted[i]);
        oldAt = Math.max(oldAt, deleted[i++].to);
      } else if (j < inserted.length && inserted[j].from <= newAt) {
        hunk.ins.push(inserted[j]);
        newAt = Math.max(newAt, inserted[j++].to);
      } else break;
    }
    result.push(hunk);
  }
  for (const change of format) {
    const joined = result.find((hunk) =>
      hunk.ins.some((range) => range.from < change.to && range.to > change.from),
    );
    if (joined) joined.fmt.push(change);
    else result.push({ del: [], ins: [], fmt: [change], at: change.from });
  }
  return result.sort((a, b) => a.at - b.at);
}

/**
 * Marks for each block of both pages and the list of 处.
 * @param {any} result the diff response
 * @returns {{ old: any[], new: any[], stops: { old: number | null, new: number | null }[],
 *   anchors: [number, number][] }}
 * Each page entry is `{ marks: [{from, to, kind: 'del'|'ins'|'fmt', stops, tip?}], block?: {...},
 * gapStart?, gapEnd? }`; a stop names the block on each page to scroll to.
 */
export function compareModel(result) {
  const oldBlocks = result.old?.blocks ?? [];
  const newBlocks = result.new?.blocks ?? [];
  const diff = result.diff ?? {};
  const old = oldBlocks.map(() => ({ marks: [] }));
  const next = newBlocks.map(() => ({ marks: [] }));
  const stops = [];
  /** @type {[number, number][]} */
  const anchors = [];
  const deleted = diff.deleted ?? [];
  const inserted = diff.inserted ?? [];
  const format = diff.format ?? [];
  let pairs = diff.pairs ?? [];
  // An unchanged comparison sends no pairs; the pages line up paragraph by paragraph.
  if (!pairs.length && oldBlocks.length === newBlocks.length)
    pairs = oldBlocks.map((_, index) => ({ old: index, new: index }));
  const mark = (page, block, range, kind, stop, tip) =>
    page[block]?.marks.push({ from: range.from, to: range.to, kind, stops: [stop], tip });
  let lastOld = null;
  let lastNew = null;
  for (let index = 0; index < pairs.length; index++) {
    const pair = pairs[index];
    if (pair.old !== null && pair.new !== null) {
      anchors.push([pair.old, pair.new]);
      for (const hunk of hunks(
        of(deleted, pair.old),
        of(inserted, pair.new),
        of(format, pair.new),
      )) {
        const stop = stops.push({ old: pair.old, new: pair.new }) - 1;
        for (const range of hunk.del) mark(old, pair.old, range, 'del', stop);
        for (const range of hunk.ins) mark(next, pair.new, range, 'ins', stop);
        for (const change of hunk.fmt) {
          const whole = !Array.isArray(change.before);
          if (whole) next[pair.new].block = { stops: [stop], tip: formatTip(change) };
          else mark(next, pair.new, change, 'fmt', stop, formatTip(change));
        }
      }
      lastOld = pair.old;
      lastNew = pair.new;
      continue;
    }
    // A run of paragraphs only one side has is one 处: removed ones leave a gap
    // on the new page, added ones are marked whole.
    const stop = stops.length;
    let removed = 0;
    let firstOld = null;
    let firstNew = null;
    for (
      ;
      index < pairs.length && (pairs[index].old === null || pairs[index].new === null);
      index++
    ) {
      const entry = pairs[index];
      if (entry.new === null) {
        firstOld ??= entry.old;
        removed++;
        for (const range of of(deleted, entry.old)) mark(old, entry.old, range, 'del', stop);
      } else {
        firstNew ??= entry.new;
        for (const range of of(inserted, entry.new)) mark(next, entry.new, range, 'ins', stop);
      }
    }
    index--;
    stops.push({ old: firstOld ?? lastOld, new: firstNew ?? lastNew ?? (next.length ? 0 : null) });
    if (removed && next.length) {
      const gap = {
        stops: [stop],
        tip: removed > 1 ? t('这里删了 {n} 段', { n: removed }) : t('这里删了一段'),
      };
      if (lastNew === null) next[0].gapStart = gap;
      else next[lastNew].gapEnd = gap;
    }
  }
  return { old, new: next, stops, anchors };
}

/**
 * Pieces of one block's inlines cut at the mark edges: each is part of one
 * inline with the marks covering it.
 * @param {any[]} inlines @param {any[]} marks
 * @returns {{ inline: any, text: string, marks: any[] }[]}
 */
export function pieces(inlines, marks) {
  const result = [];
  let offset = 0;
  for (const inline of inlines) {
    const value = inlineText(inline);
    const start = offset;
    const end = offset + value.length;
    offset = end;
    if (inline.atom || !value) {
      result.push({
        inline,
        text: value,
        marks: marks.filter((entry) =>
          value ? entry.from < end && entry.to > start : entry.from === start,
        ),
      });
      continue;
    }
    const cuts = new Set([start, end]);
    for (const entry of marks)
      for (const edge of [entry.from, entry.to]) if (edge > start && edge < end) cuts.add(edge);
    const edges = [...cuts].sort((a, b) => a - b);
    for (let index = 0; index + 1 < edges.length; index++) {
      const from = edges[index];
      const to = edges[index + 1];
      result.push({
        inline,
        text: value.slice(from - start, to - start),
        marks: marks.filter((entry) => entry.from < to && entry.to > from),
      });
    }
  }
  return result;
}

/**
 * A piecewise-linear map between the two pages' scroll positions. Paired
 * paragraphs line up top to top and bottom to bottom; anything between is
 * stretched, so a long insertion on one side scrolls past while the other waits.
 * @param {[number, number][]} points page positions (left, right), any order
 */
export function scrollMap(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const line = [];
  for (const point of sorted) {
    const last = line.at(-1);
    if (!last || (point[0] >= last[0] && point[1] >= last[1])) line.push(point);
  }
  /** @param {number} y @param {0 | 1} from */
  const map = (y, from) => {
    const to = 1 - from;
    if (!line.length) return y;
    if (y <= line[0][from]) return line[0][to] + (y - line[0][from]);
    for (let index = 1; index < line.length; index++) {
      const a = line[index - 1];
      const b = line[index];
      if (y > b[from]) continue;
      const span = b[from] - a[from];
      return span ? a[to] + ((y - a[from]) / span) * (b[to] - a[to]) : b[to];
    }
    const last = line.at(-1);
    return last[to] + (y - last[from]);
  };
  return { toRight: (y) => map(y, 0), toLeft: (y) => map(y, 1) };
}
