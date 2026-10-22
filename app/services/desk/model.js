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
    if (record.op === 'edit') next[index] = { ...next[index], inlines: record.after };
    else if (record.op === 'remove-block') next.splice(index, 1);
    else {
      const after = record.after;
      const at = after.after === '^' ? -1 : next.findIndex((block) => block.id === after.after);
      next.splice(at + 1, 0, { ...after.block, id: record.blockId, inlines: after.inlines });
    }
  }
  return next;
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
    if (block.kind === 'opaque')
      throw new AppError('DOCX_OPAQUE_BLOCK', '跨段落的域只能整体保留。');
    return block;
  };
  const add = (record) => {
    records.push(record);
    blocks = replay(blocks, [record]);
  };
  for (const [id, inlines] of Object.entries(input.blocks ?? {})) {
    if (input.removed?.includes(id)) continue;
    const block = find(id);
    if (!Array.isArray(inlines)) throw new AppError('DESK_INPUT', '段落内容必须是内联项列表。');
    if (!equal(block.inlines, inlines))
      add({ blockId: id, op: 'edit', before: block.inlines, after: inlines });
  }
  for (const entry of input.inserted ?? []) {
    if (blocks.some((block) => block.id === entry.id) || inserted[entry.id])
      throw new AppError('DOCX_DUPLICATE_BLOCK', '新段落的临时标识重复。');
    const after = inserted[entry.after] ?? entry.after;
    const anchor = after === '^' ? null : find(after);
    const template = entry.like
      ? find(inserted[entry.like] ?? entry.like)
      : (anchor ?? blocks.find((block) => block.kind !== 'table-cell'));
    const id = 'p:' + state.allocateId();
    inserted[entry.id] = id;
    const block = {
      id,
      kind: template?.kind ?? 'paragraph',
      style: template?.style ?? null,
      level: template?.level ?? null,
      template: template?.template ?? template?.id,
      parent: anchor?.parent ?? state.document.spans.find((span) => span.tag === 'w:body').index,
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
  const expected = record.op === 'edit' ? record.after : record.after?.inlines;
  if (
    record.undoneBy ||
    (record.op === 'remove-block' ? !!current : !equal(current?.inlines, expected))
  )
    throw conflict('DESK_UNDO_BLOCKED', '这段正文后来又被修改，请先撤回后面的修改。');
  let undo;
  if (record.op === 'edit') undo = { ...record, before: record.after, after: record.before };
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
