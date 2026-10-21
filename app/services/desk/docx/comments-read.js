import { indexXml } from './xml.js';

/**
 * Thread identity is the LAST paragraph's paraId (MS-DOCX CT_CommentEx),
 * independent of the legacy numeric comment id used by document anchors.
 * @param {any} document
 * @returns {Promise<any[]>}
 */
export async function readComments(document) {
  if (!document.commentsXml) return [];
  const spans = indexXml(document.commentsXml);
  const extendedXml = await document.zip.file('word/commentsExtended.xml')?.async('string');
  const extended = new Map(
    (extendedXml ? indexXml(extendedXml) : [])
      .filter((span) => span.tag === 'w15:commentEx')
      .map((span) => [span.attrs['w15:paraId'], span.attrs]),
  );
  const anchors = new Map();
  for (const block of document.blocks) {
    block.inlines.forEach((inline, index) => {
      if (!inline.atom) return;
      const atom = document.atoms[inline.ref];
      if (atom.index == null) return;
      for (const span of document.spans.slice(atom.index, atom.after)) {
        if (!['w:commentRangeStart', 'w:commentRangeEnd', 'w:commentReference'].includes(span.tag))
          continue;
        const id = span.attrs['w:id'];
        const range = anchors.get(id) ?? { from: null, to: null };
        if (span.tag === 'w:commentRangeStart')
          range.from = { blockId: block.id, index: index + 1 };
        if (span.tag === 'w:commentRangeEnd') range.to = { blockId: block.id, index };
        anchors.set(id, range);
      }
    });
  }
  const comments = spans
    .filter((span) => span.tag === 'w:comment')
    .map((span) => {
      const parts = spans.slice(span.index + 1, span.after);
      const paragraphs = parts.filter((part) => part.tag === 'w:p');
      const paraId = paragraphs.at(-1)?.attrs['w14:paraId'] ?? null;
      const extra = extended.get(paraId);
      const text = paragraphs
        .map((paragraph) =>
          spans
            .slice(paragraph.index + 1, paragraph.after)
            .map((part) =>
              part.tag === 'w:t'
                ? part.text
                : part.tag === 'w:tab'
                  ? '\t'
                  : ['w:br', 'w:cr'].includes(part.tag)
                    ? '\n'
                    : '',
            )
            .join(''),
        )
        .join('\n');
      return {
        ...span,
        id: span.attrs['w:id'],
        author: span.attrs['w:author'] ?? '',
        initials: span.attrs['w:initials'] ?? '',
        date: span.attrs['w:date'] ?? null,
        text,
        paraId,
        paraIds: paragraphs.map((part) => part.attrs['w14:paraId']).filter(Boolean),
        parentParaId: extra?.['w15:paraIdParent'] ?? null,
        parentId: null,
        done: ['1', 'true', 'on'].includes(extra?.['w15:done']),
        range: anchors.get(span.attrs['w:id']) ?? null,
      };
    });
  const byParagraph = new Map(comments.map((comment) => [comment.paraId, comment.id]));
  for (const comment of comments) comment.parentId = byParagraph.get(comment.parentParaId) ?? null;
  return comments;
}
