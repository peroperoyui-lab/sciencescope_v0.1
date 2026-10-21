import JSZip from 'jszip';
import { indexXml } from './xml.js';
import { createInlineReader } from './inlines.js';
import { readComments } from './comments-read.js';

function ancestors(span, spans) {
  const result = [];
  for (let parent = spans[span.parent]; parent; parent = spans[parent.parent]) result.push(parent);
  return result;
}

function readBlocks(xml, spans) {
  const reader = createInlineReader(xml, spans);
  const { children, inside, fields, readContainer } = reader;
  const paragraphs = spans.filter(
    (span) =>
      span.tag === 'w:p' &&
      !ancestors(span, spans).some((parent) => ['w:p', 'w:txbxContent'].includes(parent.tag)),
  );
  // Sweep intervals rather than scanning every field for each paragraph.
  const orderedFields = [...fields].sort((left, right) => left.start - right.start);
  let fieldIndex = 0;
  let active = [];
  const blocks = paragraphs.map((paragraph, ordinal) => {
    const pPr = (children.get(paragraph.index) ?? []).find((span) => span.tag === 'w:pPr') ?? null;
    const properties = pPr ? inside(pPr) : [];
    const style = properties.find((span) => span.tag === 'w:pStyle')?.attrs['w:val'] ?? null;
    const level = properties.find((span) => span.tag === 'w:outlineLvl')?.attrs['w:val'];
    const table = ancestors(paragraph, spans).some((span) => span.tag === 'w:tc');
    while (fieldIndex < orderedFields.length && orderedFields[fieldIndex].start < paragraph.end)
      active.push(orderedFields[fieldIndex++]);
    active = active.filter((field) => field.end > paragraph.start);
    const crossing = active.some(
      (field) => field.start < paragraph.start || field.end > paragraph.end,
    );
    const inlines = readContainer(paragraph);
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
      text: inlines.map((inline) => inline.text ?? inline.display ?? '\uFFFC').join(''),
      start: paragraph.start,
      end: paragraph.end,
      openEnd: paragraph.openEnd,
      closeStart: paragraph.closeStart,
      name: paragraph.name,
      selfClosing: paragraph.selfClosing,
      pPr,
      parent: paragraph.parent,
    };
  });
  return { ...reader, blocks };
}

/**
 * Read immutable package bytes and a lossless span projection, without a DOM.
 * Runs, containers and atoms retain positions in the original document.xml string.
 * @param {Buffer|Uint8Array} bytes
 * @returns {Promise<any>}
 */
export async function readDocx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml').async('string');
  const spans = indexXml(xml);
  const commentsXml = (await zip.file('word/comments.xml')?.async('string')) ?? null;
  const document = { bytes, zip, xml, spans, ...readBlocks(xml, spans), commentsXml };
  return { ...document, comments: await readComments(document) };
}
