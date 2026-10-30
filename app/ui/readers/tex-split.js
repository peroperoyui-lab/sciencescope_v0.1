// The tex page beside its source (EDITING_DESK.md §10, U6): the render pane
// follows the text as it is typed, scrolls with the source, and reports
// clicks on formulas so they can be edited. Blocks whose HTML did not change
// keep their elements, so typing does not redraw the whole page. Text on the
// page knows where it came from in the source (<span data-o>), so comments and
// indexes are drawn on it and a selection there is the same selection in the
// source: adding a comment, an index or quoting works from either pane.
import { renderTex } from '../tex-render.js';
import { textNoteRanges, textNotesValue } from './desk-notes.js';

const RENDER_DELAY = 150;
// CSS custom highlights for comments, indexes and the active one (::highlight in components.css).
const MARKS = { comment: 'ss-tex-cmt', index: 'ss-tex-bind', active: 'ss-tex-active' };

/** @param {string} html one element */
function element(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  return /** @type {HTMLElement} */ (template.content.firstElementChild);
}

/**
 * @param {HTMLElement} pane the scrolling render pane (.ss-split__render)
 * @param {HTMLElement} page the page inside it
 * @param {any} editor mountDeskText's controls
 * @param {{ onRender?: (outline: {level:number,text:string,from:number}[]) => void,
 *   onFormula?: (formula: any) => void, visible: () => { source: boolean, render: boolean },
 *   media?: (src: string, folders: string[]) => Promise<string | null> }} options
 * `media` gives a figure's picture as a URL, or null to keep its file name.
 */
