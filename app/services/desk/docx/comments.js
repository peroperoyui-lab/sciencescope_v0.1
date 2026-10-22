import { appendXml, escapeXml, indexXml, WORD } from './xml.js';
import { WORD14 } from './ids.js';

const relationship = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml';

/**
 * Append comments without rewriting existing comments, relationships or content types.
 * The caller inserts matching range markers into the changed paragraph.
 * @param {any} document
 * @param {any[]} additions
 * @returns {Promise<any[]>}
 */
export async function appendComments(document, additions) {
  if (!additions.length) return [];
  const { zip } = document;
  const ids = [
    ...document.comments.map((comment) => Number(comment.id)),
    ...document.spans
      .filter((span) => span.tag.startsWith('w:comment'))
      .map((span) => Number(span.attrs['w:id'])),
  ].filter(Number.isFinite);
  let next = Math.max(-1, ...ids) + 1;
  const assigned = additions.map((comment) => ({
    ...comment,
    id: comment.id == null ? String(next++) : String(comment.id),
    paraId: comment.paraId ?? document.allocateId(),
  }));
  const xml =
    document.commentsXml ??
    `<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="${WORD}"></w:comments>`;
  const content = assigned
    .map(
      (comment) =>
        `<w:comment xmlns:w="${WORD}" xmlns:w14="${WORD14}" w:id="${comment.id}" w:author="${escapeXml(comment.author)}" w:initials="${escapeXml(comment.initials ?? '')}" w:date="${escapeXml(comment.date ?? new Date().toISOString())}"><w:p w14:paraId="${comment.paraId}"><w:r><w:t xml:space="preserve">${escapeXml(comment.text)}</w:t></w:r></w:p></w:comment>`,
    )
    .join('');
  zip.file('word/comments.xml', appendXml(xml, content));
  const types = await zip.file('[Content_Types].xml').async('string');
  const typeSpans = indexXml(types);
  if (!typeSpans.some((span) => span.attrs.PartName === '/word/comments.xml')) {
    const prefix = typeSpans[0].name.includes(':') ? typeSpans[0].name.split(':')[0] + ':' : '';
    zip.file(
      '[Content_Types].xml',
      appendXml(
        types,
        `<${prefix}Override PartName="/word/comments.xml" ContentType="${contentType}"/>`,
      ),
    );
  }
  const relPath = 'word/_rels/document.xml.rels';
  const rels =
    (await zip.file(relPath)?.async('string')) ??
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const relSpans = indexXml(rels);
  if (!relSpans.some((span) => span.attrs.Type === relationship)) {
    const taken = new Set(relSpans.map((span) => span.attrs.Id));
    let number = 1;
    while (taken.has(`rId${number}`)) number++;
    const prefix = relSpans[0].name.includes(':') ? relSpans[0].name.split(':')[0] + ':' : '';
    zip.file(
      relPath,
      appendXml(
        rels,
        `<${prefix}Relationship Id="rId${number}" Type="${relationship}" Target="comments.xml"/>`,
      ),
    );
  }
  return assigned;
}
