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
import { t } from '../i18n/index.js';

const ATOM_NAMES = {
  math: '公式',
  image: '图片',
  field: '引用或域',
  footnote: '脚注',
  textbox: '文本框',
  ins: '修订',
  del: '修订',
  opaque: '对象',
};

/**
 * @param {any} attrs
 * @param {((ref: any) => Promise<string>) | null} media
 * @returns {HTMLElement}
 */
function atomElement(attrs, media) {
  const { atom, display } = attrs;
  const data = { 'data-atom': atom, 'data-attrs': JSON.stringify(attrs) };
  const element = document.createElement(
    atom === 'break' ? 'br' : atom === 'footnote' ? 'sup' : 'span',
  );
  for (const [name, value] of Object.entries(data)) element.setAttribute(name, value);
  if (atom === 'break') return element;
  if (MARKERS.has(atom)) {
    element.className = 'ss-desk-marker';
    return element;
  }
  if (COPYABLE.has(atom)) {
    element.className = atom === 'tab' ? 'ss-desk-tab' : '';
    element.textContent = display;
    return element;
  }
  const name = t(ATOM_NAMES[atom] ?? ATOM_NAMES.opaque);
  element.className = `ss-atom ss-atom--${atom}`;
  element.setAttribute('data-tip', t('{name}：编辑台保留原样，可在 Word 里修改', { name }));
  if (atom === 'footnote') return element;
  if (atom === 'image' && media) {
    element.textContent = name;
    media(attrs.ref)
      .then((url) => {
        const image = document.createElement('img');
        image.alt = name;
        image.onload = () => element.replaceChildren(image);
        image.src = url;
      })
      .catch(() => {});
    return element;
  }
  element.textContent = display && display !== '￼' ? display : name;
  return element;
}

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
 *   onChange: () => void, onState: (state: { marks: string[], undo: boolean, redo: boolean }) => void }} options
 */
export function mountDeskDocx(surface, { blocks, media, onChange, onState }) {
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
        report();
      },
    },
  );
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
    outline: () => outlineKey.getState(view.state).list,
    words: () =>
      countWords(view.state.doc.textBetween(0, view.state.doc.content.size, '\n', () => '')),
    focus: () => view.focus(),
    dispose() {
      cancelAnimationFrame(frame);
      view.destroy();
    },
  };
}

/**
 * @param {HTMLElement} surface
 * @param {{ text: string, format: string, onChange: () => void,
 *   onState: (state: { marks: string[], undo: boolean, redo: boolean }) => void }} options
 */
export function mountDeskText(surface, { text, format, onChange, onState }) {
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
  return {
    view,
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
