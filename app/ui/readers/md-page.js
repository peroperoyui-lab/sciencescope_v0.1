// The Markdown page of the desk (EDITING_DESK.md §10, U6b): the rendered
// view edited in place. The source editor stays the one record of the text,
// its history and its comments; the page writes each change back into it as
// the smallest text change, rewriting only the blocks that changed, and
// reads the source again when it changes from elsewhere (the source view,
// undo, the server). Positions go through each block's character map.
import katex from 'katex';
import {
  PMState,
  PMView,
  Plugin,
  PluginKey,
  TextSelection,
  Decoration,
  DecorationSet,
  pmKeymap,
  baseKeymap,
  toggleMark,
  chainCommands,
  exitCode,
  splitListItem,
  liftListItem,
  sinkListItem,
  wrapInList,
  undo,
  redo,
  diffChars,
} from './vendor.js';
import { renderMarkdown } from '../markdown.js';
import {
  linkDefs,
  listItems,
  mapInBlock,
  mdSchema,
  parseMarkdown,
  writeBlock,
} from '../md-blocks.js';
import { sentenceAround } from '../desk-assist.js';
import { t } from '../i18n/index.js';
import { textNoteRanges, textNotesAt, textNotesValue } from './desk-notes.js';

const S = mdSchema;
// Set on page transactions that come from the source, so they are not written back.
const FROM_SOURCE = 'md-source';
const notesKey = new PluginKey('md-notes');
const OBJECT = String.fromCharCode(0xfffc);

/** @param {string} tex @param {boolean} display */
function formulaHtml(tex, display) {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      strict: 'ignore',
      output: 'html',
    });
  } catch {
    return null;
  }
}

/** @param {any} node @param {boolean} display */
function formulaView(node, display) {
  const dom = document.createElement(display ? 'div' : 'span');
  dom.className = display ? 'ss-md-math' : 'ss-eqbox ss-eqbox--inline';
  const box = display ? document.createElement('span') : dom;
  if (display) {
    box.className = 'ss-eqbox ss-eqbox--wide';
    dom.append(box);
  }
  const shown = formulaHtml(node.attrs.tex, display);
  if (shown == null) {
    box.classList.add('ss-page__raw');
    box.textContent = display ? `$$${node.attrs.tex}$$` : `$${node.attrs.tex}$`;
  } else box.innerHTML = shown;
  box.dataset.tip = t('点公式可以改它');
  return { dom, ignoreMutation: () => true };
}

/** @param {any} node */
function rawView(node) {
  const dom = document.createElement('div');
  dom.className = 'ss-md-raw';
  dom.contentEditable = 'false';
  const { kind, source } = node.attrs;
  if (kind === 'table' || kind === 'html') {
    dom.innerHTML = renderMarkdown(source);
    dom.dataset.tip = kind === 'table' ? t('表格请在源码里改') : t('HTML 请在源码里改');
  } else {
    dom.classList.add('ss-page__raw');
    dom.textContent = source;
  }
  return { dom, ignoreMutation: () => true };
}

/** @param {any} node @param {(src: string) => Promise<string | null>} media */
function imageView(node, media) {
  const dom = document.createElement('span');
  dom.className = 'ss-md-img';
  const label = () => {
    dom.classList.add('ss-page__raw');
    dom.textContent = t('图片：{name}', { name: node.attrs.alt || node.attrs.src });
  };
  label();
  media(node.attrs.src)
    .then((url) => {
      if (!url) return;
      const image = document.createElement('img');
      image.src = url;
      image.alt = node.attrs.alt;
      dom.classList.remove('ss-page__raw');
      dom.replaceChildren(image);
    })
    .catch(() => {});
  return { dom, ignoreMutation: () => true };
}

/**
 * @param {HTMLElement} surface the page element
 * @param {any} editor mountDeskText's controls (the source)
 * @param {{ onSelection?: () => void, onMarks?: (marks: string[]) => void,
 *   onFormula?: (formula: { pos: number, tex: string, line: number, rect: DOMRect }) => void,
 *   media?: (src: string) => Promise<string | null>, visible: () => boolean }} options
 */
