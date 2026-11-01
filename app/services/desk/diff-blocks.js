// Keep matching provenance private: the HTTP block shape stays the same as
// the desk reader, while atoms match by immutable XML and embedded media.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readDocx } from './docx/read.js';
import { cellPlace, publicBlock } from './model.js';
import { readText } from './text.js';
import { indexXml } from './docx/xml.js';

const normalize = (text) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
export const MARKS = ['b', 'i', 'u', 'sup', 'sub'];
const COMMENT_ATOMS = new Set(['comment-start', 'comment-end', 'comment-reference']);

/**
 * @param {any} block
 * @param {any} [document]
 * @returns {any}
 */
export function describeBlock(block, document) {
  const atoms = [];
  const runs = [];
  let key = '';
  let matchingText = '';
  let offset = 0;
  for (const inline of block.inlines ?? []) {
    // These markers have empty display text. Keep them in the public block,
    // but annotations are not paragraph content or changes in this comparison.
    if (COMMENT_ATOMS.has(inline.atom)) continue;
    const value = inline.text ?? inline.display ?? '\uFFFC';
    // Empty atoms have no body range to highlight. Their original XML/inlines
    // remain available, but their identities must not split unchanged text.
    if (inline.atom && !value.length) continue;
    if (inline.atom) {
      const atom = document?.atoms[inline.ref];
      const xml = atom ? document.xml.slice(atom.start, atom.end) : String(inline.ref);
      const digest = createHash('sha256').update(xml);
      const mediaHash = document?.mediaHashes?.get(inline.ref);
      if (mediaHash) digest.update('\0').update(mediaHash);
      const identity = inline.atom + ':' + digest.digest('hex');
      key += `<${identity}>`;
      // Exact anchors retain full identity; Dice measures short semantic slots,
      // so a hash's length or random characters cannot dominate text similarity.
      matchingText += `<${inline.atom}>`;
      atoms.push({ from: offset, to: offset + value.length, key: identity });
    } else {
      key += value;
      matchingText += value;
    }
    const mask = MARKS.reduce(
      (bits, mark, index) => bits | (inline.marks?.includes(mark) ? 1 << index : 0),
      0,
    );
    const previous = runs.at(-1);
    if (previous?.mask === mask) previous.to += value.length;
    else if (value.length) runs.push({ from: offset, to: offset + value.length, mask });
    offset += value.length;
  }
  if (!block.inlines) {
    key = block.text;
    matchingText = block.text;
    runs.push({ from: 0, to: block.text.length, mask: 0 });
  }
  return { block, key: normalize(key), matchingText: normalize(matchingText), atoms, runs };
}

/**
 * Comparison uses every embedded part of a drawing, including grouped pictures
 * and SVG originals behind PNG previews. The reader's first-picture API stays unchanged.
 * @param {any} document
 * @returns {Promise<Map<number,string[]>>}
 */
async function embeddedImageFiles(document) {
  const xml = await document.zip.file('word/_rels/document.xml.rels')?.async('string');
  const relationships = new Map(
    (xml ? indexXml(xml) : [])
      .filter((span) => span.tag.split(':').at(-1) === 'Relationship')
      .map((span) => [span.attrs.Id, span.attrs]),
  );
  const result = new Map();
  for (const [ref, atom] of document.atoms.entries()) {
    if (atom.atom !== 'image') continue;
    const files = new Set();
    for (const span of document.inside(atom)) {
      if (!['blip', 'imagedata', 'svgBlip'].includes(span.tag.split(':').at(-1))) continue;
      const id = Object.entries(span.attrs).find(([name]) => /:(?:embed|id)$/u.test(name))?.[1];
      const relation = relationships.get(id);
      if (!relation || relation.TargetMode === 'External' || !relation.Type?.endsWith('/image'))
        continue;
      const file = path.posix.normalize(
        relation.Target.startsWith('/')
          ? relation.Target.slice(1)
          : path.posix.join('word', relation.Target),
      );
      if (document.zip.file(file)) files.add(file);
    }
    if (files.size) result.set(ref, [...files]);
  }
  return result;
}

async function imageHashes(document) {
  const files = new Map();
  const hashes = new Map();
  if (!document.atoms.some((atom) => atom.atom === 'image')) return hashes;
  // Replacing an embedded image can keep the same drawing XML and relationship
  // id. Its referenced bytes are part of identity; shared media is read once.
  for (const [ref, entries] of await embeddedImageFiles(document)) {
    const identities = [];
    for (const file of entries) {
      if (!files.has(file)) {
        const bytes = await document.zip.file(file).async('nodebuffer');
        files.set(file, createHash('sha256').update(bytes).digest('hex'));
      }
      identities.push(files.get(file));
    }
    hashes.set(ref, createHash('sha256').update(JSON.stringify(identities)).digest('hex'));
  }
  return hashes;
}

/**
 * Same PDF parser as versions.read, without fetching unrelated version notes.
 * @param {{file:string,name:string}} version
 * @returns {Promise<{format:string,items:any[]}|null>}
 */
export async function readDiffBlocks(version) {
  const extension = path.extname(version.name).slice(1).toLowerCase();
  const format = extension === 'markdown' ? 'md' : extension;
  if (!['docx', 'tex', 'md', 'pdf'].includes(format)) return null;
  const bytes = await readFile(version.file);
  if (format === 'docx') {
    const document = await readDocx(bytes);
    document.mediaHashes = await imageHashes(document);
    return {
      format,
      items: document.blocks.map((block) => {
        // Cells keep their place so the comparison pages can draw tables.
        const value = publicBlock(block);
        const cell = cellPlace(document.spans, block);
        if (cell) value.cell = cell;
        return describeBlock(value, document);
      }),
    };
  }
  if (format === 'pdf') {
    const { parseDocument } = await import('../research/parsers/index.js');
    const parsed = await parseDocument(bytes, { name: version.name });
    return {
      format,
      items: parsed.blocks.map((block, index) =>
        describeBlock({ id: `b:${index}`, kind: 'paragraph', text: block.text }),
      ),
    };
  }
  return {
    format,
    items: readText(bytes, format).blocks.map(({ id, kind, level, text }) =>
      describeBlock({ id, kind, level, text }),
    ),
  };
}
