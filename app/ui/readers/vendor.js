// A local browser bundle served by the host; dependencies remain replaceable.
export { EditorState, Transaction, StateField, StateEffect } from '@codemirror/state';
export {
  EditorView,
  lineNumbers,
  drawSelection,
  Decoration as CMDecoration,
} from '@codemirror/view';
export { StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
export { stex } from '@codemirror/legacy-modes/mode/stex';
export { javascript } from '@codemirror/legacy-modes/mode/javascript';
export { python } from '@codemirror/legacy-modes/mode/python';
export { default as Papa } from 'papaparse';
export { renderAsync as renderDocx } from 'docx-preview';
// The editing desk (U2): ProseMirror for docx pages, CodeMirror commands for sources.
export { Schema } from 'prosemirror-model';
export {
  EditorState as PMState,
  Plugin,
  PluginKey,
  TextSelection,
  Selection,
} from 'prosemirror-state';
export { EditorView as PMView, Decoration, DecorationSet } from 'prosemirror-view';
export { keymap as pmKeymap } from 'prosemirror-keymap';
export {
  history as pmHistory,
  undo as pmUndo,
  redo as pmRedo,
  undoDepth as pmUndoDepth,
  redoDepth as pmRedoDepth,
} from 'prosemirror-history';
export { baseKeymap, toggleMark, splitBlockAs, chainCommands } from 'prosemirror-commands';
export { keymap } from '@codemirror/view';
export {
  history,
  historyKeymap,
  defaultKeymap,
  undo,
  redo,
  undoDepth,
  redoDepth,
  invertedEffects,
} from '@codemirror/commands';
export { diffArrays } from 'diff';
