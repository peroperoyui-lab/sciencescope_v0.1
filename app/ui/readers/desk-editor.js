// The editing desk's editors (EDITING_DESK.md §3, §10). A docx opens as a page
// edited like Word: paragraphs, headings and table cells, with bold, italic,
// underline, superscript and subscript. Formulas, pictures, fields and notes
// are kept as they are and shown as objects; bookmarks and Word comment ranges
// are invisible and survive deletion around them. Tables keep their shape.
// Markdown and TeX are edited as source with their BOM and line endings kept.
import {
  Schema,
  PMState,
  PMView,
  Plugin,
  PluginKey,
  TextSelection,
  Decoration,
  DecorationSet,
  pmKeymap,
  pmHistory,
  pmUndo,
  pmRedo,
  pmUndoDepth,
  pmRedoDepth,
  baseKeymap,
  toggleMark,
  splitBlockAs,
  EditorState,
  EditorView,
  Transaction,
  lineNumbers,
  drawSelection,
  StreamLanguage,
  syntaxHighlighting,
  defaultHighlightStyle,
  stex,
  keymap,
  history,
  historyKeymap,
  defaultKeymap,
  undo,
  redo,
  undoDepth,
  redoDepth,
} from './vendor.js';
import {
  COPYABLE,
  MARKERS,
  MARKS,
  countWords,
  fromDocJSON,
  textShape,
  toDocJSON,
} from '../desk-blocks.js';
import { sentenceAround } from '../desk-assist.js';
import { t } from '../i18n/index.js';
import { atomElement } from './desk-atoms.js';

const schema = new Schema({
  nodes: {
    doc: { content: '(para | table | opaque)+' },
    para: {
      content: 'inline*',
      group: 'block',
      attrs: {
        id: { default: null },
        kind: { default: 'paragraph' },
        level: { default: null },
        style: { default: null },
        section: { default: false },
        like: { default: null },
      },
      // Pasted blocks become plain paragraphs: headings need a Word style.
      parseDOM: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre'].map((tag) => ({
        tag,
        getAttrs: () => ({}),
      })),
      toDOM(node) {
        const { kind, level } = node.attrs;
        if (kind === 'heading') return [`h${Math.min(level ?? 1, 6)}`, 0];
        return ['p', kind === 'list-item' ? { class: 'ss-page__li' } : {}, 0];
      },
    },
    table: {
      content: 'row+',
      attrs: { key: { default: null } },
      isolating: true,
      toDOM: () => ['table', ['tbody', 0]],
    },
    row: { content: 'cell+', attrs: { key: { default: null } }, toDOM: () => ['tr', 0] },
    cell: {
      content: 'para+',
      attrs: { key: { default: null } },
      isolating: true,
      toDOM: () => ['td', 0],
    },
    opaque: {
      atom: true,
      attrs: { id: { default: null }, text: { default: '' } },
      toDOM: (node) => [
        'div',
        {
          class: 'ss-desk-opaque',
          'data-tip': t('跨段落的域：编辑台保留原样，可在 Word 里修改'),
        },
        node.attrs.text || '…',
      ],
    },
    atom: {
      inline: true,
      atom: true,
      group: 'inline',
      marks: '',
      attrs: {
        atom: {},
        ref: { default: null },
        display: { default: '' },
        run: { default: null },
        wrap: { default: null },
        media: { default: false },
      },
      // Only tabs, breaks and symbols may be pasted again; a formula or field exists once.
      parseDOM: [
        {
          tag: '[data-atom]',
          getAttrs(dom) {
            try {
              const attrs = JSON.parse(/** @type {HTMLElement} */ (dom).dataset.attrs ?? 'null');
              return attrs && COPYABLE.has(attrs.atom) ? attrs : false;
            } catch {
              return false;
            }
          },
        },
        { tag: '[data-atom]', ignore: true },
      ],
      toDOM: (node) => atomElement(node.attrs, null),
    },
    text: { group: 'inline' },
  },
  marks: {
    b: {
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=bold' }],
      toDOM: () => ['strong', 0],
    },
    i: {
      parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
      toDOM: () => ['em', 0],
    },
    u: { parseDOM: [{ tag: 'u' }], toDOM: () => ['u', 0] },
    sup: { excludes: 'sup sub', parseDOM: [{ tag: 'sup' }], toDOM: () => ['sup', 0] },
    sub: { excludes: 'sup sub', parseDOM: [{ tag: 'sub' }], toDOM: () => ['sub', 0] },
    // Which Word run (and hyperlink or content control) the text came from.
    origin: {
      attrs: { run: { default: null }, wrap: { default: null } },
      inclusive: true,
      toDOM: () => ['span', 0],
    },
  },
});
const { para, opaque, cell, atom } = schema.nodes;

