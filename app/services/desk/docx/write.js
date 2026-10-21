import { readDocx } from './read.js';
import { appendComments } from './comments.js';
import { renderBlock } from './render.js';

/**
 * Changes map block ids to new inlines. Comment ranges use inline boundaries in
 * the changed block: {blockId,from,to,text,author,date?}. Original package parts
 * and inter-paragraph slices are copied unchanged, not XML-serialized.
 * @param {Buffer|Uint8Array} bytes
 * @param {Record<string,any[]>} changes
 * @param {{comments?:any[]}} [options]
 * @returns {Promise<Buffer>}
 */
export async function writeDocx(bytes, changes, options = {}) {
  const document = await readDocx(bytes);
  const comments = await appendComments(document, options.comments ?? []);
  const ids = new Set([...Object.keys(changes), ...comments.map((comment) => comment.blockId)]);
  const blocks = document.blocks.filter((block) => ids.has(block.id));
  if (blocks.length !== ids.size) throw new Error('A changed block no longer exists');
  if (!ids.size) return Buffer.from(bytes);
  let cursor = 0;
  let xml = '';
  for (const block of blocks) {
    xml += document.xml.slice(cursor, block.start);
    xml += renderBlock(
      document,
      block,
      changes[block.id] ?? block.inlines,
      comments.filter((comment) => comment.blockId === block.id),
    );
    cursor = block.end;
  }
  xml += document.xml.slice(cursor);
  document.zip.file('word/document.xml', xml);
  return document.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
