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

export { parseLog, logEntryText } from '../shared/journal.js';

/** @param {string} text @param {{ start: number, end: number }} entry */
export function removeLogEntry(text, entry) {
  const lines = text.split('\n');
  lines.splice(entry.start, entry.end - entry.start);
  return lines.join('\n');
}
