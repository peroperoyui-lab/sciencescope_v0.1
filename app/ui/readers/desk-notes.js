// Comments and indexes in the desk's editors (EDITING_DESK.md §6.2). They are
// marks that move with the text: typing inside one lengthens it, deleting its
// last character removes it, and undo brings the text and the mark back
// together. In a docx page an index is a ProseMirror mark and a Word comment
// is the range between its delimiters; in Markdown and TeX both are ranges in
// a CodeMirror state field whose changes undo with the text.
import {
  Plugin,
  PluginKey,
  Decoration,
  DecorationSet,
  StateField,
  StateEffect,
  CMDecoration,
  EditorView,
  Transaction,
  invertedEffects,
} from './vendor.js';
import { findBlock, inlineLength, isBlock, offsetToPos } from './desk-positions.js';

/**
 * An index on docx text. Never parsed from pasted HTML, so a paste cannot copy one.
 * @type {any}
 */
export const indexMarkSpec = {
  attrs: { id: {} },
  inclusive: false,
  excludes: '',
  toDOM: (mark) => ['span', { class: 'ss-bind', 'data-note': mark.attrs.id }, 0],
};

const pageKey = new PluginKey('desk-notes');

/** Word comment ranges, and the active item's text, as decorations. */
function pageDecorations(doc, active) {
  const decorations = [];
  const open = new Map();
  doc.descendants((node, pos) => {
    const id = node.attrs?.comment;
    if (id && node.attrs.atom === 'comment-start') open.set(id, pos + node.nodeSize);
    else if (id && node.attrs.atom === 'comment-end' && open.has(id)) {
      const from = open.get(id);
      open.delete(id);
      if (pos > from)
        decorations.push(
          Decoration.inline(
            from,
            pos,
            { class: 'ss-cmt', 'data-note': id, ...(id === active ? { 'data-active': '' } : {}) },
            { note: id, inclusiveStart: true, inclusiveEnd: true },
          ),
        );
    } else if (active && node.isText && node.marks.some((mark) => mark.attrs.id === active))
      decorations.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'ss-note-active' }));
    return true;
  });
  return DecorationSet.create(doc, decorations);
}

/** Decorations for Word comments and the active item on a docx page. */
export const pageNotesPlugin = () =>
  new Plugin({
    key: pageKey,
    state: {
      init: (_, state) => ({ active: null, set: pageDecorations(state.doc, null) }),
      apply(tr, value) {
        const meta = tr.getMeta(pageKey);
        if (meta === undefined && !tr.docChanged) return value;
        const active = meta === undefined ? value.active : meta;
        return { active, set: pageDecorations(tr.doc, active) };
      },
    },
    props: { decorations: (state) => pageKey.getState(state).set },
  });

/**
 * Each index's range as the server counts it: the paragraph it starts in and
 * offsets in that paragraph's text. A paragraph's temporary id is resolved by
 * the server.
 * @param {any} doc
 * @returns {{id:string,blockId:string,from:number,to:number}[]}
 */
export function pageIndexRanges(doc) {
  const ranges = new Map();
  doc.descendants((node) => {
    if (!isBlock(node)) return true;
    if (node.type.name !== 'para') return false;
    let at = 0;
    node.forEach((child) => {
      const length = inlineLength(child);
      for (const mark of child.marks) {
        if (mark.type.name !== 'index') continue;
        const known = ranges.get(mark.attrs.id);
        if (!known)
          ranges.set(mark.attrs.id, {
            id: mark.attrs.id,
            blockId: node.attrs.id,
            from: at,
            to: at + length,
          });
        else if (known.blockId === node.attrs.id) known.to = at + length;
      }
      at += length;
    });
    return false;
  });
  return [...ranges.values()];
}

/**
 * Put the server's indexes on the page, outside the undo history.
 * @param {any} view
 * @param {{id:string,blockId:string,from:number,to:number}[]} items
 */
export function applyPageIndexes(view, items) {
  const current = new Map(pageIndexRanges(view.state.doc).map((range) => [range.id, range]));
  const same =
    current.size === items.length &&
    items.every((item) => {
      const known = current.get(item.id);
      return known?.blockId === item.blockId && known.from === item.from && known.to === item.to;
    });
  if (same) return;
  const type = view.state.schema.marks.index;
  const tr = view.state.tr.removeMark(0, view.state.doc.content.size, type);
  for (const item of items) {
    const found = findBlock(tr.doc, item.blockId);
    if (found?.node.type.name !== 'para') continue;
    const from = offsetToPos(found.node, found.pos, item.from);
    const to = offsetToPos(found.node, found.pos, item.to);
    if (to > from) tr.addMark(from, to, type.create({ id: item.id }));
  }
  view.dispatch(tr.setMeta('addToHistory', false).setMeta('desk-remote', true));
}

