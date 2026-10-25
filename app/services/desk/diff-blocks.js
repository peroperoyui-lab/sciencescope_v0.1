// Keep matching provenance private: the HTTP block shape stays the same as
// the desk reader, while atoms match by their immutable XML, never display text.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readDocx } from './docx/read.js';
import { cellPlace, publicBlock } from './model.js';
import { readText } from './text.js';

const normalize = (text) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
export const MARKS = ['b', 'i', 'u', 'sup', 'sub'];

/**
 * @param {any} block
 * @param {any} [document]
 * @returns {any}
 */
export function describeBlock(block, document) {
  const atoms = [];
  const runs = [];
  let key = '';
  let offset = 0;
  for (const inline of block.inlines ?? []) {
    const value = inline.text ?? inline.display ?? '\uFFFC';
    if (inline.atom) {
      const atom = document?.atoms[inline.ref];
      const xml = atom ? document.xml.slice(atom.start, atom.end) : String(inline.ref);
      const identity = inline.atom + ':' + createHash('sha256').update(xml).digest('hex');
      key += `<${identity}>`;
      atoms.push({ from: offset, to: offset + value.length, key: identity });
    } else key += value;
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
    runs.push({ from: 0, to: block.text.length, mask: 0 });
  }
  return { block, key: normalize(key), atoms, runs };
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