/** Step ranges in the documents they applied to. */
function touched(tr, visit) {
  tr.steps.forEach((step, index) => {
    const { from, to } = /** @type {any} */ (step);
    if (from == null || to <= from) return;
    tr.docs[index].nodesBetween(from, to, (node, pos) => visit(node, pos, index, from, to));
  });
}

const remote = (tr) => tr.getMeta('desk-remote');

/** Paragraph ids stay unique: a split or a paste gets a temporary id until the server names it. */
function idPlugin() {
  let counter = 0;
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged && !remote(tr))) return null;
      const seen = new Set();
      let tr = null;
      state.doc.descendants((node, pos) => {
        if (node.type !== para) return node.type !== opaque;
        const { id } = node.attrs;
        if (id && !seen.has(id)) seen.add(id);
        else {
          const fresh = `n:${++counter}`;
          seen.add(fresh);
          tr ??= state.tr;
          tr.setNodeMarkup(pos, null, {
            ...node.attrs,
            id: fresh,
            section: false,
            like: node.attrs.like ?? id ?? null,
          });
        }
        return false;
      });
      return tr;
    },
  });
}

/** Bookmarks and Word comment ranges deleted with text are put back where the text was. */
function markerPlugin() {
  return new Plugin({
    appendTransaction(transactions, _old, state) {
      const lost = [];
      transactions.forEach((tr, order) => {
        if (!tr.docChanged || remote(tr)) return;
        touched(tr, (node, pos, index, from, to) => {
          if (node.type === atom && MARKERS.has(node.attrs.atom) && pos >= from && pos < to) {
            let mapped = tr.mapping.slice(index).map(pos, -1);
            for (const later of transactions.slice(order + 1))
              mapped = later.mapping.map(mapped, -1);
            lost.push({ node, pos: mapped });
          }
        });
      });
      if (!lost.length) return null;
      const present = new Set();
      state.doc.descendants((node) => {
        if (node.type === atom && MARKERS.has(node.attrs.atom)) present.add(node.attrs.ref);
      });
      const tr = state.tr;
      for (const { node, pos } of lost) {
        if (present.has(node.attrs.ref)) continue;
        present.add(node.attrs.ref);
        // Markers lost at one point go back in their original order.
        let at = tr.mapping.map(pos, 1);
        const $at = tr.doc.resolve(at);
        if (!$at.parent.inlineContent) at = TextSelection.near($at).from;
        tr.insert(at, node);
      }
      return tr.docChanged ? tr : null;
    },
  });
}

/** Tables keep their cells, and section breaks and cross-paragraph fields stay. */
function shapePlugin() {
  return new Plugin({
    filterTransaction(tr) {
      if (!tr.docChanged || remote(tr) || tr.getMeta('history$')) return true;
      const guarded = new Set();
      touched(tr, (node) => {
        if (node.type === opaque || (node.type === para && node.attrs.section))
          guarded.add(node.attrs.id);
        if (node.type === cell) guarded.add(`cell:${node.attrs.key}`);
        return node.type !== para && node.type !== opaque;
      });
      if (!guarded.size) return true;
      const kept = new Set();
      tr.doc.descendants((node) => {
        if (node.type === opaque || (node.type === para && node.attrs.section))
          kept.add(node.attrs.id);
        if (node.type === cell) kept.add(`cell:${node.attrs.key}`);
        return node.type !== para && node.type !== opaque;
      });
      return [...guarded].every((key) => kept.has(key));
    },
  });
}