export function mountMdPage(surface, editor, { onSelection, onMarks, onFormula, media, visible }) {
  const cm = editor.view;
  /** @type {WeakMap<any, {text:string,gap:string,segs:any[]}>} */
  const entries = new WeakMap();
  const layouts = new WeakMap();
  let tail = '';
  let writing = false;
  let stale = false;
  let notesFrame = 0;

  /** Page blocks for `text`, at least one. @param {string} text */
  function read(text) {
    const parsed = parseMarkdown(text);
    if (!parsed.blocks.length)
      parsed.blocks.push({ node: S.nodes.paragraph.create(), text: '', gap: '', segs: [] });
    for (const entry of parsed.blocks) entries.set(entry.node, entry);
    return parsed;
  }

  /**
   * Each top-level block with its page position and where its text starts.
   * @param {any} doc
   * @returns {{ node: any, pos: number, start: number, entry: any }[]}
   */
  function layout(doc) {
    let items = layouts.get(doc);
    if (items) return items;
    items = [];
    let at = 0;
    doc.forEach((node, pos) => {
      const entry = entries.get(node) ?? { node, text: '', gap: '', segs: [] };
      at += entry.gap.length;
      items.push({ node, pos, start: at, entry: { ...entry, node } });
      at += entry.text.length;
    });
    layouts.set(doc, items);
    return items;
  }
  const sourceOf = (items) => items.map((item) => item.entry.gap + item.entry.text).join('') + tail;

  /** Source position to page position. @param {number} offset @param {number} bias */
  function toPage(offset, bias) {
    const items = layout(view.state.doc);
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const end = item.start + item.entry.text.length;
      if (offset < item.start) {
        const previous = items[index - 1];
        if (bias < 0 && previous)
          return previous.pos + mapInBlock(previous.entry, previous.entry.text.length, 'src', -1);
        return item.pos + mapInBlock(item.entry, 0, 'src', 1);
      }
      if (offset <= end && (offset < end || bias < 0 || !items[index + 1]))
        return item.pos + mapInBlock(item.entry, offset - item.start, 'src', bias);
    }
    const last = items.at(-1);
    return last.pos + mapInBlock(last.entry, last.entry.text.length, 'src', -1);
  }
  /** Page position to source position. @param {number} position @param {number} bias */
  function toSource(position, bias) {
    const items = layout(view.state.doc);
    let index = Math.max(
      0,
      items.findLastIndex((item) => item.pos <= position),
    );
    // Just before a block, looking back: the end of the one before.
    if (bias < 0 && index > 0 && items[index].pos === position) index--;
    const item = items[index];
    return item.start + mapInBlock(item.entry, position - item.pos, 'pm', bias);
  }

  /**
   * Write the blocks that changed between `before` and `after` into the
   * source. Returns the blocks that read back differently, for the page to
   * take as the source says.
   */
  function writeBack(before, after) {
    const old = layout(before);
    const text = editor.plain();
    if (sourceOf(old) !== text) return { resync: true, fixes: [] };
    const oldCount = before.childCount;
    const newCount = after.childCount;
    let head = 0;
    while (head < oldCount && head < newCount && before.child(head) === after.child(head)) head++;
    let back = 0;
    while (
      back < oldCount - head &&
      back < newCount - head &&
      before.child(oldCount - 1 - back) === after.child(newCount - 1 - back)
    )
      back++;
    const end = (index) => old[index].start + old[index].entry.text.length;
    const from = head > 0 ? end(head - 1) : 0;
    const to = oldCount - back > head ? end(oldCount - back - 1) : from;
    const known = new WeakMap();
    for (let index = head; index < oldCount - back; index++)
      for (const [item, kept] of listItems(old[index].entry)) known.set(item, kept);
    const defs = linkDefs(old.map((item) => item.entry));
    let middle = '';
    const fixes = [];
    for (let index = head; index < newCount - back; index++) {
      const node = after.child(index);
      const same = entries.get(node);
      const replaced = old[index] && index < oldCount - back ? old[index].entry.gap : null;
      const gap = index === 0 ? (old[0]?.entry.gap ?? '') : (replaced ?? same?.gap ?? '\n\n');
      if (same) {
        middle += (index === 0 ? gap : same.gap) + same.text;
        continue;
      }
      const written = writeBlock(node, known, defs);
      middle += gap + written.text;
      if (written.exact)
        entries.set(node, { text: written.text, gap, segs: written.parsed[0].segs });
      else fixes.push({ index, gap, parsed: written.parsed });
    }
    // A block written in front of the first one needs a blank line before it.
    if (back && head === 0 && newCount - back > 0 && !old[oldCount - back].entry.gap)
      middle += '\n\n';
    const changes = [];
    let at = from;
    for (const part of diffChars(text.slice(from, to), middle)) {
      if (part.added) changes.push({ from: at, insert: part.value });
      else if (part.removed) {
        changes.push({ from: at, to: at + part.value.length });
        at += part.value.length;
      } else at += part.value.length;
    }
    if (changes.length) {
      writing = true;
      try {
        // As typing, so the source's history joins the keystrokes into one undo step.
        cm.dispatch({ changes, userEvent: 'input.type' });
      } finally {
        writing = false;
      }
    }
    return { resync: false, fixes };
  }

  /** The page from the source, replacing only the blocks whose text changed. */
  function resync() {
    stale = false;
    const parsed = read(editor.plain());
    tail = parsed.tail;
    const doc = view.state.doc;
    const old = layout(doc);
    const fresh = parsed.blocks;
    const same = (a, b) => a.entry.gap === b.gap && a.entry.text === b.text;
    let head = 0;
    while (head < old.length && head < fresh.length && same(old[head], fresh[head])) head++;
    let back = 0;
    while (
      back < old.length - head &&
      back < fresh.length - head &&
      same(old[old.length - 1 - back], fresh[fresh.length - 1 - back])
    )
      back++;
    const from = head < old.length ? old[head].pos : doc.content.size;
    const last = old[old.length - back - 1];
    const to = old.length - back > head ? last.pos + last.node.nodeSize : from;
    const nodes = fresh.slice(head, fresh.length - back).map((entry) => entry.node);
    if (from === to && !nodes.length) return;
    const tr = view.state.tr.replaceWith(from, to, nodes).setMeta(FROM_SOURCE, true);
    view.dispatch(tr);
  }

  /** Comments and indexes from the source, drawn on the page. */
  function noteDecorations(doc) {
    const value = textNotesValue(cm.state);
    const decorations = [];
    for (const note of textNoteRanges(cm.state)) {
      if (note.quiet) continue;
      const from = toPage(note.from, 1);
      const to = toPage(note.to, -1);
      if (to <= from || to > doc.content.size) continue;
      const active = note.id === value.active;
      decorations.push(
        Decoration.inline(from, to, {
          class: note.type === 'comment' ? 'ss-cmt' : `ss-bind${active ? ' ss-note-active' : ''}`,
          'data-note': note.id,
          ...(active ? { 'data-active': '' } : {}),
        }),
      );
    }
    return decorations;
  }
  /** @param {any[]} decorations */
  const notesKeyOf = (decorations) =>
    JSON.stringify(decorations.map((item) => [item.from, item.to, item.type.attrs]));
  const notesPlugin = new Plugin({
    key: notesKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, value) => tr.getMeta(notesKey) ?? value.map(tr.mapping, tr.doc),
    },
    props: { decorations: (state) => notesKey.getState(state) },
  });
  // Only a real change is dispatched: a transaction between a key press and
  // the page reading the new selection would put the old selection back.
  const refreshNotes = () => {
    cancelAnimationFrame(notesFrame);
    notesFrame = requestAnimationFrame(() => {
      if (view.isDestroyed || stale) return;
      const doc = view.state.doc;
      const next = noteDecorations(doc);
      if (notesKeyOf(next) === notesKeyOf(notesKey.getState(view.state).find())) return;
      view.dispatch(view.state.tr.setMeta(notesKey, DecorationSet.create(doc, next)));
    });
  };

  // Undo and redo run in the source; the cursor goes to the end of what changed.
  const history = (command) => () => {
    const before = editor.plain();
    if (!command(cm)) return true;
    const after = editor.plain();
    resync();
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    let end = 0;
    while (
      end < before.length - start &&
      end < after.length - start &&
      before[before.length - 1 - end] === after[after.length - 1 - end]
    )
      end++;
    const position = toPage(after.length - end, -1);
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.near(view.state.doc.resolve(position)))
        .scrollIntoView()
        .setMeta(FROM_SOURCE, true),
    );
    return true;
  };
  const item = S.nodes.list_item;
  const breakLine = chainCommands(exitCode, (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(S.nodes.hard_break.create()).scrollIntoView());
    return true;
  });
  const keys = pmKeymap({
    'Mod-z': history(undo),
    'Mod-y': history(redo),
    'Shift-Mod-z': history(redo),
    'Mod-b': toggleMark(S.marks.strong),
    'Mod-i': toggleMark(S.marks.em),
    'Shift-Enter': breakLine,
    Enter: splitListItem(item),
    Tab: sinkListItem(item),
    'Shift-Tab': liftListItem(item),
  });

  const marksAt = (state) => {
    const { from, $from, to, empty } = state.selection;
    const has = (type) =>
      empty
        ? !!type.isInSet(state.storedMarks ?? $from.marks())
        : state.doc.rangeHasMark(from, to, type);
    return [has(S.marks.strong) && 'b', has(S.marks.em) && 'i'].filter(Boolean);
  };

  const parsed = read(editor.plain());
  tail = parsed.tail;
  const view = new PMView(
    { mount: surface },
    {
      state: PMState.create({
        doc: S.node(
          'doc',
          null,
          parsed.blocks.map((entry) => entry.node),
        ),
        plugins: [keys, pmKeymap(baseKeymap), notesPlugin],
      }),
      nodeViews: {
        math_inline: (node) => formulaView(node, false),
        math_block: (node) => formulaView(node, true),
        raw: (node) => rawView(node),
        image: (node) => imageView(node, media ?? (() => Promise.resolve(null))),
      },
      attributes: {
        class: 'ss-page ss-page--md ss-page--edit',
        'aria-label': t('文稿正文'),
        spellcheck: 'false',
      },
      handleClickOn(page, _pos, node, nodePos, event) {
        if (node.type !== S.nodes.math_inline && node.type !== S.nodes.math_block) return false;
        const dom = /** @type {HTMLElement} */ (page.nodeDOM(nodePos));
        const box = dom?.querySelector?.('.ss-eqbox') ?? dom;
        onFormula?.({
          pos: nodePos,
          tex: node.attrs.tex,
          line: editor.lineAt(toSource(nodePos, 1)),
          rect: box.getBoundingClientRect(),
        });
        event.preventDefault();
        return true;
      },
      handleDOMEvents: {
        // The box of a task item ticks it.
        mousedown(page, event) {
          const target = /** @type {HTMLElement} */ (event.target);
          if (!target.matches?.('li.ss-md-task')) return false;
          if (event.clientX >= target.getBoundingClientRect().left) return false;
          const position = page.posAtDOM(target, 0) - 1;
          const node = page.state.doc.nodeAt(position);
          if (node?.type !== item) return false;
          page.dispatch(
            page.state.tr.setNodeMarkup(position, null, { checked: !node.attrs.checked }),
          );
          event.preventDefault();
          return true;
        },
      },
      dispatchTransaction(tr) {
        const before = view.state;
        let state = before.apply(tr);
        if (tr.docChanged && !tr.getMeta(FROM_SOURCE)) {
          const { resync: lost, fixes } = writeBack(before.doc, state.doc);
          if (lost) {
            view.updateState(state);
            resync();
            return;
          }
          if (fixes.length) state = applyFixes(state, fixes);
        }
        view.updateState(state);
        if (tr.docChanged) refreshNotes();
        if (tr.selectionSet || tr.docChanged) {
          onSelection?.();
          onMarks?.(marksAt(view.state));
        } else if (tr.storedMarksSet) onMarks?.(marksAt(view.state));
      },
    },
  );

  /**
   * Take blocks as the source reads them, keeping the cursor at the same
   * place in the text. @param {any} state @param {{index:number,gap:string,parsed:any[]}[]} fixes
   */
  function applyFixes(state, fixes) {
    const tr = state.tr.setMeta(FROM_SOURCE, true);
    const head = state.selection.head;
    let cursor = null;
    for (const fix of [...fixes].reverse()) {
      let pos = 0;
      for (let index = 0; index < fix.index; index++) pos += tr.doc.child(index).nodeSize;
      const node = tr.doc.child(fix.index);
      if (head >= pos && head <= pos + node.nodeSize)
        cursor = {
          pos,
          offset: node.textBetween(0, Math.max(0, head - pos - 1), '\n', OBJECT).length,
        };
      fix.parsed.forEach((entry, index) => {
        entries.set(entry.node, { ...entry, gap: index === 0 ? fix.gap : entry.gap });
      });
      tr.replaceWith(
        pos,
        pos + node.nodeSize,
        fix.parsed.map((entry) => entry.node),
      );
    }
    if (cursor) {
      // The same number of characters into the new block.
      let left = cursor.offset;
      let found = cursor.pos + 1;
      tr.doc.nodesBetween(cursor.pos, tr.doc.content.size, (node, pos) => {
        if (left < 0) return false;
        if (node.isText || node.isLeaf) {
          const size = node.isText ? node.text.length : 1;
          if (left <= size) {
            found = pos + left;
            left = -1;
            return false;
          }
          left -= size;
        }
        return true;
      });
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(found, tr.doc.content.size))));
    }
    return state.apply(tr);
  }

  const selectionRange = () => {
    const { from, to, empty } = view.state.selection;
    const start = toSource(from, 1);
    return { start, end: empty ? start : Math.max(start, toSource(to, -1)), empty };
  };

  return {
    view,
    /** The source changed from elsewhere: read it again (later, while hidden). */
    sourceChanged() {
      if (writing) return;
      if (!visible()) stale = true;
      else resync();
    },
    /** @param {any} update the source editor's update */
    sourceUpdated(update) {
      if (textNotesValue(update.startState) !== textNotesValue(update.state)) refreshNotes();
    },
    /** The page was shown: catch up with the source. */
    shown() {
      if (stale) resync();
      refreshNotes();
    },
    selection() {
      const { start, end, empty } = selectionRange();
      if (empty || end <= start) return null;
      const quote = cm.state.sliceDoc(start, end);
      if (!quote.trim()) return null;
      const { from, to } = view.state.selection;
      const first = view.coordsAtPos(from);
      const last = view.coordsAtPos(to);
      return {
        quote,
        from: editor.fileOffset(start),
        to: editor.fileOffset(end),
        rect: new DOMRect(
          Math.min(first.left, last.left),
          first.top,
          Math.abs(last.right - first.left),
          last.bottom - first.top,
        ),
      };
    },
    cursor: () => editor.fileOffset(toSource(view.state.selection.head, 1)),
    /** @param {number} x @param {number} y */
    caretAt(x, y) {
      const at = view.posAtCoords({ left: x, top: y });
      if (at)
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at.pos)));
    },
    selectSentence() {
      const { empty, $head } = view.state.selection;
      if (!empty || !$head.parent.isTextblock) return;
      const parent = $head.parent;
      const text = parent.textBetween(0, parent.content.size, '\n', OBJECT);
      const [from, to] = sentenceAround(text, $head.parentOffset);
      if (to > from)
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, $head.start() + from, $head.start() + to),
          ),
        );
    },
    /** Select file offsets `from`–`to` on the page. @param {number} from @param {number} to */
    reveal(from, to) {
      const start = toPage(editor.editorPosition(from), 1);
      const end = Math.max(start, toPage(editor.editorPosition(to), -1));
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, start, end))
          .scrollIntoView(),
      );
      view.focus();
      return true;
    },
    /** @param {boolean} [cut] */
    async copy(cut = false) {
      const { from, to, empty } = view.state.selection;
      if (empty) return;
      await navigator.clipboard.writeText(view.state.doc.textBetween(from, to, '\n\n', OBJECT));
      if (cut) view.dispatch(view.state.tr.deleteSelection());
      view.focus();
    },
    /** @param {string} value */
    paste(value) {
      view.dispatch(view.state.tr.insertText(value));
      view.focus();
    },
    notesAt() {
      const { start, end } = selectionRange();
      return textNotesAt(cm.state, start, end);
    },
    /** @param {string} name */
    command(name) {
      const run = {
        undo: history(undo),
        redo: history(redo),
        b: toggleMark(S.marks.strong),
        i: toggleMark(S.marks.em),
        ul: listCommand(S.nodes.bullet_list),
        ol: listCommand(S.nodes.ordered_list),
      }[name];
      run?.(view.state, view.dispatch);
      view.focus();
    },
    focus: () => view.focus(),
    /** @param {number} number 1-based source line */
    scrollToLine(number) {
      const lines = cm.state.doc;
      const position = toPage(lines.line(Math.max(1, Math.min(number, lines.lines))).from, 1);
      const items = layout(view.state.doc);
      const top = items.findLast((entry) => entry.pos <= position) ?? items[0];
      /** @type {HTMLElement | null} */ (view.nodeDOM(top.pos))?.scrollIntoView?.({
        block: 'start',
      });
    },
    lineColumn() {
      const position = toSource(view.state.selection.head, 1);
      const line = cm.state.doc.lineAt(Math.min(position, cm.state.doc.length));
      return { line: line.number, column: position - line.from + 1 };
    },
    marks: () => marksAt(view.state),
    /** Replace the formula at `pos` with `tex`. @param {number} pos @param {string} tex */
    setFormula(pos, tex) {
      const node = view.state.doc.nodeAt(pos);
      if (!node || (node.type !== S.nodes.math_inline && node.type !== S.nodes.math_block)) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, { tex, raw: null }));
    },
    /** A new formula at the cursor: on its own when the line is empty. @param {string} tex */
    insertFormula(tex) {
      const { $from } = view.state.selection;
      const empty = $from.parent.type === S.nodes.paragraph && !$from.parent.content.size;
      const tr = view.state.tr;
      if (empty) tr.replaceWith($from.before(), $from.after(), S.nodes.math_block.create({ tex }));
      else tr.replaceSelectionWith(S.nodes.math_inline.create({ tex }), false);
      view.dispatch(tr.scrollIntoView());
      view.focus();
    },
    /** The box of the cursor, for the formula editor. */
    cursorRect() {
      const box = view.coordsAtPos(view.state.selection.head);
      return new DOMRect(box.left, box.top, 1, box.bottom - box.top);
    },
    dispose() {
      cancelAnimationFrame(notesFrame);
      view.destroy();
    },
  };
}

/** Make the blocks a list of `type`, or take them out of it when they are one. */
function listCommand(type) {
  return (state, dispatch) => {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type === S.nodes.list_item) continue;
      if (node.type === type) return liftListItem(S.nodes.list_item)(state, dispatch);
      if (node.type === S.nodes.bullet_list || node.type === S.nodes.ordered_list) {
        dispatch?.(state.tr.setNodeMarkup($from.before(depth), type));
        return true;
      }
    }
    return wrapInList(type)(state, dispatch);
  };
}
