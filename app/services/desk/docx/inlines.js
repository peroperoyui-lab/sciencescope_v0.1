import { readMarks } from './marks.js';

const atomTypes = {
  'w:ins': 'ins',
  'w:del': 'del',
  'm:oMath': 'math',
  'm:oMathPara': 'math',
  'w:drawing': 'image',
  'w:pict': 'image',
  'w:fldSimple': 'field',
  'w:footnoteReference': 'footnote',
  'w:endnoteReference': 'footnote',
  'w:bookmarkStart': 'bookmark',
  'w:bookmarkEnd': 'bookmark',
  'w:commentRangeStart': 'comment-start',
  'w:commentRangeEnd': 'comment-end',
  'w:commentReference': 'comment-reference',
  'w:txbxContent': 'textbox',
  'w:tab': 'tab',
  'w:br': 'break',
  'w:cr': 'break',
  'w:noBreakHyphen': 'symbol',
  'w:softHyphen': 'symbol',
  'w:sym': 'symbol',
};
const runParts = new Set([
  'w:rPr',
  'w:t',
  'w:tab',
  'w:br',
  'w:cr',
  'w:noBreakHyphen',
  'w:softHyphen',
  'w:sym',
  'w:lastRenderedPageBreak',
]);
const containers = new Set(['w:hyperlink', 'w:smartTag', 'w:customXml', 'w:sdt']);
const propertyTags = {
  'w:p': 'w:pPr',
  'w:smartTag': 'w:smartTagPr',
  'w:customXml': 'w:customXmlPr',
};

/**
 * Index inline provenance once. Containers and runs retain raw XML boundaries;
 * a single run may contribute several editable texts and indivisible characters.
 * @param {string} xml
 * @param {any[]} spans
 * @returns {any}
 */
