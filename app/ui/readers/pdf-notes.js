// Comments and indexes on a PDF in the desk (U6c). The PDF stays as it is:
// selections in pdf.js's text layer are placed in the session's PDF blocks
// (pdf-text.js), and anchored items are drawn as boxes under the text layer,
// redrawn whenever pdf.js renders a page's text again.

import { findOnPage, placeOnPage, skeleton } from '../pdf-text.js';

/** @param {Node | null} node */
const elementOf = (node) =>
  /** @type {HTMLElement | null} */ (node?.nodeType === 1 ? node : (node?.parentElement ?? null));

/**
 * A page's text layer as skeleton characters, each with its text node and offset.
 * @param {HTMLElement} page
 */
function pageText(page) {
  const layer = page.querySelector('.textLayer');
  const nodes = [];
  let chars = '';
  if (!layer) return { chars, nodes };
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = /** @type {Text} */ (node);
    const found = skeleton(text.data);
    chars += found.chars;
    for (const offset of found.at) nodes.push({ node: text, offset });
  }
  return { chars, nodes };
}

/**
 * @param {HTMLElement} surface the PDF reader's surface
 * @param {{ viewer: any, eventBus: any }} reader from mountPdf
 * @param {{ blocks: { id: string, text: string, page: number }[], onSelection?: () => void }} options
 */
