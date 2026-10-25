// Markdown and TeX split into blocks at blank lines (a Markdown code fence
// stays one block). The server's text sessions and the desk's editor share it,
// so the editor can tell which session block a selection is in.

/**
 * @param {string} text
 * @param {string} format
 * @returns {any[]}
 */
export function splitText(text, format) {
  const blocks = [];
  let current = null;
  let offset = 0;
  let fence = null;
  for (const line of text.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
    const content = line.replace(/\r?\n$/u, '');
    const marker =
      format === 'md' ? content.replace(/^\uFEFF/u, '').match(/^ {0,3}(`{3,}|~{3,})(.*)$/u) : null;
    if (!fence && !content.trim()) {
      if (blocks.length) blocks.at(-1).end = offset + line.length;
      current = null;
    } else {
      if (marker && !fence) current = null;
      if (!current) {
        current = { start: blocks.length ? offset : 0, end: 0, from: offset, to: 0 };
        blocks.push(current);
      }
      current.end = offset + line.length;
      current.to = offset + content.length;
      if (marker) {
        if (!fence) fence = marker[1];
        else if (
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        ) {
          fence = null;
          current = null;
        }
      }
    }
    offset += line.length;
  }
  if (!blocks.length && text) blocks.push({ start: 0, end: text.length, from: 0, to: 0 });
  return blocks.map((span, index) => {
    const content = text.slice(span.from, span.to).replace(/^\uFEFF/u, '');
    const heading = format === 'md' ? content.match(/^ {0,3}(#{1,6})(?:\s|$)/u) : null;
    const section =
      format === 'tex'
        ? content.match(
            /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?[{[]/u,
          )
        : null;
    const level =
      heading?.[1].length ??
      (section
        ? {
            part: 1,
            chapter: 1,
            section: 1,
            subsection: 2,
            subsubsection: 3,
            paragraph: 4,
            subparagraph: 5,
          }[section[1]]
        : null);
    return {
      id: `t:${index}`,
      kind: level == null ? 'paragraph' : 'heading',
      level,
      text: content,
      raw: text.slice(span.start, span.end),
    };
  });
}