/** Items whose text includes positions `from`–`to` on a docx page. @param {any} state */
export function pageNotesAt(state, from, to = from) {
  const ids = new Set();
  for (const decoration of pageKey.getState(state).set.find(from, to))
    if (decoration.spec.note) ids.add(decoration.spec.note);
  const $from = state.doc.resolve(from);
  for (const mark of [...$from.marks(), ...($from.nodeAfter?.marks ?? [])])
    if (mark.type.name === 'index') ids.add(mark.attrs.id);
  if (to > from)
    state.doc.nodesBetween(from, to, (node) => {
      for (const mark of node.marks) if (mark.type.name === 'index') ids.add(mark.attrs.id);
    });
  return [...ids];
}

/** Highlight one item's text on the page (null for none). @param {any} view @param {string|null} id */
export const activatePage = (view, id) => view.dispatch(view.state.tr.setMeta(pageKey, id));

// Markdown and TeX: ranges in editor positions, kept in a state field.
const mapNote = (value, mapping) => ({
  ...value,
  from: mapping.mapPos(value.from, 1),
  to: mapping.mapPos(value.to, -1),
});
/** @typedef {{id:string,type:string,quiet?:boolean,from:number,to:number}} TextNote */
const putNote = /** @type {any} */ (StateEffect.define({ map: mapNote }));
const setNotes = /** @type {any} */ (StateEffect.define());
const setActive = /** @type {any} */ (StateEffect.define());

/**
 * @param {Map<string, any>} notes
 * @param {string|null} active
 */
function textDecorations(notes, active) {
  const ranges = [];
  for (const note of notes.values()) {
    if (note.quiet) continue;
    const attributes = {
      'data-note': note.id,
      ...(note.id === active ? { 'data-active': '' } : {}),
    };
    const className =
      note.type === 'comment' ? 'ss-cmt' : `ss-bind${note.id === active ? ' ss-note-active' : ''}`;
    ranges.push(CMDecoration.mark({ class: className, attributes }).range(note.from, note.to));
  }
  return CMDecoration.set(ranges, true);
}

/** @type {any} */
const textField = StateField.define({
  create: () => ({ notes: new Map(), active: null, decorations: CMDecoration.none }),
  update(value, tr) {
    let { notes, active } = value;
    let changed = false;
    if (tr.docChanged) {
      notes = new Map();
      for (const [id, note] of value.notes) {
        const moved = mapNote(note, tr.changes);
        if (moved.to > moved.from) notes.set(id, moved);
      }
      changed = true;
    }
    for (const effect of /** @type {any[]} */ (tr.effects)) {
      if (effect.is(setNotes)) notes = new Map(effect.value.map((note) => [note.id, note]));
      else if (effect.is(putNote)) {
        notes = new Map(notes);
        if (effect.value.to > effect.value.from) notes.set(effect.value.id, effect.value);
        else notes.delete(effect.value.id);
      } else if (effect.is(setActive)) active = effect.value;
      else continue;
      changed = true;
    }
    return changed ? { notes, active, decorations: textDecorations(notes, active) } : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

// Undo puts back each range a change touched exactly as it was before it.
const undoNotes = invertedEffects.of((tr) => {
  if (!tr.docChanged) return [];
  const effects = [];
  for (const note of tr.startState.field(textField).notes.values()) {
    let touched = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA <= note.to && toA >= note.from) touched = true;
    });
    if (touched) effects.push(putNote.of(note));
  }
  return effects;
});

/** The CodeMirror extensions for comments and indexes. */
export const textNotes = () => [textField, undoNotes];

/** @param {any} state @returns {any[]} ranges in editor positions */
export const textNoteRanges = (state) => [...state.field(textField).notes.values()];

/**
 * Put the server's items in, outside the undo history.
 * @param {any} view @param {{id:string,type:string,quiet?:boolean,from:number,to:number}[]} notes
 */
export function applyTextNotes(view, notes) {
  const current = view.state.field(textField).notes;
  const same =
    current.size === notes.length &&
    notes.every((note) => {
      const known = current.get(note.id);
      return (
        known?.from === note.from &&
        known.to === note.to &&
        known.type === note.type &&
        !!known.quiet === !!note.quiet
      );
    });
  if (same) return;
  view.dispatch({
    effects: setNotes.of(notes),
    annotations: [Transaction.addToHistory.of(false)],
  });
}

/** Items whose text includes editor positions `from`–`to`. @param {any} state */
export const textNotesAt = (state, from, to = from) =>
  textNoteRanges(state)
    .filter((note) => !note.quiet && note.from <= to && note.to >= from)
    .map((note) => note.id);

/** @param {any} view @param {string|null} id */
export const activateText = (view, id) => view.dispatch({ effects: setActive.of(id) });
