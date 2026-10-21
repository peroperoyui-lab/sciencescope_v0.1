import { escapeXml } from './xml.js';
import { sameMarks, writeProperties } from './marks.js';

/**
 * Rebuild only changed runs and containers. Inline boundaries remain available
 * for the existing comment writer even when a mixed run must be split there.
 * @param {any} document
 * @param {any} block
 * @param {any[]} inlines
 * @param {any[]} comments
 * @returns {string}
 */
export function renderBlock(document, block, inlines, comments) {
  if (block.kind === 'opaque') throw new Error(`Cannot rewrite opaque block ${block.id}`);
  const { raw } = document;
  const prefix = block.name.includes(':') ? block.name.split(':')[0] + ':' : '';
  const marksOf = (inline) => inline.marks ?? document.runs[inline.run]?.marks ?? [];
  const same = (left, right) =>
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        item.text === other.text &&
        item.atom === other.atom &&
        item.ref === other.ref &&
        item.run === other.run &&
        item.wrap === other.wrap &&
        sameMarks(marksOf(item), marksOf(other))
      );
    });
  if (!comments.length && same(inlines, block.inlines)) return raw(block);
  const boundary = new Map();
  const marker = (local, id) => `<${prefix}${local} ${prefix}id="${id}"/>`;
  for (const comment of comments) {
    boundary.set(
      comment.from,
      (boundary.get(comment.from) ?? '') + marker('commentRangeStart', comment.id),
    );
    boundary.set(
      comment.to,
      (boundary.get(comment.to) ?? '') +
        marker('commentRangeEnd', comment.id) +
        `<${prefix}r>${marker('commentReference', comment.id)}</${prefix}r>`,
    );
  }
  const emitted = new Set();
  const emitBoundary = (index) => {
    if (emitted.has(index)) return '';
    emitted.add(index);
    return boundary.get(index) ?? '';
  };
  const interrupted = (items) =>
    [...boundary.keys()].some((index) => index > items[0].index && index <= items.at(-1).index);
  const wrapChain = (inline) => {
    const chain = [];
    for (let ref = inline.wrap; ref != null; ref = document.wraps[ref].parent) chain.unshift(ref);
    return chain;
  };
  const items = inlines.map((inline, index) => ({ inline, index, chain: wrapChain(inline) }));
  function renderRun(group) {
    const first = group[0];
    // A new span inherits the run at its edit point; insertion at the start
    // inherits the following run, so explicit East Asian fonts survive.
    const neighbour =
      first.inline.run == null
        ? (inlines
            .slice(0, first.index)
            .reverse()
            .find((item) => item.run != null) ??
          inlines.slice(first.index + 1).find((item) => item.run != null) ??
          block.inlines.find((item) => item.run != null))
        : null;
    const run = document.runs[first.inline.run ?? neighbour?.run];
    if (
      run &&
      same(
        group.map((item) => item.inline),
        run.inlines,
      )
    )
      return raw(run);
    const name = run?.name ?? prefix + 'r';
    const runPrefix = name.includes(':') ? name.split(':')[0] + ':' : '';
    let output = '';
    for (let start = 0; start < group.length;) {
      const inline = group[start].inline;
      const marks = inline.marks ?? run?.marks ?? [];
      let end = start + 1;
      while (end < group.length && sameMarks(group[end].inline.marks ?? run?.marks ?? [], marks))
        end++;
      const content = group
        .slice(start, end)
        .map(({ inline: part }) =>
          part.atom
            ? raw(document.atoms[part.ref])
            : part.text
              ? `<${runPrefix}t xml:space="preserve">${escapeXml(part.text)}</${runPrefix}t>`
              : '',
        )
        .join('');
      if (content) {
        const opening = run
          ? document.xml.slice(run.start, run.openEnd).replace(/\/>$/u, '>')
          : `<${name}>`;
        output +=
          opening + writeProperties(document, run, marks, runPrefix) + content + `</${name}>`;
      }
      start = end;
    }
    return output;
  }
  function renderItems(values, depth = 0) {
    let result = '';
    for (let start = 0; start < values.length;) {
      const item = values[start];
      result += emitBoundary(item.index);
      const wrap = item.chain[depth];
      let end = start + 1;
      if (wrap != null) {
        while (end < values.length && values[end].chain[depth] === wrap) end++;
        const group = values.slice(start, end);
        const original = document.wraps[wrap];
        if (
          !interrupted(group) &&
          same(
            group.map((entry) => entry.inline),
            original.inlines,
          )
        )
          result += raw(original);
        else {
          const content = renderItems(group, depth + 1);
          if (content)
            result +=
              document.xml.slice(original.start, original.contentStart) +
              content +
              document.xml.slice(original.contentEnd, original.end);
        }
      } else if (item.inline.run != null || !item.inline.atom) {
        while (
          item.inline.run != null &&
          end < values.length &&
          values[end].chain[depth] == null &&
          values[end].inline.run === item.inline.run &&
          !boundary.has(values[end].index)
        )
          end++;
        result += renderRun(values.slice(start, end));
      } else result += raw(document.atoms[item.inline.ref]);
      start = end;
    }
    return result;
  }
  const body =
    (block.pPr ? document.xml.slice(block.openEnd, block.pPr.end) : '') +
    renderItems(items) +
    emitBoundary(inlines.length);
  const opening = document.xml.slice(block.start, block.openEnd);
  return (block.selfClosing ? opening.replace(/\/>$/u, '>') : opening) + body + `</${block.name}>`;
}
