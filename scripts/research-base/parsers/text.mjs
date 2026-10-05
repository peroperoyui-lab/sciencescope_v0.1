// Plain text, logs, CSV/TSV and JSON: paragraphs split on blank lines; tables
// kept as row groups so a passage never cuts a row in half.
import { decodeText } from './index.mjs';

export const textParser = {
  id: 'text',
  extensions: ['.txt', '.log', '.csv', '.tsv', '.json', '.jsonl', '.py', '.r', '.m', '.js', '.ts', '.sql', '.yaml', '.yml', '.toml', '.ini', '.bib', '.ris'],
  async parse(bytes, { name = '' } = {}) {
    const text = decodeText(bytes);
    const lower = name.toLowerCase();
    if (/\.(csv|tsv)$/u.test(lower)) {
      const lines = text.split('\n').filter((line) => line.trim());
      const header = lines[0] ?? '';
      const blocks = [];
      for (let i = 1; i < lines.length; i += 40) blocks.push({ kind: 'table', text: [header, ...lines.slice(i, i + 40)].join('\n'), section: `rows ${i}–${Math.min(lines.length - 1, i + 39)}` });
      if (!blocks.length && header) blocks.push({ kind: 'table', text: header });
      return { blocks };
    }
    const code = /\.(py|r|m|js|ts|sql|json|jsonl|yaml|yml|toml|ini)$/u.test(lower);
    const blocks = text.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean).map((part) => ({ kind: code ? 'code' : 'paragraph', text: part }));
    return { blocks };
  },
};
