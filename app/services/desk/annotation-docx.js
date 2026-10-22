import { annotationText, quoteAt, splitInlines } from './annotation-anchors.js';
import { WORD } from './docx/xml.js';

/**
 * Stable synthetic references let new comment delimiters join the same run
 * journal before the next ZIP flush. Existing atoms keep their original refs.
 * @param {any} document
 * @param {string} id
 * @returns {any[]}
 */
export function commentAtoms(document, id) {
  const number = id.split(':').at(-1);
  return ['start', 'end', 'reference'].map((kind) => {
    const ref = `desk-comment:${number}:${kind}`;
    const tag =
      kind === 'reference'
        ? 'commentReference'
        : kind === 'start'
          ? 'commentRangeStart'
          : 'commentRangeEnd';
    const marker = `<w:${tag} xmlns:w="${WORD}" w:id="${number}"/>`;
    document.atoms[ref] = {
      atom: 'comment-' + kind,
      commentId: number,
      raw: kind === 'reference' ? `<w:r xmlns:w="${WORD}">${marker}</w:r>` : marker,
    };
    return { atom: 'comment-' + kind, ref, display: '' };
  });
}

/**
 * @param {any} document
 * @param {any} inline
 * @returns {string|null}
 */
export function commentIdentity(document, inline) {
  if (!inline.atom?.startsWith('comment-')) return null;
  const atom = document.atoms[inline.ref];
  const id = atom?.commentId ?? atom?.attrs?.['w:id'];
  return id == null ? null : `docx:${document.groupId}:${id}`;
}

/**
 * @param {any} document
 * @param {any} block
 * @param {any} item
 * @returns {any[]}
 */
export function addCommentMarkers(document, block, item) {
  const [start, end, reference] = commentAtoms(document, item.id);
  const inlines = splitInlines(block.inlines, [item.from, item.to]);
  const output = [];
  let offset = 0,
    opened = false,
    closed = false;
  for (const part of inlines) {
    if (!opened && offset === item.from) {
      output.push(start);
      opened = true;
    }
    if (!closed && offset === item.to) {
      output.push(end, reference);
      closed = true;
    }
    output.push(part);
    offset += (part.text ?? part.display ?? '\uFFFC').length;
  }
  if (!closed) output.push(end, reference);
  return output;
}

/**
 * @param {any} document
 * @param {any[]} blocks
 * @returns {Map<string,any>}
 */
export function commentRanges(document, blocks) {
  const ranges = new Map();
  for (const block of blocks) {
    let offset = 0;
    for (const inline of block.inlines ?? []) {
      const id = commentIdentity(document, inline);
      if (inline.atom === 'comment-start') ranges.set(id, { blockId: block.id, from: offset });
      if (inline.atom === 'comment-end' && ranges.has(id))
        Object.assign(ranges.get(id), { to: offset, endBlockId: block.id });
      offset += (inline.text ?? inline.display ?? '\uFFFC').length;
    }
  }
  for (const [id, range] of ranges) {
    if (range.to == null) {
      ranges.delete(id);
      continue;
    }
    const start = blocks.findIndex((block) => block.id === range.blockId);
    const end = blocks.findIndex((block) => block.id === range.endBlockId);
    range.exact = blocks
      .slice(start, end + 1)
      .map((block, index) => {
        const text = annotationText(block);
        return text.slice(
          index === 0 ? range.from : 0,
          block.id === range.endBlockId ? range.to : undefined,
        );
      })
      .join('\n');
  }
  return ranges;
}

/**
 * @param {any} state
 * @param {Map<string,any>} authors
 * @returns {Map<string,any>}
 */
export function originalComments(state, authors) {
  const ranges = commentRanges(state.document, state.document.blocks);
  return new Map(
    state.document.comments.map((comment) => {
      const id = `docx:${state.session.groupId}:${comment.id}`;
      const range = ranges.get(id);
      // Word may renumber w:id and round dates to minutes on save. The comment
      // paragraph identity is retained; older journals fall back to a unique
      // author/text/minute match, never attribute an ambiguous imported comment.
      const minute = (value) => Math.floor(Date.parse(value) / 60000);
      const matches = [...authors.values()].filter(
        (item) =>
          item.authorName === comment.author &&
          ((item.paraId && item.paraId === comment.paraId) ||
            (item.text === comment.text && minute(item.createdAt) === minute(comment.date))),
      );
      const direct = matches.find((item) => item.id === id);
      const previous =
        direct ?? (new Set(matches.map((item) => item.authorId)).size === 1 ? matches[0] : null);
      const block = state.document.blocks.find((entry) => entry.id === range?.blockId);
      return [
        id,
        {
          id,
          type: 'comment',
          groupId: state.session.groupId,
          versionId: state.session.baseVersionId,
          blockId: range?.blockId ?? '',
          from: range?.from ?? 0,
          to: range?.to ?? 0,
          endBlockId: range?.endBlockId,
          quote:
            block && range.endBlockId === block.id
              ? quoteAt(annotationText(block), range.from, range.to)
              : { exact: range?.exact ?? '', prefix: '', suffix: '' },
          text: comment.text,
          authorId: previous?.authorId ?? null,
          paraId: comment.paraId,
          authorName: comment.author,
          createdAt: comment.date,
          updatedAt: comment.date,
        },
      ];
    }),
  );
}

/**
 * @param {any} state
 * @returns {any}
 */
export function commentWriteOptions(state) {
  const original = new Map(
    state.document.comments.map((comment) => [
      `docx:${state.session.groupId}:${comment.id}`,
      comment,
    ]),
  );
  const comments = [];
  for (const [id, comment] of original) {
    const current = state.comments.get(id);
    if (!current) comments.push({ op: 'delete', id: comment.id });
    else if (current.text !== comment.text)
      comments.push({ op: 'edit', id: comment.id, text: current.text });
  }
  for (const [id, item] of state.comments)
    if (!original.has(id))
      comments.push({
        op: 'add',
        id: id.split(':').at(-1),
        text: item.text,
        author: item.authorName,
        date: item.createdAt,
        paraId: item.paraId,
        inlineAnchors: true,
      });
  const atoms = Object.fromEntries(
    Object.entries(state.document.atoms).filter(([, atom]) => atom.raw),
  );
  return { comments, atoms };
}
