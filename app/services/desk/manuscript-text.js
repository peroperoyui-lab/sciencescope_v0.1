// Tool text exposes immutable atoms explicitly. Edits are translated back to
// the existing inline model, preserving untouched runs and container references.
import { AppError } from '../../core/errors.js';
import { splitText } from './text.js';

const atomPattern = /⟦[^⟧]*⟧/gu;
const marker = (inline) =>
  `⟦${inline.atom}:${inline.ref}${['field', 'math'].includes(inline.atom) && inline.display ? ' ' + inline.display : ''}⟧`;

/**
 * @param {any} block
 * @returns {string}
 */
export function manuscriptText(block) {
  return block.inlines
    ? block.inlines.map((inline) => (inline.atom ? marker(inline) : inline.text)).join('')
    : block.text;
}

/**
 * @param {any} block
 * @param {string} find
 * @returns {{text:string,from:number,to:number}}
 */
export function findText(block, find) {
  const text = manuscriptText(block);
  const from = typeof find === 'string' && find.length ? text.indexOf(find) : -1;
  const code =
    from < 0 ? 'TEXT_NOT_FOUND' : text.indexOf(find, from + 1) >= 0 ? 'TEXT_AMBIGUOUS' : null;
  if (code)
    throw Object.assign(
      new AppError(
        code,
        code === 'TEXT_NOT_FOUND'
          ? '没有找到这段原文，请重新读取当前段落。'
          : '这段原文出现不止一次，请提供更完整的原文。',
      ),
      { details: { block: { id: block.id, text } } },
    );
  return { text, from, to: from + find.length };
}

/**
 * @param {any} block
 * @param {string} find
 * @param {string} replacement
 * @returns {any[]}
 */
export function replaceInlines(block, find, replacement) {
  const { from, to } = findText(block, find);
  let offset = 0;
  const spans = block.inlines.map((inline) => {
    const text = inline.atom ? marker(inline) : inline.text;
    const span = { inline, text, from: offset, to: offset + text.length };
    offset = span.to;
    return span;
  });
  const atoms = spans.filter((span) => span.inline.atom && span.from < to && span.to > from);
  const supplied = replacement.match(atomPattern) ?? [];
  if (
    atoms.some((span) => span.from < from || span.to > to) ||
    supplied.length !== atoms.length ||
    atoms.some((span, index) => span.text !== supplied[index])
  )
    throw new AppError('DESK_ATOM_CHANGED', '请原样保留公式、引文和图片的原子记号及顺序。');
  const at = spans.find((span) => span.to > from)?.inline ?? {};
  const textInline = (text) => ({
    text,
    marks: at.marks ?? [],
    ...(at.run != null ? { run: at.run } : {}),
    ...(at.wrap != null ? { wrap: at.wrap } : {}),
  });
  const slice = (start, end) =>
    spans.flatMap((span) => {
      if (span.to <= start || span.from >= end) return [];
      if (span.inline.atom) return [span.inline];
      const text = span.text.slice(
        Math.max(0, start - span.from),
        Math.min(span.text.length, end - span.from),
      );
      return text ? [{ ...span.inline, text }] : [];
    });
  const middle = [];
  let consumed = 0;
  for (const atom of atoms) {
    const index = replacement.indexOf(atom.text, consumed);
    if (index > consumed) middle.push(textInline(replacement.slice(consumed, index)));
    middle.push(atom.inline);
    consumed = index + atom.text.length;
  }
  if (consumed < replacement.length) middle.push(textInline(replacement.slice(consumed)));
  return [...slice(0, from), ...middle, ...slice(to, Infinity)];
}

/**
 * @param {string} text
 * @returns {void}
 */
export function plainInsertion(text) {
  if (text.match(atomPattern))
    throw new AppError('DESK_ATOM_CHANGED', '新段落不能添加原子记号，请保留原有公式、引文和图片。');
}

/**
 * Compose a full-text update without changing unrelated separators or line endings.
 * The desk's updateText remains the only recorder of text edits.
 * @param {any} current
 * @param {string} format
 * @param {string} op
 * @param {any} args
 * @returns {string}
 */
export function editText(current, format, op, args) {
  const parsed = splitText(current.text, format);
  const index = current.blocks.findIndex((block) => block.id === (args.block ?? args.after));
  const block = current.blocks[index];
  if (op === 'replace') {
    const { from, to } = findText(block, args.find);
    const raw = parsed[index].raw;
    const start = raw.indexOf(block.text);
    parsed[index].raw = raw.slice(0, start + from) + args.with + raw.slice(start + to);
  } else if (op === 'removeBlock') {
    parsed.splice(index, 1);
    if (current.text.startsWith('\uFEFF') && parsed.length && !parsed[0].raw.startsWith('\uFEFF'))
      parsed[0].raw = '\uFEFF' + parsed[0].raw;
  } else {
    plainInsertion(args.text);
    const newline = current.text.includes('\r\n') ? '\r\n' : '\n';
    if (index >= 0 && !parsed[index].raw.endsWith(newline + newline))
      parsed[index].raw += newline + newline;
    const prefix = index < 0 && current.text.startsWith('\uFEFF') ? '\uFEFF' : '';
    if (prefix && parsed.length) parsed[0].raw = parsed[0].raw.slice(1);
    parsed.splice(index + 1, 0, { raw: prefix + args.text + newline + newline });
  }
  return parsed.map((entry) => entry.raw).join('');
}
