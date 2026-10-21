import { SaxesParser } from 'saxes';

export const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const namespaces = {
  [WORD]: 'w',
  'http://schemas.openxmlformats.org/officeDocument/2006/math': 'm',
  'http://schemas.microsoft.com/office/word/2010/wordml': 'w14',
  'http://schemas.microsoft.com/office/word/2012/wordml': 'w15',
  'http://schemas.microsoft.com/office/word/2016/wordml/cid': 'w16cid',
  'http://schemas.microsoft.com/office/word/2018/wordml/cex': 'w16cex',
};

/**
 * SAX events index original UTF-16 string spans. The flat index is not a DOM:
 * no serialization or normalized XML is used when writing an existing part.
 * @param {string} xml
 * @returns {any[]}
 */
export function indexXml(xml) {
  const parser = new SaxesParser({ xmlns: true });
  const spans = [];
  const stack = [];
  let start = 0;
  const qualified = (tag) =>
    namespaces[tag.uri] ? `${namespaces[tag.uri]}:${tag.local}` : tag.name;
  parser.on('opentagstart', () => {
    start = xml.lastIndexOf('<', parser.position - 1);
  });
  parser.on('opentag', (tag) => {
    const span = {
      index: spans.length,
      parent: stack.at(-1)?.index ?? -1,
      name: tag.name,
      tag: qualified(tag),
      attrs: Object.fromEntries(
        Object.values(tag.attributes).map((attr) => [qualified(attr), attr.value]),
      ),
      start,
      openEnd: parser.position,
      closeStart: parser.position,
      end: parser.position,
      selfClosing: tag.isSelfClosing,
      text: '',
    };
    spans.push(span);
    stack.push(span);
  });
  parser.on('text', (text) => {
    if (stack.length) stack.at(-1).text += text;
  });
  parser.on('cdata', (text) => {
    if (stack.length) stack.at(-1).text += text;
  });
  parser.on('closetag', () => {
    const span = stack.pop();
    span.end = parser.position;
    span.after = spans.length;
    span.closeStart = span.selfClosing ? span.openEnd : xml.lastIndexOf('</', span.end - 1);
  });
  parser.write(xml).close();
  return spans;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function escapeXml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character];
  });
}

/**
 * @param {string} xml
 * @param {string} content
 * @returns {string}
 */
export function appendXml(xml, content) {
  const root = indexXml(xml)[0];
  if (root.selfClosing)
    return xml.slice(0, root.openEnd - 2) + '>' + content + `</${root.name}>` + xml.slice(root.end);
  return xml.slice(0, root.closeStart) + content + xml.slice(root.closeStart);
}

/**
 * Apply disjoint replacements without serializing untouched XML.
 * @param {string} xml
 * @param {any[]} edits
 * @returns {string}
 */
export function patchXml(xml, edits) {
  let cursor = 0;
  let result = '';
  for (const edit of edits.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )) {
    result += xml.slice(cursor, edit.start) + (edit.text ?? '');
    cursor = edit.end;
  }
  return result + xml.slice(cursor);
}
