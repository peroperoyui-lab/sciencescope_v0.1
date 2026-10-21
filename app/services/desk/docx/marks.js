/**
 * Direct formatting only; character styles remain untouched in the source XML.
 * @param {any[]} properties
 * @returns {string[]}
 */
export function readMarks(properties) {
  const marks = [];
  const value = (tag) => properties.find((span) => span.tag === tag);
  for (const mark of ['b', 'i']) {
    const span = value('w:' + mark);
    if (span && !['0', 'false', 'off'].includes(span.attrs['w:val'])) marks.push(mark);
  }
  const underline = value('w:u');
  if (underline && underline.attrs['w:val'] !== 'none') marks.push('u');
  const vertical = value('w:vertAlign')?.attrs['w:val'];
  if (vertical === 'superscript') marks.push('sup');
  if (vertical === 'subscript') marks.push('sub');
  return marks;
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {boolean}
 */
export function sameMarks(left, right) {
  return left.length === right.length && left.every((mark) => right.includes(mark));
}

/**
 * Patch only explicitly changed marks, retaining fonts, styles and other rPr bytes.
 * @param {any} document
 * @param {any} run
 * @param {string[]} marks
 * @param {string} prefix
 * @returns {string}
 */
export function writeProperties(document, run, marks, prefix) {
  const original = run?.marks ?? [];
  const properties = run?.rPr;
  if (sameMarks(original, marks)) return properties ? document.raw(properties) : '';
  const changed = new Map();
  for (const mark of ['b', 'i', 'u']) {
    if (original.includes(mark) === marks.includes(mark)) continue;
    changed.set(
      'w:' + mark,
      marks.includes(mark)
        ? `<${prefix}${mark}${mark === 'u' ? ` ${prefix}val="single"` : ''}/>`
        : '',
    );
  }
  const vertical = (list) =>
    list.includes('sup') ? 'superscript' : list.includes('sub') ? 'subscript' : null;
  if (vertical(original) !== vertical(marks))
    changed.set(
      'w:vertAlign',
      vertical(marks) ? `<${prefix}vertAlign ${prefix}val="${vertical(marks)}"/>` : '',
    );
  if (!properties) return `<${prefix}rPr>${[...changed.values()].join('')}</${prefix}rPr>`;
  let cursor = properties.openEnd;
  let content = '';
  for (const span of document.children.get(properties.index) ?? []) {
    if (!changed.has(span.tag)) continue;
    content += document.xml.slice(cursor, span.start);
    cursor = span.end;
  }
  content += document.xml.slice(cursor, properties.closeStart) + [...changed.values()].join('');
  const opening = document.xml.slice(properties.start, properties.openEnd);
  return (
    (properties.selfClosing ? opening.replace(/\/>$/u, '>') : opening) +
    content +
    `</${properties.name}>`
  );
}
