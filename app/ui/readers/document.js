import DOMPurify from 'dompurify';
import {
  EditorState,
  EditorView,
  lineNumbers,
  drawSelection,
  StreamLanguage,
  syntaxHighlighting,
  defaultHighlightStyle,
  stex,
  javascript,
  python,
  Papa,
  renderDocx,
} from './vendor.js';
import { renderMarkdown, renderFormula } from '../markdown.js';

/**
 * @param {HTMLElement} surface
 * @param {any} doc
 * @param {string} mode
 * @param {() => Promise<ArrayBuffer>} bytes
 * @returns {Promise<{dispose:()=>void,rows?:number,shown?:number,scrollToLine?:(line:number)=>void}>}
 */
export async function mountDocument(surface, doc, mode, bytes) {
  surface.replaceChildren();
  if (doc.format === 'docx') {
    if (mode === 'layout') {
      const detached = document.createElement('div');
      await renderDocx(await bytes(), detached, undefined, {
        ignoreFonts: true,
        useBase64URL: true,
        renderComments: false,
        renderAltChunks: false,
      });
      surface.innerHTML = DOMPurify.sanitize(detached.innerHTML);
    } else surface.innerHTML = DOMPurify.sanitize(doc.html ?? '');
  } else if (doc.format === 'csv') {
    const rows = Papa.parse(doc.text ?? '', { skipEmptyLines: true }).data;
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    for (const row of rows.slice(0, 500)) {
      const tr = document.createElement('tr');
      for (const cell of row) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    surface.append(table);
    return { dispose() {}, rows: rows.length, shown: Math.min(rows.length, 500) };
  } else if (doc.format === 'markdown' && mode === 'readable') {
    surface.innerHTML = renderMarkdown(doc.text);
  } else if (doc.format === 'latex' && mode === 'formulas') {
    surface.innerHTML = renderFormula(doc.text);
  } else {
    const language =
      doc.format === 'latex'
        ? stex
        : /^(js|mjs|cjs|ts|json)$/u.test(doc.extension)
          ? javascript
          : doc.extension === 'py'
            ? python
            : null;
    const editor = new EditorView({
      parent: surface,
      state: EditorState.create({
        doc: doc.text ?? '',
        extensions: [
          lineNumbers(),
          drawSelection(),
          EditorView.lineWrapping,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          syntaxHighlighting(defaultHighlightStyle),
          ...(language ? [StreamLanguage.define(language)] : []),
        ],
      }),
    });
    return {
      dispose: () => editor.destroy(),
      /** @param {number} number 1-based */
      scrollToLine(number) {
        const lines = editor.state.doc;
        const line = lines.line(Math.max(1, Math.min(number, lines.lines)));
        editor.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
      },
    };
  }
  return { dispose() {} };
}
