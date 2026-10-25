// Keep the original package's run/atom references for the entire session.
// Rendering a proposed aggregate validates it without recompressing a ZIP on
// every keystroke; only the idle flush calls the package writer.
import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../../core/errors.js';
import { planBlocks, renderBlocks } from './docx/blocks.js';

export const equal = isDeepStrictEqual;

/**
 * @param {any} block
 * @returns {any}
 */
export function publicBlock(block) {
  const { id, kind, style, level, inlines } = block;
  return {
    id,
    kind,
    style,
    level,
    inlines: structuredClone(inlines),
    text: inlines.map((inline) => inline.text ?? inline.display ?? '\uFFFC').join(''),
  };
}

/**
 * Which table, row and cell a table-cell paragraph sits in, by span index, so
 * readers can draw the table around the paragraphs.
 * @param {any[]} spans
 * @param {any} block
 * @returns {{table:number,row:number,cell:number}|null}
 */
export function cellPlace(spans, block) {
  if (block.kind !== 'table-cell') return null;
  const nearest = (index, tag) => {
    for (let span = spans[index]; span; span = spans[span.parent])
      if (span.tag === tag) return span;
    return null;
  };
  const cell = nearest(block.parent, 'w:tc');
  const row = cell && nearest(cell.parent, 'w:tr');
  const table = row && nearest(row.parent, 'w:tbl');
  return table ? { table: table.index, row: row.index, cell: cell.index } : null;
}

/**
 * @param {string} code
 * @param {string} message
 * @param {any} [details]
 */
export function conflict(code, message, details = {}) {
  return Object.assign(new AppError(code, message, 409), { details });
}

/**
 * @param {any} document
 * @param {any[]} blocks
 * @returns {any}
 */
export function aggregate(document, blocks) {
  const original = new Map(document.blocks.map((block) => [block.id, block]));
  const kept = new Set(blocks.map((block) => block.id));
  const changes = {};
  const inserted = [];
  const removed = document.blocks.filter((block) => !kept.has(block.id)).map((block) => block.id);
  for (const [index, block] of blocks.entries()) {
    const prior = original.get(block.id);
    if (prior) {
      if (!equal(prior.inlines, block.inlines)) changes[block.id] = block.inlines;
    } else
      inserted.push({
        id: block.id,
        paraId: block.id.slice(2),
        inlines: block.inlines,
        after: blocks[index - 1]?.parent === block.parent ? blocks[index - 1].id : block.anchor,
        like: block.template,
      });
  }
  return { changes, inserted, removed };
}

/**
 * @param {any} document
 * @param {any[]} blocks
 */
export function validate(document, blocks) {
  const request = aggregate(document, blocks);
  let index = 0;
  const source = { ...document, allocateId: () => request.inserted[index++]?.paraId ?? '00000000' };
  const plan = planBlocks(source, request.changes, request);
  if ([...plan.moved.keys()].some((id) => plan.byId.get(id)?.kind === 'opaque'))
    throw new AppError('DOCX_OPAQUE_BLOCK', '跨段落的域只能整体保留。');
  renderBlocks(source, plan, request.changes, []);
}

/**
 * Apply stored changes as a projection; journal entries keep original inline references.
 * @param {any[]} blocks
 * @param {any[]} records
 * @returns {any[]}
 */
export function replay(blocks, records) {
  const next = blocks.slice();
  for (const record of records) {
    const index = next.findIndex((block) => block.id === record.blockId);
    if (['edit', 'comment'].includes(record.op))
      next[index] = { ...next[index], inlines: record.after };
    else if (record.op === 'remove-block') next.splice(index, 1);
    else if (record.op === 'insert-block') {
      const after = record.after;
      const at = after.after === '^' ? -1 : next.findIndex((block) => block.id === after.after);
      next.splice(at + 1, 0, { ...after.block, id: record.blockId, inlines: after.inlines });
    }
  }
  return next;
}

function insertedKind(document, template, parent) {
  const original = document.blocks.find(
    (block) => block.id === (template?.template ?? template?.id),
  );
  const properties = original?.pPr ? document.inside(original.pPr) : [];
  let kind = properties.some((span) => span.tag === 'w:numPr') ? 'list-item' : 'paragraph';
  if (template?.level != null || /^Heading/iu.test(template?.style ?? '')) kind = 'heading';
  for (let span = document.spans[parent]; span; span = document.spans[span.parent])
    if (span.tag === 'w:tc') return 'table-cell';
  return kind;
}

