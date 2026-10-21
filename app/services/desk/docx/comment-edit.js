import { AppError } from '../../../core/errors.js';
import { appendComments } from './comments.js';
import { WORD14 } from './ids.js';
import { appendXml, escapeXml, indexXml, patchXml } from './xml.js';

function editedComment(xml, comment, text) {
  const spans = indexXml(xml);
  const parts = spans.slice(comment.index + 1, comment.after);
  const paragraph = parts.find((span) => span.tag === 'w:p');
  const properties = parts.find((span) => span.tag === 'w:pPr' && span.parent === paragraph?.index);
  const run = parts.find((span) => span.tag === 'w:r');
  const runProperties = parts.find((span) => span.tag === 'w:rPr' && span.parent === run?.index);
  const prefix = comment.name.includes(':') ? comment.name.split(':')[0] + ':' : '';
  let opening = paragraph
    ? xml.slice(paragraph.start, paragraph.openEnd).replace(/\/>$/u, '>')
    : `<${prefix}p>`;
  // Thread metadata points at the last paragraph. Collapsing a comment must
  // retain that identity while inheriting the FIRST paragraph's formatting.
  if (comment.paraId) {
    if (/\bparaId\s*=/u.test(opening))
      opening = opening.replace(/((?:\w+:)?paraId\s*=\s*["'])[^"']+/u, '$1' + comment.paraId);
    else opening = opening.slice(0, -1) + ` xmlns:w14="${WORD14}" w14:paraId="${comment.paraId}">`;
  }
  const body =
    opening +
    (properties ? xml.slice(properties.start, properties.end) : '') +
    `<${prefix}r>` +
    (runProperties ? xml.slice(runProperties.start, runProperties.end) : '') +
    `<${prefix}t xml:space="preserve">${escapeXml(text)}</${prefix}t></${prefix}r></${paragraph?.name ?? prefix + 'p'}>`;
  return (
    xml.slice(comment.start, comment.openEnd).replace(/\/>$/u, '>') + body + `</${comment.name}>`
  );
}

/**
 * Edit/delete legacy comments and their optional thread metadata together.
 * All mutations remain in the in-memory package until the writer succeeds.
 * @param {any} document
 * @param {any[]} operations
 * @returns {Promise<{added:any[], deleted:Set<string>}>}
 */
export async function applyComments(document, operations) {
  const byId = new Map(document.comments.map((comment) => [comment.id, comment]));
  const deleted = new Set();
  const edits = new Map();
  for (const operation of operations) {
    if (!operation.op || operation.op === 'add') continue;
    const id = String(operation.id);
    if (!byId.has(id)) throw new AppError('DOCX_COMMENT_NOT_FOUND', `Comment ${id} does not exist`);
    if (operation.op === 'delete') deleted.add(id);
    else if (operation.op === 'edit') edits.set(id, operation.text);
  }
  // Replies can themselves have replies, so traverse the actual thread graph.
  const replies = new Map();
  for (const comment of document.comments) {
    if (!replies.has(comment.parentId)) replies.set(comment.parentId, []);
    replies.get(comment.parentId).push(comment.id);
  }
  for (const id of deleted) for (const child of replies.get(id) ?? []) deleted.add(child);
  const removedParagraphs = new Set(
    document.comments
      .filter((comment) => deleted.has(comment.id))
      .flatMap((comment) => comment.paraIds),
  );
  if (deleted.size || edits.size) {
    document.commentsXml = patchXml(
      document.commentsXml,
      document.comments.flatMap((comment) => {
        if (deleted.has(comment.id)) return [{ ...comment, text: '' }];
        if (edits.has(comment.id))
          return [
            {
              ...comment,
              text: editedComment(document.commentsXml, comment, edits.get(comment.id)),
            },
          ];
        return [];
      }),
    );
    document.zip.file('word/comments.xml', document.commentsXml);
  }
  const added = await appendComments(
    document,
    operations.filter((operation) => !operation.op || operation.op === 'add'),
  );
  const durableIds = new Set();
  const addedDurable = new Map(added.map((comment) => [comment.paraId, document.allocateId()]));
  for (const [name, tag, paraAttribute, durableAttribute] of [
    ['commentsIds.xml', 'w16cid:commentId', 'w16cid:paraId', 'w16cid:durableId'],
    ['commentsExtended.xml', 'w15:commentEx', 'w15:paraId', null],
    ['commentsExtensible.xml', 'w16cex:commentExtensible', null, 'w16cex:durableId'],
  ]) {
    const entry = document.zip.file('word/' + name);
    if (!entry) continue;
    const xml = await entry.async('string');
    const spans = indexXml(xml);
    const removed = spans.filter(
      (span) =>
        span.tag === tag &&
        (removedParagraphs.has(span.attrs[paraAttribute]) ||
          durableIds.has(span.attrs[durableAttribute])),
    );
    for (const span of removed) if (durableAttribute) durableIds.add(span.attrs[durableAttribute]);
    let output = patchXml(
      xml,
      removed.map((span) => ({ ...span, text: '' })),
    );
    if (added.length) {
      const prefix = spans[0].name.includes(':') ? spans[0].name.split(':')[0] + ':' : '';
      const additions = added
        .map((comment) => {
          const attributes = [];
          if (paraAttribute) attributes.push(`${prefix}paraId="${comment.paraId}"`);
          if (durableAttribute)
            attributes.push(`${prefix}durableId="${addedDurable.get(comment.paraId)}"`);
          if (name === 'commentsExtended.xml') attributes.push(`${prefix}done="0"`);
          return `<${prefix}${tag.split(':')[1]} ${attributes.join(' ')}/>`;
        })
        .join('');
      output = appendXml(output, additions);
    }
    if (output !== xml) document.zip.file('word/' + name, output);
  }
  return { added, deleted };
}
