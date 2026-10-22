import { readDocx } from './docx/read.js';
import { writeDocx } from './docx/write.js';
import { paragraphIds } from './docx/ids.js';
import { aggregate, replay, publicBlock } from './model.js';
import { readText, replayText, joinText } from './text.js';
import { indexMedia } from './media.js';

/**
 * @param {Uint8Array} bytes
 * @param {string} format
 * @returns {Promise<any>}
 */
export async function readDocument(bytes, format) {
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
  if (state.document.format !== 'docx') return Buffer.from(joinText(state.blocks));
  const delta = aggregate(state.document, state.blocks);
  return (await writeDocx(state.document.bytes, delta.changes, delta)).bytes;
}

/**
 * @param {any} state
 * @returns {any}
 */
export function documentResponse(state) {
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
