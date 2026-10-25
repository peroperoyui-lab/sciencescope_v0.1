import JSZip from 'jszip';
import { indexXml } from './xml.js';
import { createInlineReader } from './inlines.js';
import { readComments } from './comments-read.js';

function ancestors(span, spans) {
  const result = [];
  for (let parent = spans[span.parent]; parent; parent = spans[parent.parent]) result.push(parent);
  return result;
}

/**
 * Outline level (0 = top) of each paragraph style, from its own outline level,
 * its built-in name (Chinese Word names Heading 1 "heading 1" but gives it the
 * id "1") or the style it is based on.
 * @param {string | null} xml word/styles.xml
 * @returns {Map<string, number>}
 */
export function styleLevels(xml) {
  const levels = new Map();
  if (!xml) return levels;
  let spans;
  try {
    spans = indexXml(xml);
  } catch {
    // A styles part we cannot read only costs the outline.
    return levels;
  }
  const styles = new Map();
  for (const span of spans) {
    if (span.tag === 'w:style' && span.attrs['w:type'] === 'paragraph' && span.attrs['w:styleId'])
      styles.set(span.index, { id: span.attrs['w:styleId'], name: '', basedOn: null, level: null });
    const owner = styles.get(span.parent) ?? styles.get(spans[span.parent]?.parent);
    if (!owner) continue;
    if (span.tag === 'w:name') owner.name = span.attrs['w:val'] ?? '';
    else if (span.tag === 'w:basedOn') owner.basedOn = span.attrs['w:val'] ?? null;
    else if (span.tag === 'w:outlineLvl') owner.level = Number(span.attrs['w:val']);
  }
  const byId = new Map([...styles.values()].map((style) => [style.id, style]));
  const levelOf = (id, seen = new Set()) => {
    const style = byId.get(id);
    if (!style || seen.has(id)) return null;
    seen.add(id);
    if (style.level != null) return style.level < 9 ? style.level : null;
    const named = /^heading\s*(\d)$/iu.exec(style.name.trim());
    if (named) return Number(named[1]) - 1;
    return style.basedOn ? levelOf(style.basedOn, seen) : null;
  };
  for (const id of byId.keys()) {
    const level = levelOf(id);
    if (level != null) levels.set(id, level);
  }
  return levels;
}

function readBlocks(xml, spans, levels = new Map()) {
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
    const own = properties.find((span) => span.tag === 'w:outlineLvl')?.attrs['w:val'];
    const outline = own != null ? Number(own) : (levels.get(style) ?? null);
    const level = outline != null && outline < 9 ? outline : null;
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
      level: level == null ? null : level + 1,
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
  const levels = styleLevels((await zip.file('word/styles.xml')?.async('string')) ?? null);
  const document = { bytes, zip, xml, spans, ...readBlocks(xml, spans, levels), commentsXml };
  return { ...document, comments: await readComments(document) };
}