export function mountPdfNotes(surface, reader, { blocks, onSelection }) {
  const { viewer, eventBus } = reader;
  const scroller = /** @type {HTMLElement} */ (surface.firstElementChild);
  const byId = new Map(blocks.map((block, index) => [block.id, { block, index }]));
  /** @type {any[]} */
  let items = [];
  /** @type {string | null} */
  let active = null;
  /** @type {{ x: number, y: number } | null} */
  let point = null;
  /** @type {{ blockId: string, from: number, to: number } | null} */
  let pending = null;

  const pageElement = (number) =>
    /** @type {HTMLElement | null} */ (
      surface.querySelector(`.page[data-page-number="${number}"]`)
    );
  const rendered = (page) => !!page?.querySelector('.textLayer')?.firstChild;

  /** A DOM range over skeleton characters `start`..`end` of a page. */
  function rangeOf(text, start, end) {
    const first = text.nodes[start];
    const last = text.nodes[end - 1];
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, Math.min(last.node.length, last.offset + 1));
    return range;
  }

  /** Where an item's words are on its page, or null. */
  function rangeFor(page, text, item) {
    const found = byId.get(item.blockId);
    if (!found) return null;
    const at = findOnPage(text.chars, found.block.text, item.from, item.to);
    return at ? rangeOf(text, at[0], at[1]) : null;
  }

  /** Draw the anchored items of one page. @param {number} number */
  function draw(number) {
    const page = pageElement(number);
    if (!page) return;
    page.querySelector('.ss-pdf-marks')?.remove();
    if (!rendered(page)) return;
    const shown = items.filter(
      (item) => !item.quiet && byId.get(item.blockId)?.block.page === number,
    );
    const layer = document.createElement('div');
    layer.className = 'ss-pdf-marks';
    const text = pageText(page);
    const box = page.getBoundingClientRect();
    const width = page.clientWidth || 1;
    const height = page.clientHeight || 1;
    for (const item of shown) {
      const range = rangeFor(page, text, item);
      if (!range) continue;
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue;
        const mark = document.createElement('div');
        mark.className = 'ss-pdf-mark';
        mark.dataset.type = item.type;
        mark.dataset.note = item.id;
        if (item.id === active) mark.dataset.active = '';
        const left = rect.left - box.left - page.clientLeft;
        const top = rect.top - box.top - page.clientTop;
        Object.assign(mark.style, {
          left: `${(left / width) * 100}%`,
          top: `${(top / height) * 100}%`,
          width: `${(rect.width / width) * 100}%`,
          height: `${(rect.height / height) * 100}%`,
        });
        layer.append(mark);
      }
    }
    page.querySelector('.textLayer')?.before(layer);
  }

  const drawAll = () => {
    for (const page of surface.querySelectorAll('.page[data-page-number]'))
      draw(Number(/** @type {HTMLElement} */ (page).dataset.pageNumber));
  };

  /** Scroll the words of `pending` into view once their page has text. */
  function showPending() {
    if (!pending) return;
    const found = byId.get(pending.blockId);
    if (!found) {
      pending = null;
      return;
    }
    const page = pageElement(found.block.page);
    if (!rendered(page)) return;
    const range = rangeFor(page, pageText(page), pending);
    pending = null;
    const rect = (range ?? page).getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (rect.top < view.top + 40 || rect.bottom > view.bottom - 40)
      scroller.scrollTop += rect.top - view.top - view.height / 3;
  }

  const onText = ({ pageNumber }) => {
    draw(pageNumber);
    if (pending && byId.get(pending.blockId)?.block.page === pageNumber) showPending();
  };
  eventBus.on('textlayerrendered', onText);

  // A click (not a drag) on a marked word lights up its card.
  const up = (event) => {
    point = { x: event.clientX, y: event.clientY };
    requestAnimationFrame(() => onSelection?.());
  };
  surface.addEventListener('pointerup', up);

  return {
    /**
     * The selected words, placed in a session block when they are inside one.
     * @returns {{ blockId: string | null, from: number | null, to: number | null, quote: string,
     *   rect: DOMRect } | null}
     */
    selection() {
      const selected = getSelection();
      if (!selected?.rangeCount || selected.isCollapsed) return null;
      const range = selected.getRangeAt(0);
      const page = elementOf(range.startContainer)?.closest('.page');
      if (!(page instanceof HTMLElement) || !surface.contains(page)) return null;
      const typed = selected.toString();
      if (!typed.trim()) return null;
      const rect = range.getBoundingClientRect();
      const same = elementOf(range.endContainer)?.closest('.page') === page;
      const text = pageText(page);
      // Characters wholly inside the selection.
      const inside = text.nodes.flatMap((entry, index) =>
        range.comparePoint(entry.node, entry.offset) === 0 &&
        range.comparePoint(entry.node, Math.min(entry.node.length, entry.offset + 1)) === 0
          ? [index]
          : [],
      );
      const number = Number(page.dataset.pageNumber);
      const place =
        same && inside.length
          ? placeOnPage(
              text.chars,
              inside[0],
              inside.at(-1) + 1,
              blocks.filter((block) => block.page === number),
            )
          : null;
      if (!place) return { blockId: null, from: null, to: null, quote: typed.trim(), rect };
      const block = /** @type {any} */ (byId.get(place.blockId)).block;
      return { ...place, quote: block.text.slice(place.from, place.to), rect };
    },
    /** A PDF has no caret to grow into a sentence. */
    selectSentence() {},
    /** @param {number} x @param {number} y */
    caretAt(x, y) {
      point = { x, y };
      getSelection()?.removeAllRanges();
    },
    /** The items under the last click. @returns {string[]} */
    notesAt() {
      if (!point) return [];
      const { x, y } = point;
      const ids = new Set();
      for (const mark of surface.querySelectorAll('.ss-pdf-mark')) {
        const rect = mark.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top - 2 && y <= rect.bottom + 2)
          ids.add(/** @type {HTMLElement} */ (mark).dataset.note);
      }
      return [...ids];
    },
    /** @param {any[]} next anchored items, with `quiet` on replies and resolved comments */
    applyNotes(next) {
      items = next;
      drawAll();
    },
    /** @param {string | null} id */
    activate(id) {
      active = id;
      for (const mark of surface.querySelectorAll('.ss-pdf-mark'))
        mark.toggleAttribute(
          'data-active',
          /** @type {HTMLElement} */ (mark).dataset.note === id && id != null,
        );
    },
    /** Turn to the block's page and bring the words into view. */
    reveal(blockId, from = 0, to) {
      const found = byId.get(blockId);
      if (!found) return;
      pending = { blockId, from, to: to ?? found.block.text.length };
      const page = pageElement(found.block.page);
      if (rendered(page)) {
        page?.scrollIntoView({ block: 'start' });
        showPending();
      } else viewer.currentPageNumber = found.block.page;
    },
    /** @param {string} blockId */
    paragraphOf: (blockId) => (byId.get(blockId)?.index ?? 0) + 1,
    copy: () => navigator.clipboard.writeText(getSelection()?.toString() ?? ''),
    focus() {},
    dispose() {
      eventBus.off('textlayerrendered', onText);
      surface.removeEventListener('pointerup', up);
    },
  };
}