const outlineKey = new PluginKey('desk-outline');
function headings(doc) {
  const list = [];
  const decorations = [];
  doc.forEach((node, pos) => {
    const text = node.textContent.trim();
    if (node.type !== para || node.attrs.kind !== 'heading' || !text) return;
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, { 'data-outline': String(list.length) }),
    );
    list.push({ level: node.attrs.level ?? 1, text, index: list.length });
  });
  const top = Math.min(...list.map((entry) => entry.level));
  return {
    list: list.map((entry) => ({ ...entry, level: entry.level - top })),
    decorations: DecorationSet.create(doc, decorations),
  };
}
const outlinePlugin = () =>
  new Plugin({
    key: outlineKey,
    state: {
      init: (_, state) => headings(state.doc),
      apply: (tr, value) => (tr.docChanged ? headings(tr.doc) : value),
    },
    props: { decorations: (state) => outlineKey.getState(state).decorations },
  });

// A short highlight where the desk sends the reader (a chat mark, a change).
const flashKey = new PluginKey('desk-flash');
const flashPlugin = () =>
  new Plugin({
    key: flashKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const range = tr.getMeta(flashKey);
        if (range === null) return DecorationSet.empty;
        if (!range) return set.map(tr.mapping, tr.doc);
        return DecorationSet.create(tr.doc, [
          range.node
            ? Decoration.node(range.from, range.to, { class: 'ss-desk-flash' })
            : Decoration.inline(range.from, range.to, { class: 'ss-desk-flash' }),
        ]);
      },
    },
    props: { decorations: (state) => flashKey.getState(state) },
  });

/** How many characters an inline node takes in the server's block text. @param {any} node */
const inlineLength = (node) =>
  node.isText ? node.text.length : String(node.attrs.display ?? '').length;

/** The paragraph (or cross-paragraph field) with this id. @param {any} doc @param {string} id */
function findBlock(doc, id) {
  let found = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type !== para && node.type !== opaque) return true;
    if (node.attrs.id === id) found = { node, pos };
    return false;
  });
  return found;
}

/** A character offset in a paragraph's text as a document position. */
function offsetToPos(node, pos, offset) {
  let at = 0;
  let result = pos + 1;
  node.forEach((child, start) => {
    const length = inlineLength(child);
    if (at >= offset) return;
    if (child.isText && offset <= at + length) result = pos + 1 + start + (offset - at);
    else result = pos + 1 + start + child.nodeSize;
    at += length;
  });
  return at < offset ? pos + 1 + node.content.size : result;
}

/** A document position inside a paragraph as a character offset in its text. */
function posToOffset(node, pos, target) {
  let at = 0;
  node.forEach((child, start) => {
    const begin = pos + 1 + start;
    if (begin >= target) return;
    at += child.isText ? Math.min(child.text.length, target - begin) : inlineLength(child);
  });
  return at;
}

/** Text of a range, with objects written as their display text. */
const leafText = (node) => String(node.attrs?.display ?? '');

// Enter: the new paragraph is like the old one, except after a heading's end.
const split = splitBlockAs((node, atEnd) => {
  if (node.type !== para) return null;
  if (atEnd && node.attrs.kind === 'heading') return { type: para, attrs: { kind: 'paragraph' } };
  return {
    type: para,
    attrs: {
      ...node.attrs,
      id: null,
      section: false,
      like: node.attrs.section ? null : (node.attrs.id ?? node.attrs.like),
    },
  };
});