export function mountTexRender(pane, page, editor, { onRender, onFormula, visible, media }) {
  const cache = new Map();
  /** @type {{kind:string,from:number,to:number,html:string}[]} */
  let blocks = [];
  /** @type {HTMLElement[]} */
  let elements = [];
  let timer = /** @type {any} */ (0);
  // The pane the person last scrolled or clicked leads; the other follows.
  let driver = 'source';
  const view = editor.view;
  const scroller = view.scrollDOM;

  function render() {
    clearTimeout(timer);
    const result = renderTex(editor.plain(), { cache, positions: true });
    const unused = new Map();
    elements.forEach((node, index) => {
      const list = unused.get(blocks[index].html) ?? [];
      list.push(node);
      unused.set(blocks[index].html, list);
    });
    const next = result.blocks.map((item) => {
      const node = unused.get(item.html)?.shift() ?? element(item.html);
      node.dataset.from = String(item.from);
      node.dataset.to = String(item.to);
      return node;
    });
    page.replaceChildren(...next);
    blocks = result.blocks;
    elements = next;
    collectRuns();
    drawNotes();
    if (media) pictures(result.graphicsPath);
    onRender?.(result.outline);
    if (driver === 'source') followSource();
  }
  /** Figures not tried yet get their picture; kept blocks keep theirs. @param {string[]} folders */
  function pictures(folders) {
    for (const figure of page.querySelectorAll('.ss-page__fig[data-src]:not([data-tried])')) {
      const box = /** @type {HTMLElement} */ (figure);
      box.dataset.tried = '';
      void media(box.dataset.src, folders).then((url) => {
        if (!url) return;
        const image = document.createElement('img');
        image.src = url;
        image.alt = box.dataset.src;
        box.replaceChildren(image);
        box.classList.add('ss-page__fig--image');
      });
    }
  }
  /** @type {{ node: Text, start: number, end: number }[]} text copied from the source, in page order */
  let runs = [];
  function collectRuns() {
    runs = [];
    elements.forEach((block, index) => {
      const from = blocks[index].from;
      for (const span of block.querySelectorAll('[data-o]')) {
        const node = /** @type {Text} */ (span.firstChild);
        if (node?.nodeType !== 3) continue;
        const start = from + Number(/** @type {HTMLElement} */ (span).dataset.o);
        runs.push({ node, start, end: start + node.length });
      }
    });
  }

  /**
   * The source position of a point on the page: inside copied text exactly,
   * elsewhere (a heading number, a formula) the end of the text before it.
   * @param {Node} node @param {number} offset @returns {number | null}
   */
  function positionAt(node, offset) {
    if (!runs.length) return null;
    const run = node.nodeType === 3 ? runs.find((entry) => entry.node === node) : null;
    if (run) return run.start + Math.min(offset, run.node.length);
    const point = document.createRange();
    point.setStart(node, offset);
    // The last run that starts at or before the point.
    let low = 0;
    let high = runs.length - 1;
    let found = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (point.comparePoint(runs[middle].node, 0) <= 0) {
        found = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return found < 0 ? runs[0].start : runs[found].end;
  }

  /** Page ranges covering source positions `from`–`to`. @param {number} from @param {number} to */
  function rangesOf(from, to) {
    const ranges = [];
    for (const run of runs) {
      if (run.end <= from || run.start >= to) continue;
      const range = document.createRange();
      range.setStart(run.node, Math.max(from, run.start) - run.start);
      range.setEnd(run.node, Math.min(to, run.end) - run.start);
      ranges.push(range);
    }
    return ranges;
  }

  /** Comments and indexes from the source, drawn as highlights on the page. */
  function drawNotes() {
    const highlights = globalThis.CSS?.highlights;
    if (!highlights) return;
    const value = textNotesValue(view.state);
    const sets = { comment: [], index: [], active: [] };
    for (const note of textNoteRanges(view.state)) {
      if (note.quiet) continue;
      const ranges = rangesOf(note.from, note.to);
      sets[note.type === 'comment' ? 'comment' : 'index'].push(...ranges);
      if (note.id === value.active) sets.active.push(...ranges);
    }
    for (const [kind, name] of Object.entries(MARKS))
      highlights.set(name, new Highlight(...sets[kind]));
  }

  // The selection made on the page: the source gets the same selection
  // (without focus, so the page keeps it), and its box is kept for the toolbar.
  let picked = /** @type {DOMRect | null} */ (null);
  const onSelectionChange = () => {
    const selection = getSelection();
    if (!selection?.rangeCount || !page.contains(selection.anchorNode)) {
      if (selection?.rangeCount && !pane.contains(selection.anchorNode)) picked = null;
      return;
    }
    const anchor = positionAt(selection.anchorNode, selection.anchorOffset);
    const head = positionAt(selection.focusNode, selection.focusOffset);
    if (anchor == null || head == null) return;
    const range = selection.getRangeAt(0);
    picked = selection.isCollapsed ? null : range.getBoundingClientRect();
    const main = view.state.selection.main;
    if (main.anchor !== anchor || main.head !== head)
      view.dispatch({ selection: { anchor, head } });
  };
  document.addEventListener('selectionchange', onSelectionChange);

  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(render, RENDER_DELAY);
  };

  /** Pairs of (source height, render offset) at each block's top and bottom, in order. */
  function anchors() {
    const top = page.offsetTop;
    const points = [[0, 0]];
    blocks.forEach((item, index) => {
      const node = elements[index];
      const start = view.lineBlockAt(item.from).top;
      const end = view.lineBlockAt(Math.max(item.from, item.to - 1)).bottom;
      const y = top + node.offsetTop;
      points.push([start, y], [Math.max(start, end), y + node.offsetHeight]);
    });
    points.push([view.contentHeight, pane.scrollHeight]);
    // Keep both columns rising, so the mapping works both ways.
    for (let index = 1; index < points.length; index++) {
      points[index][0] = Math.max(points[index][0], points[index - 1][0]);
      points[index][1] = Math.max(points[index][1], points[index - 1][1]);
    }
    return points;
  }
  /** Map `value` from column `from` to column `to` of the anchors. */
  function map(points, value, from, to) {
    // At the very top both panes start at their top, page margin included.
    if (value <= 0) return 0;
    const index = points.findIndex((point) => point[from] > value);
    if (index < 0) return points.at(-1)[to];
    if (index === 0) return points[0][to];
    const [a, b] = [points[index - 1], points[index]];
    const span = b[from] - a[from];
    return a[to] + (span ? ((value - a[from]) / span) * (b[to] - a[to]) : 0);
  }
  const both = () => {
    const shown = visible();
    return shown.source && shown.render;
  };
  function followSource() {
    if (!both() || !blocks.length) return;
    const offset = scroller.getBoundingClientRect().top - view.documentTop;
    pane.scrollTop = map(anchors(), Math.max(0, offset), 0, 1);
  }
  function followRender() {
    if (!both() || !blocks.length) return;
    const padding = view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = padding + map(anchors(), pane.scrollTop, 1, 0);
  }

  const lead = (name) => () => {
    driver = name;
  };
  const events = ['wheel', 'pointerdown', 'keydown', 'touchstart'];
  const fromSource = lead('source');
  const fromRender = lead('render');
  for (const name of events) {
    scroller.addEventListener(name, fromSource, { passive: true });
    pane.addEventListener(name, fromRender, { passive: true });
  }
  const onSourceScroll = () => driver === 'source' && followSource();
  const onRenderScroll = () => driver === 'render' && followRender();
  scroller.addEventListener('scroll', onSourceScroll, { passive: true });
  pane.addEventListener('scroll', onRenderScroll, { passive: true });

  /** A click on a formula opens it; elsewhere it puts the source cursor at that block. */
  const onClick = (/** @type {MouseEvent} */ event) => {
    if (!getSelection()?.isCollapsed) return;
    const target = /** @type {Element} */ (event.target);
    const node = /** @type {HTMLElement | null} */ (target.closest('[data-from]'));
    if (!node || node.parentElement !== page) return;
    const start = Number(node.dataset.from);
    const box = /** @type {HTMLElement | null} */ (target.closest('.ss-eqbox[data-eq]'));
    if (box && onFormula) {
      const [from, to] = box.dataset.eq.split(',').map((value) => start + Number(value));
      onFormula({
        from,
        to,
        box,
        rows: box.hasAttribute('data-rows'),
        number: box.dataset.number ?? '',
        line: editor.lineAt(from),
      });
      return;
    }
    if (visible().source) {
      driver = 'source';
      const caret = getSelection();
      editor.revealAt(
        (caret?.anchorNode && positionAt(caret.anchorNode, caret.anchorOffset)) ?? start,
      );
    }
  };
  page.addEventListener('click', onClick);

  render();
  return {
    /** The text changed: draw it again shortly. */
    changed: later,
    /** The source editor's update: redraw the marks when they changed. @param {any} update */
    sourceUpdated(update) {
      if (textNotesValue(update.startState) !== textNotesValue(update.state)) drawNotes();
    },
    /**
     * The words selected on the page, as the source editor's selection() gives
     * them but with the page's box; null when the selection is not on the page.
     */
    selection() {
      if (!picked) return null;
      const { from, to } = view.state.selection.main;
      const quote = view.state.sliceDoc(from, to);
      if (!quote.trim()) return null;
      return { quote, from: editor.fileOffset(from), to: editor.fileOffset(to), rect: picked };
    },
    /** 定位 selected words in the source: with the source hidden, bring them into view here. */
    revealed() {
      const shown = visible();
      if (shown.source || !shown.render) return;
      const { from, to } = view.state.selection.main;
      const range = rangesOf(from, Math.max(to, from + 1))[0];
      if (!range) return;
      const box = range.getBoundingClientRect();
      const frame = pane.getBoundingClientRect();
      pane.scrollTop += box.top - frame.top - frame.height / 3;
    },
    /** Draw now, then line the panes up from the source. */
    refresh() {
      render();
      driver = 'source';
      followSource();
    },
    /** Line the render pane up with the source after the source scrolled itself. */
    sync() {
      driver = 'source';
      requestAnimationFrame(followSource);
    },
    /** Scroll the render pane to the block at a 1-based source line. @param {number} number */
    scrollToLine(number) {
      const lines = view.state.doc;
      const position = lines.line(Math.max(1, Math.min(number, lines.lines))).from;
      const index = blocks.findLastIndex((item) => item.from <= position);
      const node = elements[Math.max(0, index)];
      if (node) pane.scrollTop = page.offsetTop + node.offsetTop - 12;
    },
    dispose() {
      clearTimeout(timer);
      for (const name of events) {
        scroller.removeEventListener(name, fromSource);
        pane.removeEventListener(name, fromRender);
      }
      scroller.removeEventListener('scroll', onSourceScroll);
      pane.removeEventListener('scroll', onRenderScroll);
      page.removeEventListener('click', onClick);
      document.removeEventListener('selectionchange', onSelectionChange);
      for (const name of Object.values(MARKS)) globalThis.CSS?.highlights?.delete(name);
    },
  };
}
