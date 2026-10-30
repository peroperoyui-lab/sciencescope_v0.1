// The tex page beside its source (EDITING_DESK.md §10, U6): the render pane
// follows the text as it is typed, scrolls with the source, and reports
// clicks on formulas so they can be edited. Blocks whose HTML did not change
// keep their elements, so typing does not redraw the whole page.
import { renderTex } from '../tex-render.js';

const RENDER_DELAY = 150;

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
    const result = renderTex(editor.plain(), { cache });
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
      editor.revealAt(start);
    }
  };
  page.addEventListener('click', onClick);

  render();
  return {
    /** The text changed: draw it again shortly. */
    changed: later,
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
    },
  };
}
