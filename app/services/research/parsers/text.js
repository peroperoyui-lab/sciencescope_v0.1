import { decodeText } from './text-utils.js';

/** @type {import('./types.js').DocumentParser} */
export const textParser = {
  id: 'text',
  extensions: [
    '.txt',
    '.log',
    '.csv',
    '.tsv',
    '.json',
    '.jsonl',
    '.py',
    '.r',
    '.m',
    '.js',
    '.ts',
    '.sql',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.bib',
    '.ris',
  ],
  async parse(bytes, { name = '' } = {}) {
    const text = decodeText(bytes);
    if (/\.(csv|tsv)$/iu.test(name)) {
      const lines = text.split('\n').filter((line) => line.trim());
      const header = lines.shift();
      const blocks = [];
      for (let index = 0; index < lines.length; index += 40) {
        blocks.push({
          kind: 'table',
          text: [header, ...lines.slice(index, index + 40)].join('\n'),
          section: `rows ${index + 1}–${Math.min(lines.length, index + 40)}`,
        });
      }
      if (!blocks.length && header) blocks.push({ kind: 'table', text: header });
      return { blocks };
    }
    const isCode = /\.(py|r|m|js|ts|sql|json|jsonl|yaml|yml|toml|ini)$/iu.test(name);
    const blocks = text
      .split(/\n{2,}/u)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => ({ kind: isCode ? 'code' : 'paragraph', text: part }));
    return { blocks };
  },
};
