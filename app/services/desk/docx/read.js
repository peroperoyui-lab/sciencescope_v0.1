import JSZip from 'jszip';
import { indexXml } from './xml.js';

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
};

function ancestors(span, spans) {
  const result = [];
  for (let parent = spans[span.parent]; parent; parent = spans[parent.parent]) result.push(parent);
  return result;
}

function readBlocks(xml, spans) {
  const children = new Map();
  for (const span of spans) {
    if (!children.has(span.parent)) children.set(span.parent, []);
    children.get(span.parent).push(span);
  }
  const raw = (span) => xml.slice(span.start, span.end);
  // Spans are in document order, so a span's descendants follow it contiguously.
  const inside = (span) => {
    let end = span.index + 1;
    while (end < spans.length && spans[end].start < span.end) end++;
    return spans.slice(span.index, end);
  };
  const runs = spans
    .filter((span) => span.tag === 'w:r')
    .map((span) => ({
      ...span,
      rPr: (children.get(span.index) ?? []).find((child) => child.tag === 'w:rPr') ?? null,
    }));
  const runByIndex = new Map(runs.map((run, index) => [run.index, index]));
  const atoms = spans
    .filter((span) => atomTypes[span.tag])
    .map((span) => ({
      ...span,
      atom: atomTypes[span.tag],
    }));
  const fieldStack = [];
  for (const span of spans.filter((node) => node.tag === 'w:fldChar')) {
    const run = ancestors(span, spans).find((node) => node.tag === 'w:r');
    if (span.attrs['w:fldCharType'] === 'begin') fieldStack.push(run ?? span);
    if (span.attrs['w:fldCharType'] === 'end' && fieldStack.length) {
      const first = fieldStack.pop();
      atoms.push({ ...first, end: (run ?? span).end, atom: 'field' });
    }
  }
  const atomAt = new Map(atoms.map((atom, ref) => [`${atom.start}:${atom.end}`, ref]));
  const fields = atoms.filter((atom) => atom.atom === 'field');
  const fieldAt = new Map();
  for (const field of fields) if (!fieldAt.has(field.start)) fieldAt.set(field.start, field);
  const addAtom = (span, type) => {
    const key = `${span.start}:${span.end}`;
    let ref = atomAt.get(key);
    if (ref == null) {
      ref = atoms.push({ ...span, atom: type }) - 1;
      atomAt.set(key, ref);
    }
    return { atom: type, ref };
  };
  const paragraphs = spans.filter(
    (span) =>
      span.tag === 'w:p' &&
      !ancestors(span, spans).some((parent) => ['w:p', 'w:txbxContent'].includes(parent.tag)),
  );
  const blocks = paragraphs.map((paragraph, ordinal) => {
    const direct = children.get(paragraph.index) ?? [];
    const pPr = direct.find((span) => span.tag === 'w:pPr') ?? null;
    const properties = pPr ? inside(pPr) : [];
    const style = properties.find((span) => span.tag === 'w:pStyle')?.attrs['w:val'] ?? null;
    const level = properties.find((span) => span.tag === 'w:outlineLvl')?.attrs['w:val'];
    const table = ancestors(paragraph, spans).some((span) => span.tag === 'w:tc');
    const crossing = fields.some(
      (atom) =>
        atom.start < paragraph.end &&
        atom.end > paragraph.start &&
        (atom.start < paragraph.start || atom.end > paragraph.end),
    );
    /** @type {any[]} */
    const inlines = [];
    let cursor = pPr?.end ?? paragraph.openEnd;
    for (const span of direct) {
      if (span.tag === 'w:pPr' || span.start < cursor) continue;
      if (span.start > cursor) inlines.push(addAtom({ start: cursor, end: span.start }, 'opaque'));
      const field = fieldAt.get(span.start);
      if (field && field.end <= paragraph.closeStart) {
        inlines.push(addAtom(field, 'field'));
        cursor = field.end;
        continue;
      }
      const parts = children.get(span.index) ?? [];
      if (span.tag === 'w:r' && parts.every((part) => ['w:rPr', 'w:t'].includes(part.tag))) {
        const run = runByIndex.get(span.index);
        const marks = inside(span)
          .filter((part) => ['w:b', 'w:i', 'w:u', 'w:vertAlign'].includes(part.tag))
          .map((part) => part.attrs['w:val'] ?? part.tag.slice(2));
        inlines.push({
          text: parts
            .filter((part) => part.tag === 'w:t')
            .map((part) => part.text)
            .join(''),
          marks,
          run,
        });
      } else {
        const nested = inside(span).find((part) => atomTypes[part.tag]);
        inlines.push(addAtom(span, atomTypes[span.tag] ?? atomTypes[nested?.tag] ?? 'opaque'));
      }
      cursor = span.end;
    }
    if (cursor < paragraph.closeStart)
      inlines.push(addAtom({ start: cursor, end: paragraph.closeStart }, 'opaque'));
    let kind = 'paragraph';
    if (properties.some((span) => span.tag === 'w:numPr')) kind = 'list-item';
    if (level != null || /^Heading/iu.test(style ?? '')) kind = 'heading';
    if (table) kind = 'table-cell';
    if (crossing) kind = 'opaque';
    return {
      id: paragraph.attrs['w14:paraId'] ? `p:${paragraph.attrs['w14:paraId']}` : `b:${ordinal}`,
      kind,
      level: level == null ? null : Number(level) + 1,
      style,
      inlines,
      text: inlines.map((inline) => inline.text ?? '\uFFFC').join(''),
      start: paragraph.start,
      end: paragraph.end,
      openEnd: paragraph.openEnd,
      closeStart: paragraph.closeStart,
      name: paragraph.name,
      selfClosing: paragraph.selfClosing,
      pPr,
    };
  });
  return { blocks, runs, atoms, raw };
}

/**
 * Read immutable package bytes and a lossless span projection, without a DOM.
 * Runs and atoms retain positions in the original document.xml string.
 * @param {Buffer|Uint8Array} bytes
 * @returns {Promise<any>}
 */
export async function readDocx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml').async('string');
  const spans = indexXml(xml);
  const commentsXml = (await zip.file('word/comments.xml')?.async('string')) ?? null;
  const comments = commentsXml
    ? indexXml(commentsXml)
        .filter((span) => span.tag === 'w:comment')
        .map((span) => ({ ...span, id: span.attrs['w:id'], author: span.attrs['w:author'] }))
    : [];
  return { bytes, zip, xml, spans, ...readBlocks(xml, spans), commentsXml, comments };
}