/** Same paragraphs and cells in the same order. */
function shape(doc) {
  const keys = [];
  doc.descendants((node) => {
    keys.push(
      node.type === para || node.type === opaque
        ? node.attrs.id
        : `${node.type.name}:${node.attrs.key}`,
    );
    return node.type !== para && node.type !== opaque;
  });
  return keys.join('|');
}

function paragraphs(doc) {
  const list = [];
  doc.descendants((node, pos) => {
    if (node.type === para || node.type === opaque) list.push({ node, pos });
    return node.type !== para && node.type !== opaque;
  });
  return list;
}

/**
 * @param {HTMLElement} surface the page element (`ss-page`)
 * @param {{ blocks: any[], media: (ref: any) => Promise<string>,
 *   onChange: () => void, onState: (state: { marks: string[], undo: boolean, redo: boolean }) => void,
 *   onSelection?: () => void }} options
 * `onSelection` is told when the selection may have changed; read it with `selection()`.
 */
export function mountDeskDocx(surface, { blocks, media, onChange, onState, onSelection }) {
  const markTypes = Object.fromEntries(MARKS.map((name) => [name, schema.marks[name]]));
  const create = (content) =>
    PMState.create({
      schema,
      doc: schema.nodeFromJSON(toDocJSON(content)),
      plugins: [
        pmHistory(),
        pmKeymap({
          'Mod-z': pmUndo,
          'Mod-y': pmRedo,
          'Shift-Mod-z': pmRedo,
          'Mod-b': toggleMark(markTypes.b),
          'Mod-i': toggleMark(markTypes.i),
          'Mod-u': toggleMark(markTypes.u),
          Enter: split,
          // A line break inside a paragraph needs a Word run of its own; not yet.
          'Shift-Enter': () => true,
        }),
        pmKeymap(baseKeymap),
        idPlugin(),
        markerPlugin(),
        shapePlugin(),
        outlinePlugin(),
        flashPlugin(),
      ],
    });
  let frame = 0;
  const report = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const { state } = view;
      const { from, to, empty, $from } = state.selection;
      const active = empty ? (state.storedMarks ?? $from.marks()) : null;
      onState({
        marks: MARKS.filter((name) =>
          active
            ? active.some((mark) => mark.type === markTypes[name])
            : state.doc.rangeHasMark(from, to, markTypes[name]),
        ),
        undo: pmUndoDepth(state) > 0,
        redo: pmRedoDepth(state) > 0,
      });
    });
  };
  const view = new PMView(
    { mount: surface },
    {
      state: create(blocks),
      nodeViews: {
        atom: (node) => ({ dom: atomElement(node.attrs, media), ignoreMutation: () => true }),
      },
      attributes: {
        class: 'ss-page ss-page--edit',
        'aria-label': t('文稿正文'),
        spellcheck: 'false',
      },
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr));
        if (tr.docChanged && !remote(tr)) onChange();
        if (tr.docChanged || tr.selectionSet) onSelection?.();
        report();
      },
    },
  );
  /** @type {any} */
  let flashTimer = 0;
  /** @param {any} range */
  const flash = (range) => {
    clearTimeout(flashTimer);
    view.dispatch(view.state.tr.setMeta(flashKey, range));
    flashTimer = setTimeout(() => {
      if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(flashKey, null));
    }, 1800);
  };
  report();
  const run = (command) => {
    command(view.state, view.dispatch);
    view.focus();
  };
  return {
    view,
    /** Paragraphs as they stand, for the change set. */
    snapshot: () => fromDocJSON(view.state.doc.toJSON()),
    /** Take paragraphs from the server, keeping the selection where the shape allows. @param {any[]} next */
    adopt(next) {
      const doc = schema.nodeFromJSON(toDocJSON(next));
      const current = view.state.doc;
      if (doc.eq(current)) return;
      const tr = view.state.tr;
      if (shape(doc) === shape(current)) {
        const before = paragraphs(current);
        const after = paragraphs(doc);
        for (let index = before.length - 1; index >= 0; index--) {
          const { node, pos } = before[index];
          const fresh = after[index].node;
          if (node.eq(fresh)) continue;
          if (node.type === opaque) tr.replaceWith(pos, pos + node.nodeSize, fresh);
          else {
            tr.replaceWith(pos + 1, pos + 1 + node.content.size, fresh.content);
            tr.setNodeMarkup(pos, null, fresh.attrs);
          }
        }
      } else tr.replaceWith(0, current.content.size, doc.content);
      view.dispatch(tr.setMeta('addToHistory', false).setMeta('desk-remote', true));
    },
    /** Server ids for new paragraphs. @param {Record<string, string>} ids */
    rename(ids) {
      if (!Object.keys(ids).length) return;
      const tr = view.state.tr;
      view.state.doc.descendants((node, pos) => {
        if (node.type !== para) return node.type !== opaque;
        const id = ids[node.attrs.id];
        const like = ids[node.attrs.like];
        if (id || like)
          tr.setNodeMarkup(pos, null, {
            ...node.attrs,
            ...(id ? { id } : {}),
            ...(like ? { like } : {}),
          });
        return false;
      });
      if (tr.docChanged)
        view.dispatch(tr.setMeta('addToHistory', false).setMeta('desk-remote', true));
    },
    /** @param {'undo'|'redo'|'b'|'i'|'u'|'sup'|'sub'} name */
    command(name) {
      if (name === 'undo') run(pmUndo);
      else if (name === 'redo') run(pmRedo);
      else run(toggleMark(markTypes[name]));
    },
    /**
     * The selected text and where it is: the paragraph it starts in, offsets in
     * that paragraph's text when it stays inside it, and its box on screen.
     * @returns {{ blockId: string | null, quote: string, from: number | null, to: number | null,
     *   rect: DOMRect } | null}
     */
    selection() {
      const { state } = view;
      const { from, to, empty, $from, $to } = state.selection;
      if (empty) return null;
      const quote = state.doc.textBetween(from, to, '\n', leafText);
      if (!quote.trim()) return null;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      const rect = new DOMRect(
        Math.min(start.left, end.left),
        Math.min(start.top, end.top),
        Math.abs(end.right - start.left),
        Math.max(start.bottom, end.bottom) - Math.min(start.top, end.top),
      );
      const block = $from.parent.type === para ? $from.parent : null;
      const blockPos = block ? $from.before() : 0;
      const same = block && $to.parent === block;
      return {
        blockId: block?.attrs.id ?? null,
        quote,
        from: same ? posToOffset(block, blockPos, from) : null,
        to: same ? posToOffset(block, blockPos, to) : null,
        rect,
      };
    },
    /** Put the caret where the pointer is, as a right-click outside the selection does. @param {number} x @param {number} y */
    caretAt(x, y) {
      const found = view.posAtCoords({ left: x, top: y });
      if (!found) return;
      const $at = view.state.doc.resolve(found.pos);
      if (!$at.parent.inlineContent) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found.pos)));
    },
    /** The paragraph the cursor is in. */
    currentBlock() {
      const { $from } = view.state.selection;
      return $from.parent.type === para ? $from.parent.attrs.id : null;
    },
    /** Select the sentence around the cursor when nothing is selected. */
    selectSentence() {
      const { empty, $from, from } = view.state.selection;
      if (!empty || $from.parent.type !== para) return;
      const node = $from.parent;
      const pos = $from.before();
      const text = view.state.doc.textBetween(pos + 1, pos + 1 + node.content.size, '\n', leafText);
      const [start, end] = sentenceAround(text, posToOffset(node, pos, from));
      if (end <= start) return;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            offsetToPos(node, pos, start),
            offsetToPos(node, pos, end),
          ),
        ),
      );
    },
    /** 1-based position of a block among all blocks, as the server counts paragraphs. @param {string} id */
    paragraphOf(id) {
      let index = 0;
      let found = 0;
      view.state.doc.descendants((node) => {
        if (found) return false;
        if (node.type !== para && node.type !== opaque) return true;
        index++;
        if (node.attrs.id === id) found = index;
        return false;
      });
      return found;
    },
    /** The heading a block sits under, or ''. @param {string} id */
    sectionOf(id) {
      let heading = '';
      let done = false;
      view.state.doc.descendants((node) => {
        if (done) return false;
        if (node.type !== para && node.type !== opaque) return true;
        if (node.attrs.id === id) done = true;
        else if (node.type === para && node.attrs.kind === 'heading' && node.textContent.trim())
          heading = node.textContent.trim();
        return false;
      });
      return done ? heading : '';
    },
    /**
     * Scroll to characters `from`–`to` of a paragraph (the whole paragraph
     * without them) and highlight them for a moment.
     * @param {string} blockId @param {number} [from] @param {number} [to]
     */
    reveal(blockId, from, to) {
      const found = findBlock(view.state.doc, blockId);
      if (!found) return false;
      const { node, pos } = found;
      const ranged = node.type === para && from != null && to != null && to > from;
      const start = ranged ? offsetToPos(node, pos, from) : pos;
      const end = ranged ? offsetToPos(node, pos, to) : pos + node.nodeSize;
      flash({ from: start, to: end, node: !ranged });
      const element = /** @type {HTMLElement | null} */ (view.nodeDOM(pos));
      element?.scrollIntoView({ block: 'center' });
      return true;
    },
    /** Copy the selection as plain text; `cut` also removes it. @param {boolean} [cut] */
    async copy(cut = false) {
      const text = this.selection()?.quote;
      if (!text) return;
      await navigator.clipboard.writeText(text);
      if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
      view.focus();
    },
    /** @param {string} text */
    paste(text) {
      view.focus();
      view.pasteText(text);
    },
    outline: () => outlineKey.getState(view.state).list,
    words: () =>
      countWords(view.state.doc.textBetween(0, view.state.doc.content.size, '\n', () => '')),
    focus: () => view.focus(),
    dispose() {
      cancelAnimationFrame(frame);
      clearTimeout(flashTimer);
      view.destroy();
    },
  };
}

