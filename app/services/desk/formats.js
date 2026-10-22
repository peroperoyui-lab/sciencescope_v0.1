import { readDocx } from './docx/read.js';
import { writeDocx } from './docx/write.js';
import { paragraphIds } from './docx/ids.js';
import { aggregate, replay, publicBlock } from './model.js';
import { readText, replayText, joinText } from './text.js';
import { indexMedia } from './media.js';
import { commentWriteOptions } from './annotation-docx.js';

/**
 * @param {Uint8Array} bytes
 * @param {string} format
 * @returns {Promise<any>}
 */
export async function readDocument(bytes, format) {
  if (format === 'pdf') {
    const { parseDocument } = await import('../research/parsers/index.js');
    const parsed = await parseDocument(bytes, { name: 'manuscript.pdf' });
    return {
      bytes,
      format,
      blocks: parsed.blocks.map((block, index) => ({
        id: `b:${index}`,
        kind: 'paragraph',
        level: null,
        text: block.text,
        page: block.page,
      })),
    };
  }
  if (format !== 'docx') return readText(bytes, format);
  const document = await readDocx(bytes);
  return { ...document, format, media: await indexMedia(document) };
}

/**
 * @param {any} document
 * @param {any[]} records
 * @returns {Promise<{blocks:any[],allocateId:()=>string}>}
 */
export async function restoreDocument(document, records) {
  if (document.format === 'pdf') return { blocks: document.blocks, allocateId: () => '' };
  if (document.format !== 'docx') {
    const ids = [
      ...document.blocks.map((block) => block.id),
      ...records.map((record) => record.blockId),
    ];
    let next = ids.reduce((maximum, id) => Math.max(maximum, Number(id.slice(2)) + 1), 0);
    return {
      blocks: replayText(document.blocks, records, document.format),
      allocateId: () => `t:${next++}`,
    };
  }
  const allocate = await paragraphIds(document.zip);
  const used = new Set(
    records.filter((record) => record.op === 'insert-block').map((record) => record.blockId),
  );
  for (const record of records)
    for (const delta of record.annotations ?? [])
      for (const item of [delta.before, delta.after])
        if (item?.paraId) used.add('p:' + item.paraId);
  return {
    blocks: replay(document.blocks, records),
    allocateId: () => {
      let id;
      do {
        id = allocate();
      } while (used.has('p:' + id));
      used.add('p:' + id);
      return id;
    },
  };
}

/**
 * @param {any} state
 * @returns {Promise<Uint8Array>}
 */
export async function writeDocument(state) {
  if (state.document.format === 'pdf') return state.document.bytes;
  if (state.document.format !== 'docx') return Buffer.from(joinText(state.blocks));
  const delta = aggregate(state.document, state.blocks);
  return (
    await writeDocx(state.document.bytes, delta.changes, {
      ...delta,
      ...(state.comments ? commentWriteOptions(state) : {}),
    })
  ).bytes;
}

/**
 * @param {any} state
 * @returns {any}
 */
export function documentResponse(state) {
  if (state.document.format === 'pdf') return { blocks: state.blocks, readOnly: true };
  if (state.document.format !== 'docx')
    return {
      text: joinText(state.blocks),
      blocks: state.blocks.map(({ id, kind, level, text }) => ({ id, kind, level, text })),
    };
  return {
    blocks: state.blocks.map((block) => {
      const value = publicBlock(block);
      value.inlines = value.inlines.map((inline) =>
        inline.atom === 'image' && state.document.media.has(inline.ref)
          ? { ...inline, media: true }
          : inline,
      );
      return value;
    }),
  };
}
