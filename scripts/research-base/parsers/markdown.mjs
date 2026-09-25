// Markdown: ATX headings build the section path; fenced code, $$ math blocks
// and tables stay whole; the first H1 becomes the title.
import { decodeText } from './index.mjs';

export const markdownParser = {
  id: 'markdown',
  extensions: ['.md', '.markdown', '.qmd', '.rmd'],
  async parse(bytes) {
    const text = decodeText(bytes).replace(/^---\n[\s\S]*?\n---\n/u, '');
    const lines = text.split('\n');
    const blocks = []; const path = []; let title; let buffer = []; let kind = 'paragraph'; let fence = null;
    const section = () => path.filter(Boolean).join(' > ') || undefined;
    const flush = () => { const body = buffer.join('\n').trim(); if (body) blocks.push({ kind, text: body, section: section() }); buffer = []; kind = 'paragraph'; };
    for (const line of lines) {
      if (fence) { buffer.push(line); if (line.trim().startsWith(fence)) { fence = null; flush(); } continue; }
      const open = /^\s*(```|~~~|\$\$)/u.exec(line);
      if (open) { flush(); fence = open[1]; kind = open[1] === '$$' ? 'equation' : 'code'; buffer.push(line); if (open[1] === '$$' && line.trim().length > 2 && line.trim().endsWith('$$')) { fence = null; flush(); } continue; }
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
      if (heading) {
        flush();
        const level = heading[1].length; path.length = level - 1; path[level - 1] = heading[2];
        if (level === 1 && !title) title = heading[2];
        blocks.push({ kind: 'heading', text: heading[2], section: section() });
        continue;
      }
      if (!line.trim()) { flush(); continue; }
      if (/^\s*\|/u.test(line) && kind !== 'table') { flush(); kind = 'table'; }
      else if (kind === 'table' && !/^\s*\|/u.test(line)) flush();
      buffer.push(line);
    }
    flush();
    return { blocks, metadata: title ? { title } : {} };
  },
};
