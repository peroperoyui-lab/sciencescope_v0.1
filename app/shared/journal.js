// References live beside their log entry in Markdown, so file edits, history
// restore and AI tools all carry the same durable information.
const REFERENCES = /<!-- sciencescope:references (.*?) -->/g;

/**
 * @param {string|null} text
 * @returns {Array<{start:number,end:number,date:string,title:string,body:string,references:import('../core/references.js').ContentReference[]}>}
 */
export function parseLog(text) {
  const lines = (text ?? '').split('\n');
  const entries = [];
  lines.forEach((line, index) => {
    if (!line.startsWith('## ')) return;
    if (entries.length) entries.at(-1).end = index;
    const heading = line.slice(3).trim();
    const date = /^\d{4}-\d{2}-\d{2}/.exec(heading)?.[0] ?? '';
    entries.push({
      start: index,
      end: lines.length,
      date,
      title: heading.slice(date.length).trim() || heading,
      body: '',
      references: [],
    });
  });
  for (const entry of entries) {
    entry.body = lines
      .slice(entry.start + 1, entry.end)
      .join('\n')
      .replace(REFERENCES, (original, json) => {
        try {
          const references = JSON.parse(json);
          if (!Array.isArray(references)) return original;
          entry.references.push(...references);
          return '';
        } catch {
          return original;
        }
      })
      .trim();
  }
  return entries.reverse();
}

/**
 * @param {string} title
 * @param {string} body
 * @param {string} date
 * @param {import('../core/references.js').ContentReference[]} [references]
 * @returns {string}
 */
export function logEntryText(title, body, date, references = []) {
  const metadata = references.length
    ? `\n<!-- sciencescope:references ${JSON.stringify(references).replace(/</g, '\\u003c')} -->\n`
    : '';
  return `\n## ${date ? date + ' ' : ''}${title}\n${body ? `\n${body}\n` : ''}${metadata}`;
}
