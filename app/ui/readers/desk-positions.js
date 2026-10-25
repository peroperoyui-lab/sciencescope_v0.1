// Where a docx paragraph's characters are in the ProseMirror page. The server
// counts a paragraph's text with each object as its display text and Word
// comment delimiters as nothing; these helpers count the same way.

/** How many characters an inline node takes in the server's block text. @param {any} node */
export const inlineLength = (node) =>
  node.isText ? node.text.length : String(node.attrs.display ?? '').length;

/** True for nodes the server lists as blocks (paragraphs and cross-paragraph fields). @param {any} node */
export const isBlock = (node) => node.type.name === 'para' || node.type.name === 'opaque';

/** The paragraph (or cross-paragraph field) with this id. @param {any} doc @param {string} id */
export function findBlock(doc, id) {
  let found = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (!isBlock(node)) return true;
    if (node.attrs.id === id) found = { node, pos };
    return false;
  });
  return found;
}

/** A character offset in a paragraph's text as a document position. */
export function offsetToPos(node, pos, offset) {
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
export function posToOffset(node, pos, target) {
  let at = 0;
  node.forEach((child, start) => {
    const begin = pos + 1 + start;
    if (begin >= target) return;
    at += child.isText ? Math.min(child.text.length, target - begin) : inlineLength(child);
  });
  return at;
}
