// Message and document text is Markdown; render it to sanitised HTML.
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

/** @param {string} text */
export function renderMarkdown(text) {
  return DOMPurify.sanitize(/** @type {string} */ (marked.parse(text ?? '', { async: false })));
}
