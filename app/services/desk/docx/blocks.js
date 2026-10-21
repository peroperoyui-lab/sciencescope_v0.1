import { AppError } from '../../../core/errors.js';
import { WORD14 } from './ids.js';
import { renderBlock } from './render.js';

const markerTags = new Set([
  'w:commentRangeStart',
  'w:commentRangeEnd',
  'w:commentReference',
  'w:bookmarkStart',
  'w:bookmarkEnd',
]);

function markers(document, block) {
  return document.spans
    .filter(
      (span) => span.start >= block.start && span.end <= block.end && markerTags.has(span.tag),
    )
    .map((span) => {
      if (span.tag !== 'w:commentReference') return document.raw(span);
      const run = document.spans[span.parent];
      const properties = document.children.get(run.index)?.find((part) => part.tag === 'w:rPr');
      return (
        document.xml.slice(run.start, run.openEnd) +
        (properties ? document.raw(properties) : '') +
        document.raw(span) +
        `</${run.name}>`
      );
    })
    .join('');
}

/**
 * Plan structural edits before changing any package parts. New paragraphs stay
 * beside their anchor, including inside a cell or a block content control.
 * @param {any} document
 * @param {Record<string,any[]>} changes
 * @param {any} options
 * @returns {any}
 */
export function planBlocks(document, changes, options) {
  const byId = new Map(document.blocks.map((block) => [block.id, block]));
  const removed = new Set(options.removed ?? []);
  const requireBlock = (id) => {
    const block = byId.get(id);
    if (!block) throw new AppError('DOCX_BLOCK_NOT_FOUND', `Block ${id} does not exist`);
    return block;
  };
  for (const id of [...Object.keys(changes), ...removed]) requireBlock(id);
  for (const id of removed) {
    const block = requireBlock(id);
    if (block.pPr && document.inside(block.pPr).some((span) => span.tag === 'w:sectPr'))
      throw new AppError('DOCX_SECTION_BREAK', 'A section-break paragraph cannot be removed');
    if (block.kind === 'opaque')
      throw new AppError(
        'DOCX_OPAQUE_BLOCK',
        'A cross-paragraph field cannot be removed separately',
      );
  }
  const body = document.spans.find((span) => span.tag === 'w:body');
  const inserted = [];
  const newById = new Map();
  for (const input of options.inserted ?? []) {
    if (byId.has(input.id) || newById.has(input.id))
      throw new AppError('DOCX_DUPLICATE_BLOCK', `Block ${input.id} already exists`);
    const preceding = newById.get(input.after);
    const anchor = input.after === '^' ? null : (preceding?.template ?? requireBlock(input.after));
    const template = input.like
      ? requireBlock(input.like)
      : (anchor ??
        document.blocks.find((block) => block.parent === body.index) ??
        document.blocks[0]);
    const record = {
      ...input,
      template,
      parent: input.after === '^' ? body.index : (preceding?.parent ?? anchor.parent),
      position: input.after === '^' ? body.openEnd : (preceding?.position ?? anchor.end),
      paraId: document.allocateId(),
    };
    if (preceding) inserted.splice(inserted.indexOf(preceding) + 1, 0, record);
    else inserted.push(record);
    newById.set(input.id, record);
  }
  for (const cell of document.spans.filter((span) => span.tag === 'w:tc')) {
    const original = document.blocks.filter((block) => block.parent === cell.index);
    if (
      original.length &&
      original.every((block) => removed.has(block.id)) &&
      !inserted.some((block) => block.parent === cell.index)
    )
      throw new AppError(
        'DOCX_LAST_CELL_PARAGRAPH',
        'The last paragraph in a table cell cannot be removed',
      );
  }
  const retained = document.blocks.filter((block) => !removed.has(block.id));
  const moved = new Map();
  for (const id of removed) {
    const block = byId.get(id);
    const content = markers(document, block);
    if (!content) continue;
    const next = retained.find((item) => item.start > block.start);
    const target = next ?? retained.findLast((item) => item.start < block.start);
    if (!target)
      throw new AppError(
        'DOCX_MARKER_TARGET',
        'A retained paragraph is needed for bookmarks and comments',
      );
    const entry = moved.get(target.id) ?? { before: '', after: '' };
    entry[next ? 'before' : 'after'] += content;
    moved.set(target.id, entry);
  }
  return { removed, inserted, moved, byId, newById };
}

/**
 * @param {any} document
 * @param {any} plan
 * @param {Record<string,any[]>} changes
 * @param {any[]} comments
 * @returns {{edits:any[], inserted:Record<string,string>}}
 */
export function renderBlocks(document, plan, changes, comments) {
  const edits = [];
  const ids = new Set([
    ...Object.keys(changes),
    ...plan.removed,
    ...plan.moved.keys(),
    ...comments.filter((item) => !plan.newById.has(item.blockId)).map((item) => item.blockId),
  ]);
  for (const id of ids) {
    const block = plan.byId.get(id);
    if (!block) throw new AppError('DOCX_BLOCK_NOT_FOUND', `Block ${id} does not exist`);
    if (plan.removed.has(id)) {
      edits.push({ ...block, text: '' });
      continue;
    }
    let text = renderBlock(
      document,
      block,
      changes[id] ?? block.inlines,
      comments.filter((item) => item.blockId === id),
    );
    const moved = plan.moved.get(id);
    if (moved) {
      if (block.selfClosing && text === document.raw(block))
        text = text.replace(/\/>$/u, '>') + `</${block.name}>`;
      const at = block.pPr ? block.pPr.end - block.start : text.indexOf('>') + 1;
      const end = text.length - block.name.length - 3;
      text = text.slice(0, at) + moved.before + text.slice(at, end) + moved.after + text.slice(end);
    }
    edits.push({ ...block, text });
  }
  /**
   * @type {Record<string,string>}
   */
  const inserted = {};
  const atPosition = new Map();
  const hasWord14 = Object.values(document.spans[0].attrs).includes(WORD14);
  for (const record of plan.inserted) {
    const base = record.template ?? {
      name: 'w:p',
      start: 0,
      end: 6,
      openEnd: 6,
      selfClosing: true,
      inlines: [],
    };
    const source = record.template ? document : { ...document, xml: '<w:p/>', raw: () => '<w:p/>' };
    let text = renderBlock(
      source,
      { ...base, kind: 'paragraph' },
      record.inlines,
      comments.filter((item) => item.blockId === record.id),
    );
    if (base.selfClosing && text === source.raw(base))
      text = text.replace(/\/>$/u, '>') + `</${base.name}>`;
    const end = text.indexOf('>') + 1;
    let opening = text
      .slice(0, end)
      .replace(/\s+[\w]+:(?:paraId|textId)\s*=\s*(?:"[^"]*"|'[^']*')/gu, '');
    if (!/xmlns:w14=/u.test(opening)) opening = opening.slice(0, -1) + ` xmlns:w14="${WORD14}">`;
    const identityAttributes =
      ` w14:paraId="${record.paraId}"` +
      (hasWord14 ? ` w14:textId="${document.allocateId()}"` : '');
    text = opening.slice(0, -1) + identityAttributes + '>' + text.slice(end);
    inserted[record.id] = 'p:' + record.paraId;
    atPosition.set(record.position, (atPosition.get(record.position) ?? '') + text);
  }
  for (const [position, text] of atPosition) edits.push({ start: position, end: position, text });
  return { edits, inserted };
}
