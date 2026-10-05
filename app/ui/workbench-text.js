// Plans and the research log are plain Markdown files. These helpers read
// them into cards and produce the edited text; the workspace stores each
// change as a revision.

const TASK = /^(\s*)- \[( |x|X)\] (.*)$/;

/**
 * Plan items: one per Markdown task line (`- [ ] text`).
 * @param {string} text
 * @returns {Array<{ line: number, done: boolean, text: string }>}
 */
export function parsePlans(text) {
  return (text ?? '').split('\n').flatMap((line, index) => {
    const match = TASK.exec(line);
    return match ? [{ line: index, done: match[2] !== ' ', text: match[3] }] : [];
  });
}

/**
 * Text with one plan line changed, or removed when `item` is null.
 * @param {string} text @param {number} line
 * @param {{ done: boolean, text: string } | null} item
 */
export function replacePlan(text, line, item) {
  const lines = text.split('\n');
  if (item) lines[line] = `- [${item.done ? 'x' : ' '}] ${item.text}`;
  else lines.splice(line, 1);
  return lines.join('\n');
}

/** @param {string} text @param {string} plan */
export function appendPlan(text, plan) {
  const base = text && !text.endsWith('\n') ? `${text}\n` : (text ?? '');
  return `${base}- [ ] ${plan}\n`;
}

/**
 * Log entries: one per second-level heading, newest (last) first.
 * The heading may start with a date: `## 2026-10-05 Title`.
 * @param {string} text
 * @returns {Array<{ start: number, end: number, date: string, title: string, body: string }>}
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
    });
  });
  for (const entry of entries) {
    entry.body = lines
      .slice(entry.start + 1, entry.end)
      .join('\n')
      .trim();
  }
  return entries.reverse();
}

/** @param {string} text @param {{ start: number, end: number }} entry */
export function removeLogEntry(text, entry) {
  const lines = text.split('\n');
  lines.splice(entry.start, entry.end - entry.start);
  return lines.join('\n');
}

/** @param {string} title @param {string} body @param {string} date YYYY-MM-DD */
export function logEntryText(title, body, date) {
  return `\n## ${date} ${title}\n${body ? `\n${body}\n` : ''}`;
}
