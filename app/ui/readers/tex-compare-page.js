// One page of a TeX version comparison drawn as the rendered page instead of
// the source: the blocks are joined back into the file, rendered with source
// positions (tex-render.js), and the differences are marked on the text they
// came from. A formula with a change inside is marked as a whole. Each
// comparison block gets a wrapper holding the rendered blocks that start in
// it, so the scroll map and 上一处 / 下一处 work as on the source page.
import { renderTex } from '../tex-render.js';
import { gapElement, tagStops } from './desk-compare-page.js';

const CLASSES = { del: 'ss-diff-del', ins: 'ss-rev-ins', fmt: 'ss-diff-fmt' };

/** @param {string} html one element */
function element(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return /** @type {HTMLElement} */ (template.content.firstElementChild);
}

/** The strongest kind among marks: an insertion or deletion over a format change. @param {any[]} marks */
const kindOf = (marks) => {
  const kinds = new Set(marks.map((entry) => entry.kind));
  return kinds.has('ins') ? 'ins' : kinds.has('del') ? 'del' : 'fmt';
};

/** @param {HTMLElement} target @param {any[]} marks */
function markElement(target, marks) {
  target.classList.add(CLASSES[kindOf(marks)]);
  const tip = marks.find((entry) => entry.tip)?.tip;
  if (tip) target.setAttribute('data-tip', tip);
  tagStops(target, [...new Set(marks.flatMap((entry) => entry.stops))]);
}

/**
 * @param {HTMLElement} article @param {any[]} blocks the version's TeX blocks
 * @param {any[]} entries from compareModel, one per block
 * @returns {HTMLElement[]} each block's wrapper, in block order
 */
export function renderTexComparePage(article, blocks, entries) {
  const starts = [];
  let text = '';
  blocks.forEach((block, index) => {
    if (index) text += '\n\n';
    starts.push(text.length);
    text += block.text ?? '';
  });
  /** The block that position `at` of the joined text falls in. @param {number} at */
  const ownerOf = (at) => {
    let index = 0;
    while (index + 1 < starts.length && starts[index + 1] <= at) index++;
    return index;
  };
  // Every mark at its place in the joined text.
  const marks = entries.flatMap((entry, index) =>
    (entry?.marks ?? [])
      .filter((mark) => mark.to > mark.from)
      .map((mark) => ({ ...mark, from: starts[index] + mark.from, to: starts[index] + mark.to })),
  );
  const wrappers = blocks.map(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'ss-cmp__block';
    return wrapper;
  });
  for (const item of renderTex(text, { positions: true }).blocks) {
    const node = element(item.html);
    wrappers[ownerOf(item.from)].append(node);
    // Copied text: split where marks start and end, and wrap the marked parts.
    for (const span of node.querySelectorAll('[data-o]')) {
      const start = item.from + Number(/** @type {HTMLElement} */ (span).dataset.o);
      const value = span.textContent ?? '';
      const end = start + value.length;
      const covering = marks.filter((mark) => mark.from < end && mark.to > start);
      if (!covering.length) continue;
      const cuts = new Set([start, end]);
      for (const mark of covering)
        for (const edge of [mark.from, mark.to]) if (edge > start && edge < end) cuts.add(edge);
      const edges = [...cuts].sort((a, b) => a - b);
      const parts = [];
      for (let index = 0; index + 1 < edges.length; index++) {
        const [from, to] = [edges[index], edges[index + 1]];
        const piece = document.createTextNode(value.slice(from - start, to - start));
        const on = covering.filter((mark) => mark.from < to && mark.to > from);
        if (!on.length) parts.push(piece);
        else {
          const wrap = document.createElement('span');
          markElement(wrap, on);
          wrap.append(piece);
          parts.push(wrap);
        }
      }
      span.replaceChildren(...parts);
    }
    // Formulas are drawn by KaTeX: a change anywhere inside marks the whole formula.
    for (const box of node.querySelectorAll('.ss-eqbox[data-eq]')) {
      const [a, b] = /** @type {HTMLElement} */ (box).dataset.eq.split(',').map(Number);
      const on = marks.filter((mark) => mark.from < item.from + b && mark.to > item.from + a);
      if (on.length) markElement(/** @type {HTMLElement} */ (box), on);
    }
  }
  entries.forEach((entry, index) => {
    const wrapper = wrappers[index];
    if (entry?.gapStart) wrapper.prepend(gapElement(entry.gapStart));
    if (entry?.gapEnd) wrapper.append(gapElement(entry.gapEnd));
    if (entry?.block) markElement(wrapper, [{ kind: 'fmt', ...entry.block }]);
  });
  article.replaceChildren(...wrappers);
  return wrappers;
}
