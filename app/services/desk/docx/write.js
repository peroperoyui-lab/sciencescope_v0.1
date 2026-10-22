import { readDocx } from './read.js';
import { applyComments } from './comment-edit.js';
import { planBlocks, renderBlocks } from './blocks.js';
import { paragraphIds } from './ids.js';
import { indexXml, patchXml } from './xml.js';
import { AppError } from '../../../core/errors.js';

/**
 * Changes map block ids to new inlines. Comment ranges use inline boundaries in
 * the changed block: {blockId,from,to,text,author,initials?,date?}. Insertions use
 * {after,id,inlines,like?,paraId?}; the result maps client ids to persisted p:<paraId> ids.
 * Original package parts
 * and inter-paragraph slices are copied unchanged, not XML-serialized.
 * @param {Buffer|Uint8Array} bytes
 * @param {Record<string,any[]>} changes
 * @param {{comments?:any[], inserted?:any[], removed?:string[], atoms?:Record<string,any>}} [options]
 * @returns {Promise<{bytes:Buffer, inserted:Record<string,string>}>}
 */
export async function writeDocx(bytes, changes, options = {}) {
  const document = await readDocx(bytes);
  Object.assign(document.atoms, options.atoms ?? {});
  if (
    !Object.keys(changes).length &&
    !options.comments?.length &&
    !options.inserted?.length &&
    !options.removed?.length
  )
    return { bytes: Buffer.from(bytes), inserted: {} };
  const generateId = await paragraphIds(document.zip);
  const reserved = new Set();
  for (const entry of Object.values(document.zip.files)) {
    if (entry.dir || !entry.name.endsWith('.xml')) continue;
    for (const span of indexXml(await entry.async('string'))) {
      const id = span.attrs['w14:paraId'];
      if (id) reserved.add(id.toUpperCase());
    }
  }
  for (const item of options.inserted ?? []) {
    if (item.paraId == null) continue;
    const id = String(item.paraId).toUpperCase();
    if (!/^[0-7][0-9A-F]{7}$/u.test(id) || reserved.has(id))
      throw new AppError('DOCX_DUPLICATE_BLOCK', '新段落的标识无效或已被使用。');
    reserved.add(id);
  }
  const allocateId = () => {
    let id;
    do {
      id = generateId();
    } while (reserved.has(id));
    reserved.add(id);
    return id;
  };
  const source = { ...document, allocateId };
  const plan = planBlocks(source, changes, options);
  const comments = await applyComments(source, options.comments ?? []);
  const rendered = renderBlocks(
    source,
    plan,
    changes,
    comments.added.filter((item) => !item.inlineAnchors),
  );
  let xml = patchXml(document.xml, rendered.edits);
  if (comments.deleted.size)
    xml = patchXml(
      xml,
      indexXml(xml)
        .filter(
          (span) =>
            ['w:commentRangeStart', 'w:commentRangeEnd', 'w:commentReference'].includes(span.tag) &&
            comments.deleted.has(span.attrs['w:id']),
        )
        .map((span) => ({ ...span, text: '' })),
    );
  if (xml !== document.xml) document.zip.file('word/document.xml', xml);
  return {
    bytes: await document.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    inserted: rendered.inserted,
  };
}
