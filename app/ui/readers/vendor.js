// A local browser bundle served by the host; dependencies remain replaceable.
export { EditorState } from '@codemirror/state';
export { EditorView, lineNumbers, drawSelection } from '@codemirror/view';
export { StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
export { stex } from '@codemirror/legacy-modes/mode/stex';
export { javascript } from '@codemirror/legacy-modes/mode/javascript';
export { python } from '@codemirror/legacy-modes/mode/python';
export { default as Papa } from 'papaparse';
export { renderAsync as renderDocx } from 'docx-preview';
