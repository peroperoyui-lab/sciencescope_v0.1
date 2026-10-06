const TARGET_CHARACTERS = 1200;
const SEGMENT_CHARACTERS = 2400;

/**
 * @typedef {import('./parsers/types.js').Block & {ordinal:number,
 * charStart:number, charEnd:number}} Chunk
 */

function anchorFor(block, text) {
  return {
    ...block.anchor,
    page: block.page ?? null,
    quote: { ...block.anchor?.quote, exact: text.slice(0, 240) },
    ...(block.anchor?.rects ? { rects: [...block.anchor.rects] } : {}),
  };
}

/**
 * Chunk size is a retrieval unit, never a document length limit. Character offsets
 * refer to trimmed source blocks joined with two newlines, before heading attachment.
 * @param {import('./parsers/types.js').Block[]} blocks
 * @returns {Chunk[]}
 */
export function chunkBlocks(blocks) {
  const chunks = [];
  let current = null;
  let heading = null;
  let offset = 0;
  const flush = () => {
    if (current?.text.trim()) chunks.push({ ...current, ordinal: chunks.length });
    current = null;
  };
  const flushHeading = () => {
    if (!heading) return;
    current = {
      kind: 'paragraph',
      text: heading.text,
      page: heading.block.page ?? null,
      section: heading.block.section ?? null,
      charStart: heading.start,
      charEnd: heading.start + heading.text.length,
      anchor: anchorFor(heading.block, heading.text),
    };
    flush();
    heading = null;
  };
  for (const block of blocks) {
    const text = String(block.text ?? '').trim();
    if (!text) continue;
    const start = offset;
    offset += text.length + 2;
    if (block.kind === 'heading') {
      flush();
      flushHeading();
      heading = { text, block, start };
      continue;
    }
    const standalone = ['equation', 'table', 'code'].includes(block.kind);
    const sameSpan =
      current?.page === (block.page ?? null) && current?.section === (block.section ?? null);
    if (
      current &&
      !standalone &&
      current.kind === 'paragraph' &&
      sameSpan &&
      current.text.length + text.length <= TARGET_CHARACTERS
    ) {
      current.text += `\n\n${text}`;
      current.charEnd = start + text.length;
      current.anchor.quote.exact = current.text.slice(0, 240);
      if (block.anchor?.rects)
        current.anchor.rects = [...(current.anchor.rects ?? []), ...block.anchor.rects];
      continue;
    }
    flush();
    if (
      heading &&
      ((heading.block.page ?? null) !== (block.page ?? null) ||
        (heading.block.section ?? null) !== (block.section ?? null))
    )
      flushHeading();
    for (let index = 0; index < text.length; index += SEGMENT_CHARACTERS) {
      const part = text.slice(index, index + SEGMENT_CHARACTERS);
      const lead = index === 0 && heading ? `${heading.text}\n` : '';
      current = {
        kind: block.kind ?? 'paragraph',
        text: lead + part,
        page: block.page ?? null,
        section: block.section ?? null,
        charStart: lead ? heading.start : start + index,
        charEnd: start + index + part.length,
        anchor: anchorFor(block, part),
      };
      if (standalone || index + SEGMENT_CHARACTERS < text.length) flush();
    }
    heading = null;
  }
  flush();
  flushHeading();
  return chunks;
}