/**
 * @param {HTMLElement} surface
 * @param {{ text: string, format: string, onChange: () => void,
 *   onState: (state: { marks: string[], undo: boolean, redo: boolean }) => void,
 *   onSelection?: () => void }} options
 */
export function mountDeskText(surface, { text, format, onChange, onState, onSelection }) {
  const { bom, separator, body } = textShape(text);
  const report = (state) =>
    onState({ marks: [], undo: undoDepth(state) > 0, redo: redoDepth(state) > 0 });
  const view = new EditorView({
    parent: surface,
    state: EditorState.create({
      doc: body,
      extensions: [
        EditorState.lineSeparator.of(separator),
        lineNumbers(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        syntaxHighlighting(defaultHighlightStyle),
        ...(format === 'latex' ? [StreamLanguage.define(stex)] : []),
        EditorView.contentAttributes.of({ 'aria-label': t('文稿源码'), spellcheck: 'false' }),
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            update.transactions.some((tr) => tr.docChanged && !tr.annotation(Transaction.remote))
          )
            onChange();
          if (update.docChanged || update.selectionSet) onSelection?.();
          report(update.state);
        }),
      ],
    }),
  });
  report(view.state);
  const run = (command) => {
    command(view);
    view.focus();
  };
  // Editor positions count a line break as one character; file offsets count the separator.
  const toOffset = (position) => {
    const line = view.state.doc.lineAt(position);
    return position + (line.number - 1) * (separator.length - 1);
  };
  const toPosition = (offset) => {
    const before = view.state.sliceDoc().slice(0, offset);
    return before.length - (before.split(separator).length - 1) * (separator.length - 1);
  };
  return {
    view,
    /**
     * The selected text, its offsets in the file text (without the BOM) and its box.
     * @returns {{ quote: string, from: number, to: number, rect: DOMRect } | null}
     */
    selection() {
      const { from, to, empty } = view.state.selection.main;
      if (empty) return null;
      const quote = view.state.sliceDoc(from, to);
      if (!quote.trim()) return null;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      if (!start || !end) return null;
      return {
        quote,
        from: toOffset(from),
        to: toOffset(to),
        rect: new DOMRect(
          Math.min(start.left, end.left),
          start.top,
          Math.abs(end.right - start.left),
          end.bottom - start.top,
        ),
      };
    },
    /** File offset of the cursor. */
    cursor: () => toOffset(view.state.selection.main.head),
    /** Select the sentence around the cursor when nothing is selected. */
    /** @param {number} x @param {number} y */
    caretAt(x, y) {
      const at = view.posAtCoords({ x, y });
      if (at != null) view.dispatch({ selection: { anchor: at } });
    },
    selectSentence() {
      const range = view.state.selection.main;
      if (!range.empty) return;
      const line = view.state.doc.lineAt(range.head);
      const [start, end] = sentenceAround(line.text, range.head - line.from);
      if (end > start)
        view.dispatch({ selection: { anchor: line.from + start, head: line.from + end } });
    },
    /** Put source markup around the selection (\\textbf{…}, **…**). @param {string} before @param {string} after */
    wrap(before, after) {
      const range = view.state.selection.main;
      view.dispatch({
        changes: [
          { from: range.from, insert: before },
          { from: range.to, insert: after },
        ],
        selection: { anchor: range.from + before.length, head: range.to + before.length },
      });
      view.focus();
    },
    /** Select file offsets `from`–`to` and bring them into view. @param {number} from @param {number} to */
    reveal(from, to) {
      view.dispatch({
        selection: { anchor: toPosition(from), head: toPosition(to) },
        effects: EditorView.scrollIntoView(toPosition(from), { y: 'center' }),
      });
      view.focus();
      return true;
    },
    /** @param {boolean} [cut] */
    async copy(cut = false) {
      const range = view.state.selection.main;
      if (range.empty) return;
      await navigator.clipboard.writeText(view.state.sliceDoc(range.from, range.to));
      if (cut) view.dispatch({ changes: { from: range.from, to: range.to, insert: '' } });
      view.focus();
    },
    /** @param {string} value */
    paste(value) {
      view.dispatch(view.state.replaceSelection(value));
      view.focus();
    },
    /** The file's text, with its BOM and line endings. */
    snapshot: () => (bom ? '﻿' : '') + view.state.sliceDoc(),
    /** Take the server's text as one change, so the cursor stays put. @param {string} next */
    adopt(next) {
      const fresh = next.startsWith('﻿') ? next.slice(1) : next;
      const current = view.state.sliceDoc();
      if (fresh === current) return;
      let from = 0;
      while (from < current.length && from < fresh.length && current[from] === fresh[from]) from++;
      let tail = 0;
      while (
        tail < current.length - from &&
        tail < fresh.length - from &&
        current[current.length - 1 - tail] === fresh[fresh.length - 1 - tail]
      )
        tail++;
      // Positions count the separator as one character; convert through the document.
      const toPos = (offset) => {
        const before = current.slice(0, offset);
        return before.length - (before.split(separator).length - 1) * (separator.length - 1);
      };
      view.dispatch({
        changes: {
          from: toPos(from),
          to: toPos(current.length - tail),
          insert: fresh.slice(from, fresh.length - tail),
        },
        annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
      });
    },
    /** @param {'undo'|'redo'} name */
    command(name) {
      if (name === 'undo') run(undo);
      else if (name === 'redo') run(redo);
    },
    text: () => view.state.sliceDoc(),
    words: () => countWords(view.state.sliceDoc()),
    /** @param {number} number 1-based */
    scrollToLine(number) {
      const lines = view.state.doc;
      const line = lines.line(Math.max(1, Math.min(number, lines.lines)));
      view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
    },
    focus: () => view.focus(),
    dispose: () => view.destroy(),
  };
}
