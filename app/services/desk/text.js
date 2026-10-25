// diffArrays pairs unchanged paragraph text; raw slices retain separators, BOM
// and line endings in the same journal so undo and crash replay are lossless.
import { diffArrays } from 'diff';
import { AppError } from '../../core/errors.js';
import { conflict } from './model.js';
import { splitText } from '../../shared/text-blocks.js';

export { splitText };

/**
 * @param {Uint8Array} bytes
 * @param {string} format
 * @returns {any}
 */
export function readText(bytes, format) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new AppError(
      'DESK_ENCODING',
      '这份文稿不是有效的 UTF-8，请在原编辑器中另存为 UTF-8 后重试。',
    );
  }
  return { bytes, format, blocks: splitText(text, format) };
}

/**
 * @param {any[]} blocks
 * @returns {string}
 */
export const joinText = (blocks) => blocks.map((block) => block.raw).join('');

function blockFrom(raw, id, format) {
  return {
    ...(splitText(raw, format)[0] ?? { kind: 'paragraph', level: null, text: '', raw }),
    id,
  };
}

/**
 * @param {any[]} original
 * @param {any[]} records
 * @param {string} format
 * @returns {any[]}
 */
export function replayText(original, records, format) {
  const blocks = original.slice();
  for (const record of records) {
    const index = blocks.findIndex((block) => block.id === record.blockId);
    if (record.op === 'edit') blocks[index] = blockFrom(record.after, record.blockId, format);
    else if (record.op === 'remove-block') blocks.splice(index, 1);
    else if (record.op === 'insert-block') {
      const at =
        record.after.after === '^'
          ? -1
          : blocks.findIndex((block) => block.id === record.after.after);
      blocks.splice(at + 1, 0, blockFrom(record.after.text, record.blockId, format));
    }
  }
  return blocks;
}

/**
 * @param {any} state
 * @param {{baseSeq:number,text:string}} input
 * @returns {any}
 */
export function proposeText(state, input) {
  if (typeof input.text !== 'string') throw new AppError('DESK_INPUT', '请提供文稿全文。');
  if (input.baseSeq !== state.session.seq)
    throw conflict('DESK_CONFLICT', '文稿已被修改，请以当前全文重新编辑。', {
      seq: state.session.seq,
      text: joinText(state.blocks),
    });
  if (joinText(state.blocks) === input.text)
    return { blocks: state.blocks, records: [], inserted: {} };
  const next = splitText(input.text, state.document.format);
  const changes = diffArrays(state.blocks, next, {
    comparator: (left, right) => left.text === right.text,
  });
  let oldIndex = 0;
  let newIndex = 0;
  let removed = [];
  let added = [];
  const pair = () => {
    added.forEach((block, index) => {
      block.id = removed[index]?.id ?? state.allocateId();
    });
    removed = [];
    added = [];
  };
  for (const change of changes) {
    if (change.removed) {
      removed.push(...state.blocks.slice(oldIndex, oldIndex + change.count));
      oldIndex += change.count;
    } else if (change.added) {
      added.push(...next.slice(newIndex, newIndex + change.count));
      newIndex += change.count;
    } else {
      pair();
      for (let index = 0; index < change.count; index++)
        next[newIndex++].id = state.blocks[oldIndex++].id;
    }
  }
  pair();
  let working = state.blocks;
  const records = [];
  const add = (record) => {
    records.push(record);
    working = replayText(working, [record], state.document.format);
  };
  const kept = new Set(next.map((block) => block.id));
  // Remove in reverse order so undoing successive deletions restores anchors.
  for (const block of [...working].reverse()) {
    if (!kept.has(block.id))
      add({
        blockId: block.id,
        op: 'remove-block',
        before: { text: block.raw, after: working[working.indexOf(block) - 1]?.id ?? '^' },
        after: null,
      });
  }
  for (const [index, block] of next.entries()) {
    const previous = working.find((entry) => entry.id === block.id);
    if (!previous)
      add({
        blockId: block.id,
        op: 'insert-block',
        before: null,
        after: { text: block.raw, after: next[index - 1]?.id ?? '^' },
      });
    else if (previous.raw !== block.raw)
      add({ blockId: block.id, op: 'edit', before: previous.raw, after: block.raw });
  }
  return { blocks: next, records, inserted: {} };
}

/**
 * @param {any} state
 * @param {any} record
 * @returns {any}
 */
export function inverseText(state, record) {
  const block = state.blocks.find((entry) => entry.id === record.blockId);
  const expected = record.op === 'edit' ? record.after : record.after?.text;
  if (
    record.undoneBy ||
    (record.op === 'remove-block' ? !!block : !block || block.raw !== expected)
  )
    throw conflict('DESK_UNDO_BLOCKED', '这段正文后来又被修改，请先撤回后面的修改。');
  let undo;
  if (record.op === 'edit')
    undo = { ...record, before: record.after, after: record.before, annotations: [] };
  else if (record.op === 'insert-block')
    undo = {
      blockId: record.blockId,
      op: 'remove-block',
      before: { text: block.raw, after: state.blocks[state.blocks.indexOf(block) - 1]?.id ?? '^' },
      after: null,
    };
  else {
    if (
      record.before.after !== '^' &&
      !state.blocks.some((entry) => entry.id === record.before.after)
    )
      throw conflict('DESK_UNDO_BLOCKED', '原位置的前一段已被删除，请先撤回那次删除。');
    undo = { blockId: record.blockId, op: 'insert-block', before: null, after: record.before };
  }
  const records = [undo];
  let blocks = replayText(state.blocks, records, state.document.format);
  // A UTF-8 BOM belongs to the file, not the first paragraph. A whole-text
  // deletion moves it to the next block; undo must transfer it back once.
  let transfer = null;
  if (
    undo.op === 'insert-block' &&
    undo.after.after === '^' &&
    undo.after.text.startsWith('\uFEFF') &&
    blocks[1]?.raw.startsWith('\uFEFF')
  ) {
    transfer = {
      blockId: blocks[1].id,
      op: 'edit',
      before: blocks[1].raw,
      after: blocks[1].raw.slice(1),
    };
  } else if (
    undo.op === 'remove-block' &&
    undo.before.after === '^' &&
    undo.before.text.startsWith('\uFEFF') &&
    blocks.length &&
    !blocks[0].raw.startsWith('\uFEFF')
  ) {
    transfer = {
      blockId: blocks[0].id,
      op: 'edit',
      before: blocks[0].raw,
      after: '\uFEFF' + blocks[0].raw,
    };
  }
  if (transfer) {
    records.push(transfer);
    blocks = replayText(blocks, [transfer], state.document.format);
  }
  return { blocks, records, inserted: {} };
}