export function createInlineReader(xml, spans) {
  const children = new Map();
  for (const span of spans) {
    if (!children.has(span.parent)) children.set(span.parent, []);
    children.get(span.parent).push(span);
  }
  const inside = (span) => spans.slice(span.index, span.after);
  const raw = (span) => xml.slice(span.start, span.end);
  const runs = spans
    .filter((span) => span.tag === 'w:r')
    .map((span) => {
      const rPr = (children.get(span.index) ?? []).find((child) => child.tag === 'w:rPr') ?? null;
      return { ...span, rPr, marks: readMarks(children.get(rPr?.index) ?? []), inlines: [] };
    });
  const runByIndex = new Map(runs.map((run, index) => [run.index, index]));
  const atoms = [];
  const atomAt = new Map();
  const wraps = [];
  function textOf(span, tag, cached = false) {
    const states = [];
    let deletedEnd = -1;
    let text = '';
    for (const part of inside(span)) {
      if (part.tag === 'w:del') deletedEnd = Math.max(deletedEnd, part.end);
      if (part.start < deletedEnd) continue;
      const type = part.attrs['w:fldCharType'];
      if (cached && part.tag === 'w:fldChar') {
        if (type === 'begin') states.push(false);
        if (type === 'separate' && states.length) states[states.length - 1] = true;
        if (type === 'end') states.pop();
      }
      if (part.tag === tag && states.every(Boolean) && (!span.complexField || states.length))
        text += part.text;
    }
    return text;
  }
  function display(span, type) {
    if (type === 'math') return textOf(span, 'm:t');
    if (type === 'field') return textOf(span, 'w:t', true);
    if (type === 'tab') return '\t';
    if (type === 'break') return '\n';
    if (span.tag === 'w:noBreakHyphen') return '\u2011';
    if (span.tag === 'w:softHyphen') return '\u00AD';
    if (span.tag === 'w:sym') {
      const code = parseInt(span.attrs['w:char'], 16);
      if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff)
        return String.fromCodePoint(code);
    }
    return '\uFFFC';
  }
  function addAtom(span, type) {
    const key = `${span.start}:${span.end}`;
    let ref = atomAt.get(key);
    if (ref == null) {
      ref = atoms.push({ ...span, atom: type, display: display(span, type) }) - 1;
      atomAt.set(key, ref);
    }
    return { atom: type, ref, display: atoms[ref].display };
  }
  for (const span of spans) if (atomTypes[span.tag]) addAtom(span, atomTypes[span.tag]);
  function fieldBounds(first, last) {
    const ancestors = new Set();
    for (let span = first; span; span = spans[span.parent]) ancestors.add(span.index);
    let common = last;
    while (common && !ancestors.has(common.index)) common = spans[common.parent];
    // A field may start outside a hyperlink and end inside it. Retain whole
    // child elements so copying that field cannot leave unmatched XML tags.
    if (
      common &&
      (common.tag === 'w:p' || containers.has(common.tag) || common.tag === 'w:sdtContent')
    ) {
      while (first.parent !== common.index) first = spans[first.parent];
      while (last.parent !== common.index) last = spans[last.parent];
    }
    return { ...first, end: last.end, after: last.after, complexField: true };
  }
  const fields = [];
  const stack = [];
  for (const span of spans) {
    if (span.tag !== 'w:fldChar') continue;
    let run = spans[span.parent];
    while (run && run.tag !== 'w:r') run = spans[run.parent];
    if (span.attrs['w:fldCharType'] === 'begin') stack.push(run ?? span);
    if (span.attrs['w:fldCharType'] === 'end' && stack.length) {
      const first = stack.pop();
      const last = run ?? span;
      fields.push(fieldBounds(first, last));
    }
  }
  const fieldAt = new Map();
  for (const field of fields) {
    if (!fieldAt.has(field.start) || fieldAt.get(field.start).end < field.end)
      fieldAt.set(field.start, field);
    addAtom(field, 'field');
  }
  const citation = (span) => {
    const properties = (children.get(span.index) ?? []).find((part) => part.tag === 'w:sdtPr');
    return (
      properties &&
      inside(properties).some(
        (part) =>
          ['w:citation', 'w:bibliography'].includes(part.tag) ||
          (['w:tag', 'w:alias'].includes(part.tag) &&
            /CSL|Mendeley|Citavi|EndNote/iu.test(part.attrs['w:val'] ?? '')),
      )
    );
  };
  function readContainer(container, wrap = undefined) {
    const inlines = [];
    const properties = (children.get(container.index) ?? []).find(
      (part) => part.tag === propertyTags[container.tag],
    );
    let cursor = properties?.end ?? container.openEnd;
    for (const span of children.get(container.index) ?? []) {
      if (span.start < cursor) continue;
      if (span.start > cursor) inlines.push(addAtom({ start: cursor, end: span.start }, 'opaque'));
      cursor = span.end;
      if (span.tag === 'w:pPr') continue;
      const field = fieldAt.get(span.start);
      if (field && field.end <= container.closeStart) {
        inlines.push(addAtom(field, 'field'));
        cursor = field.end;
        continue;
      }
      const parts = children.get(span.index) ?? [];
      if (span.tag === 'w:r' && parts.every((part) => runParts.has(part.tag))) {
        const run = runByIndex.get(span.index);
        const values = [];
        for (const part of parts) {
          if (part.tag === 'w:t') values.push({ text: part.text, marks: runs[run].marks, run });
          else if (atomTypes[part.tag]) values.push({ ...addAtom(part, atomTypes[part.tag]), run });
        }
        if (!values.length) values.push({ text: '', marks: runs[run].marks, run });
        runs[run].inlines = values;
        inlines.push(...values);
      } else if (containers.has(span.tag) && !citation(span)) {
        const content =
          span.tag === 'w:sdt' ? parts.find((part) => part.tag === 'w:sdtContent') : span;
        if (content) {
          const ref = wraps.length;
          const wrapper = {
            ...span,
            contentStart:
              parts.find((part) => part.tag === propertyTags[span.tag])?.end ?? content.openEnd,
            contentEnd: content.closeStart,
            parent: wrap,
            inlines: [],
          };
          wraps.push(wrapper);
          wrapper.inlines = readContainer(content, ref);
          if (wrapper.inlines.length) inlines.push(...wrapper.inlines);
          else inlines.push(addAtom(span, 'opaque'));
        } else inlines.push(addAtom(span, 'opaque'));
      } else {
        const nested = inside(span).find((part) => atomTypes[part.tag]);
        const type = citation(span)
          ? 'field'
          : (atomTypes[span.tag] ?? atomTypes[nested?.tag] ?? 'opaque');
        inlines.push(addAtom(span, type));
      }
    }
    if (cursor < container.closeStart)
      inlines.push(addAtom({ start: cursor, end: container.closeStart }, 'opaque'));
    if (wrap != null) for (const inline of inlines) if (inline.wrap == null) inline.wrap = wrap;
    return inlines;
  }
  return { children, inside, raw, runs, atoms, wraps, fields, readContainer };
}
