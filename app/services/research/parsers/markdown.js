import { decodeText, sectionPath } from './text-utils.js';

/** @type {import('./types.js').DocumentParser} */
export const markdownParser = {
  id: 'markdown',
  extensions: ['.md', '.markdown', '.qmd', '.rmd'],
  async parse(bytes) {
    const source = decodeText(bytes).replace(/^---\n[\s\S]*?\n---(?:\n|$)/u, '');
    const blocks = [];
    const headings = [];
    let title;
    let lines = [];
    let kind = 'paragraph';
    let fence = null;
    const flush = () => {
      const text = lines.join('\n').trim();
      if (text) blocks.push({ kind, text, section: sectionPath(headings) });
      lines = [];
      kind = 'paragraph';
    };
    for (const line of source.split('\n')) {
      if (fence) {
        lines.push(line);
        if (line.trim().startsWith(fence)) {
          fence = null;
          flush();
        }
        continue;
      }
      const opening = /^\s*(`{3,}|~{3,}|\$\$)/u.exec(line);
      if (opening) {
        flush();
        fence = opening[1];
        kind = fence === '$$' ? 'equation' : 'code';
        lines.push(line);
        if (fence === '$$' && line.trim().length > 2 && line.trim().endsWith('$$')) {
          fence = null;
          flush();
        }
        continue;
      }
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
      if (heading) {
        flush();
        const level = heading[1].length;
        headings.length = level - 1;
        headings[level - 1] = heading[2];
        if (level === 1 && !title) title = heading[2];
        blocks.push({ kind: 'heading', text: heading[2], section: sectionPath(headings) });
        continue;
      }
      if (!line.trim()) {
        flush();
        continue;
      }
      const isTable = /^\s*\|/u.test(line);
      if (isTable && kind !== 'table') {
        flush();
        kind = 'table';
      } else if (!isTable && kind === 'table') flush();
      lines.push(line);
    }
    flush();
    return { blocks, metadata: title ? { title } : {} };
  },
};
