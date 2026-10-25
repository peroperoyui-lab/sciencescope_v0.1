// The desk's help around a selection (U4): which session block a source
// selection is in, the sentence around the cursor, the mark a selection makes
// in a chat, and how recorded changes read back as before and after.
import { splitText } from '../shared/text-blocks.js';
import { t } from './i18n/index.js';

/** The five common instructions under the rewrite box. */
export const PRESETS = ['润色', '精简', '更正式', '译成英文', '核对数据'];

/** A block's text from a change record: inlines, raw source text or a block. @param {any} value */
export function changeText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.replace(/^\uFEFF/u, '').replace(/\s+$/u, '');
  if (Array.isArray(value))
    return value.map((inline) => inline.text ?? inline.display ?? '￼').join('');
  if (value.inlines) return changeText(value.inlines);
  if (typeof value.text === 'string') return changeText(value.text);
  if (value.block) return changeText(value.block);
  return '';
}

/**
 * Which block of a Markdown or TeX file an offset is in, and where that block's
 * text starts. Blocks are counted like the server's text session.
 * @param {string} text the file text without its BOM @param {'md' | 'tex'} format
 * @param {number} offset
 * @returns {{ index: number, start: number, block: any } | null}
 */
export function textBlockAt(text, format, offset) {
  const blocks = splitText(text, format);
  let at = 0;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const start = at + Math.max(0, block.raw.indexOf(block.text));
    at += block.raw.length;
    if (offset < at || index === blocks.length - 1) return { index, start, block };
  }
  return null;
}

/**
 * Where each block's text starts in the file text, and its length, in the
 * server's order. One pass for a whole list of ranges.
 * @param {string} text the file text without its BOM @param {'md' | 'tex'} format
 * @returns {{ start: number, length: number }[]}
 */
export function textBlockSpans(text, format) {
  let at = 0;
  return splitText(text, format).map((block) => {
    const start = at + Math.max(0, block.raw.indexOf(block.text));
    at += block.raw.length;
    return { start, length: block.text.length };
  });
}

/**
 * The start of block `index`'s text in the file text.
 * @param {string} text @param {'md' | 'tex'} format @param {number} index
 */
export function textBlockStart(text, format, index) {
  const blocks = splitText(text, format);
  let at = 0;
  for (let current = 0; current < Math.min(index, blocks.length); current++)
    at += blocks[current].raw.length;
  const block = blocks[index];
  return block ? at + Math.max(0, block.raw.indexOf(block.text)) : null;
}

/**
 * The sentence around `offset` in a paragraph: up to and including the next
 * sentence end (。！？!?；;), from just after the previous one; at the end of a
 * sentence, that sentence.
 * @param {string} text @param {number} offset
 * @returns {[number, number]}
 */
export function sentenceAround(text, offset) {
  const end = /[。！？!?；;\n]/u;
  let from = Math.min(offset, text.length);
  while (from > 0 && !end.test(text[from - 1])) from--;
  let to = Math.min(offset, text.length);
  while (to < text.length && !end.test(text[to])) to++;
  if (to < text.length && text[to] !== '\n') to++;
  while (from < to && /\s/u.test(text[from])) from++;
  // At a paragraph's end or just after a sentence, it is the sentence before.
  if (from >= to && offset > 0 && text[offset - 1] !== '\n')
    return sentenceAround(text, offset - 1);
  return [from, to];
}

/**
 * The research-input mark a desk selection adds to a chat, the same shape the
 * rewrite request posts (schema 1 version reference with paragraph and quote).
 * @param {{ version: { id: string, projectId: string }, groupId: string, title: string,
 *   blockId: string, paragraph: number, quote: string, from?: number | null, to?: number | null }} input
 */
export function deskMark({ version, groupId, title, blockId, paragraph, quote, from, to }) {
  const location = {
    paragraph,
    blockId,
    quote: { exact: quote },
    ...(from != null && to != null ? { characters: { start: from, end: to } } : {}),
    description: t('第 {number} 段', { number: paragraph }),
  };
  const reference = {
    schema: 1,
    kind: 'version',
    id: version.id,
    projectId: version.projectId,
    location,
  };
  return {
    sourceId: version.id,
    target: reference,
    reference,
    title,
    location,
    quote: { exact: quote },
    text: quote,
    manuscriptKey: `${version.projectId}/${groupId}`,
  };
}

/**
 * A chat mark that points at a sentence of a desk document, or null.
 * @param {any} mark
 */
export function deskReference(mark) {
  const reference = mark?.reference ?? mark?.target;
  if (reference?.schema !== 1 || !['version', 'project-file'].includes(reference.kind)) return null;
  const location = reference.location ?? {};
  return location.quote?.exact || location.blockId ? reference : null;
}

/**
 * Change records grouped into runs: one actor's consecutive edits to one
 * paragraph read as one change, from the first record's before to the last
 * record's after.
 * @param {any[]} records in order
 * @returns {{ blockId: string, actorId: string, ids: string[], op: string, before: string,
 *   after: string, instruction: string, createdAt: string }[]}
 */
export function changeRuns(records) {
  const runs = [];
  for (const record of records) {
    const last = runs.at(-1);
    if (last && last.blockId === record.blockId && last.actorId === record.actorId) {
      last.ids.push(record.id);
      last.after = changeText(record.after);
      last.createdAt = record.createdAt;
      if (record.op !== 'edit') last.op = record.op;
      continue;
    }
    runs.push({
      blockId: record.blockId,
      actorId: record.actorId ?? 'person_user',
      ids: [record.id],
      op: record.op,
      before: changeText(record.before),
      after: changeText(record.after),
      instruction: record.instruction ?? '',
      createdAt: record.createdAt,
    });
  }
  return runs;
}

const words = new Intl.Segmenter('zh', { granularity: 'word' });

/**
 * Before and after of a paragraph as parts, by Chinese words.
 * @param {(a: string[], b: string[]) => { value: string[], added?: boolean, removed?: boolean }[]} diffArrays
 * @param {string} before @param {string} after
 * @returns {{ type: 'same' | 'del' | 'ins', text: string }[]}
 */
export function wordDiff(diffArrays, before, after) {
  const split = (text) => Array.from(words.segment(text), (entry) => entry.segment);
  return diffArrays(split(before), split(after)).map((part) => ({
    type: part.added ? 'ins' : part.removed ? 'del' : 'same',
    text: part.value.join(''),
  }));
}