function requireEditable(block) {
  if (block.kind === 'opaque') throw new AppError('DOCX_OPAQUE_BLOCK', '跨段落的域只能整体保留。');
}

/**
 * @param {any} state
 * @param {any} input
 * @returns {any}
 */
export function propose(state, input) {
  input = structuredClone(input);
  const records = [];
  const inserted = {};
  let blocks = state.blocks.slice();
  const find = (id) => {
    const block = blocks.find((entry) => entry.id === id);
    if (!block) throw new AppError('DOCX_BLOCK_NOT_FOUND', '这段正文已不存在，请重新载入。');
    return block;
  };
  const add = (record) => {
    records.push(record);
    blocks = replay(blocks, [record]);
  };
  for (const [id, inlines] of Object.entries(input.blocks ?? {})) {
    if (input.removed?.includes(id)) continue;
    const block = find(id);
    requireEditable(block);
    if (!Array.isArray(inlines)) throw new AppError('DESK_INPUT', '段落内容必须是内联项列表。');
    if (!equal(block.inlines, inlines))
      add({ blockId: id, op: 'edit', before: block.inlines, after: inlines });
  }
  for (const entry of input.inserted ?? []) {
    if (blocks.some((block) => block.id === entry.id) || inserted[entry.id])
      throw new AppError('DOCX_DUPLICATE_BLOCK', '新段落的临时标识重复。');
    const after = inserted[entry.after] ?? entry.after;
    const anchor = after === '^' ? null : find(after);
    if (
      anchor?.kind === 'opaque' &&
      state.document.fields.some((field) => field.start < anchor.end && field.end > anchor.end)
    )
      throw new AppError('DOCX_OPAQUE_BLOCK', '不能在跨段落的域内部插段，请在域之后插入。');
    const template = entry.like
      ? find(inserted[entry.like] ?? entry.like)
      : (anchor ?? blocks.find((block) => block.kind !== 'table-cell'));
    const id = 'p:' + state.allocateId();
    inserted[entry.id] = id;
    const parent =
      anchor?.parent ?? state.document.spans.find((span) => span.tag === 'w:body').index;
    const block = {
      id,
      kind: insertedKind(state.document, template, parent),
      style: template?.style ?? null,
      level: template?.level ?? null,
      template: template?.template ?? template?.id,
      parent,
      anchor: anchor?.anchor ?? after,
    };
    add({
      blockId: id,
      op: 'insert-block',
      before: null,
      after: { inlines: entry.inlines ?? [], after, like: entry.like ?? after, block },
    });
  }
  for (const id of input.removed ?? []) {
    const block = find(id);
    requireEditable(block);
    const index = blocks.indexOf(block);
    add({
      blockId: id,
      op: 'remove-block',
      before: { inlines: block.inlines, after: blocks[index - 1]?.id ?? '^', block },
      after: null,
    });
  }
  validate(state.document, blocks);
  return { records, blocks, inserted };
}

/**
 * @param {any} state
 * @param {any} record
 * @returns {any}
 */
export function inverse(state, record) {
  const current = state.blocks.find((block) => block.id === record.blockId);
  const expected = ['edit', 'comment'].includes(record.op) ? record.after : record.after?.inlines;
  if (
    record.undoneBy ||
    (record.op === 'remove-block' ? !!current : !equal(current?.inlines, expected))
  )
    throw conflict('DESK_UNDO_BLOCKED', '这段正文后来又被修改，请先撤回后面的修改。');
  let undo;
  if (['edit', 'comment'].includes(record.op))
    undo = { ...record, before: record.after, after: record.before, annotations: [] };
  else if (record.op === 'insert-block')
    undo = {
      blockId: record.blockId,
      op: 'remove-block',
      before: {
        inlines: current.inlines,
        after: state.blocks[state.blocks.indexOf(current) - 1]?.id ?? '^',
        block: current,
      },
      after: null,
    };
  else {
    if (
      record.before.after !== '^' &&
      !state.blocks.some((block) => block.id === record.before.after)
    )
      throw conflict('DESK_UNDO_BLOCKED', '原位置的前一段已被删除，请先撤回那次删除。');
    undo = { blockId: record.blockId, op: 'insert-block', before: null, after: record.before };
  }
  const records = [undo];
  const blocks = replay(state.blocks, records);
  validate(state.document, blocks);
  return { records, blocks, inserted: {} };
}
