import { readDocx } from './read.js';
import { appendComments } from './comments.js';
import { escapeXml } from './xml.js';

function renderBlock(document, block, inlines, comments) {
  if (block.kind === 'opaque') throw new Error(`Cannot rewrite opaque block ${block.id}`);
  const raw = (span) => document.xml.slice(span.start, span.end);
  const prefix = block.name.includes(':') ? block.name.split(':')[0] + ':' : '';
  const originals = new Map(
    block.inlines.filter((item) => item.run != null).map((item) => [item.run, item]),
  );
  const textRun = (inline, index) => {
    const original = originals.get(inline.run);
    if (original?.text === inline.text) return raw(document.runs[inline.run]);
    // A new span inherits the run at its edit point; insertion at the start
    // inherits the following run, so explicit East Asian fonts survive.
    const neighbour =
      original ??
      [...inlines.slice(0, index)].reverse().find((item) => originals.has(item.run)) ??
      inlines.slice(index + 1).find((item) => originals.has(item.run)) ??
      block.inlines.find((item) => item.run != null);
    const run = document.runs[inline.run ?? neighbour?.run];
    const properties = run?.rPr ? raw(run.rPr) : '';
    return `<${prefix}r>${properties}<${prefix}t xml:space="preserve">${escapeXml(inline.text)}</${prefix}t></${prefix}r>`;
  };
  const marker = (local, id) => `<${prefix}${local} ${prefix}id="${id}"/>`;
  let body = block.pPr ? document.xml.slice(block.openEnd, block.pPr.end) : '';
  for (let index = 0; index <= inlines.length; index++) {
    for (const comment of comments.filter((entry) => entry.from === index))
      body += marker('commentRangeStart', comment.id);
    for (const comment of comments.filter((entry) => entry.to === index))
      body +=
        marker('commentRangeEnd', comment.id) +
        `<${prefix}r>${marker('commentReference', comment.id)}</${prefix}r>`;
    if (index === inlines.length) break;
    const inline = inlines[index];
    body += inline.atom ? raw(document.atoms[inline.ref]) : textRun(inline, index);
  }
  const opening = document.xml.slice(block.start, block.openEnd);
  return (block.selfClosing ? opening.replace(/\/>$/u, '>') : opening) + body + `</${block.name}>`;
}

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
