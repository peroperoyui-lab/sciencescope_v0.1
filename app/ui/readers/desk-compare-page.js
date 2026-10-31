// One page of the version comparison, drawn straight into the DOM: a thesis
// has thousands of paragraphs and the pages are only read, never edited.
import { headingLevel, MARKS } from '../desk-blocks.js';
import { inlinesOf, pieces } from '../desk-compare.js';
import { t } from '../i18n/index.js';
import { atomElement } from './desk-atoms.js';

const CLASSES = { del: 'ss-diff-del', ins: 'ss-rev-ins', fmt: 'ss-diff-fmt' };
const TAGS = { b: 'strong', i: 'em', u: 'u', sup: 'sup', sub: 'sub' };

/** @param {HTMLElement} element @param {number[]} stops */
export const tagStops = (element, stops) => element.setAttribute('data-stops', stops.join(' '));

/** @param {{ stops: number[], tip: string }} gap */
export function gapElement(gap) {
  const element = document.createElement('span');
  element.className = 'ss-diff-gap';
  element.setAttribute('data-tip', gap.tip);
  element.setAttribute('aria-label', gap.tip);
  tagStops(element, gap.stops);
  return element;
}

/** @param {any} piece @param {((ref: any) => Promise<string>) | null} media */
function pieceNode(piece, media) {
  /** @type {Node} */
  let node;
  if (piece.inline.atom) node = atomElement(piece.inline, media);
  else {
    node = document.createTextNode(piece.text);
    for (const mark of MARKS) {
      if (!piece.inline.marks?.includes(mark)) continue;
      const wrap = document.createElement(TAGS[mark]);
      wrap.append(node);
      node = wrap;
    }
  }
  if (!piece.marks.length) return node;
  const kinds = new Set(piece.marks.map((entry) => entry.kind));
  const kind = kinds.has('ins') ? 'ins' : kinds.has('del') ? 'del' : 'fmt';
  const span = document.createElement('span');
  span.className = CLASSES[kind];
  const tip = piece.marks.find((entry) => entry.tip)?.tip;
  if (kind === 'fmt' && tip) span.setAttribute('data-tip', tip);
  tagStops(span, [...new Set(piece.marks.flatMap((entry) => entry.stops))]);
  span.append(node);
  return span;
}

/** @param {any} block @param {boolean} source */
function blockElement(block, source) {
  if (source) {
    const element = document.createElement('p');
    element.className = `ss-cmp__src${block.kind === 'heading' ? ' ss-cmp__src--head' : ''}`;
    return element;
  }
  if (block.kind === 'opaque') {
    const element = document.createElement('div');
    element.className = 'ss-desk-opaque';
    element.setAttribute('data-tip', t('跨段落的域：编辑台保留原样，可在 Word 里修改'));
    return element;
  }
  const level = headingLevel(block);
  const element = document.createElement(level ? `h${level}` : 'p');
  if (block.kind === 'list-item') element.className = 'ss-page__li';
  return element;
}

/**
 * Fill `article` with the blocks and their marks; returns each block's element,
 * in block order, for the scroll map and 上一处 / 下一处.
 * @param {HTMLElement} article @param {any[]} blocks @param {any[]} entries from compareModel
 * @param {{ source: boolean, media?: ((ref: any) => Promise<string>) | null }} options
 *   Markdown and TeX show their source text; `media` gives a Word picture's URL
 * @returns {HTMLElement[]}
 */
export function renderComparePage(article, blocks, entries, { source, media = null }) {
  const fragment = document.createDocumentFragment();
  const elements = [];
  let table = null;
  let row = null;
  let cell = null;
  blocks.forEach((block, index) => {
    const entry = entries[index] ?? { marks: [] };
    const element = blockElement(block, source);
    if (entry.gapStart) element.append(gapElement(entry.gapStart));
    for (const piece of pieces(inlinesOf(block), entry.marks))
      element.append(pieceNode(piece, media));
    if (block.kind === 'opaque' && !element.textContent) element.textContent = '…';
    if (entry.gapEnd) element.append(gapElement(entry.gapEnd));
    if (entry.block) {
      element.classList.add('ss-diff-fmt');
      element.setAttribute('data-tip', entry.block.tip);
      tagStops(element, entry.block.stops);
    }
    elements.push(element);
    const place = !source && block.cell;
    if (!place) {
      table = row = cell = null;
      fragment.append(element);
      return;
    }
    if (table?.dataset.key !== String(place.table)) {
      table = document.createElement('table');
      table.dataset.key = String(place.table);
      table.append(document.createElement('tbody'));
      row = cell = null;
      fragment.append(table);
    }
    if (row?.dataset.key !== String(place.row)) {
      row = document.createElement('tr');
      row.dataset.key = String(place.row);
      cell = null;
      table.firstChild.append(row);
    }
    if (cell?.dataset.key !== String(place.cell)) {
      cell = document.createElement('td');
      cell.dataset.key = String(place.cell);
      row.append(cell);
    }
    cell.append(element);
  });
  article.replaceChildren(fragment);
  return elements;
}
