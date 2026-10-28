// Plans and the research log are plain Markdown files. These helpers read
// them into cards and produce the edited text; the workspace stores each
// change as a revision.

const TASK = /^(\s*)- \[( |x|X)\] (.*)$/;
const MORE = /^\s{2,}\S/;
const DUE = /^\s+due:\s*(\d{4}-\d{2}-\d{2})\s*$/;

/**
 * Plan items: one per Markdown task line (`- [ ] title`). Indented lines under
 * it are the plan's note, and an indented `due: 2026-10-24` is its deadline;
 * the task line itself stays as the secretary writes it.
 * @param {string} text
 * @returns {Array<{ line: number, end: number, done: boolean, text: string, note: string, due: string }>}
 */
export function parsePlans(text) {
  const lines = (text ?? '').split('\n');
  return lines.flatMap((line, index) => {
    const match = TASK.exec(line);
    if (!match) return [];
    let end = index + 1;
    while (end < lines.length && MORE.test(lines[end]) && !TASK.test(lines[end])) end += 1;
    const extra = lines.slice(index + 1, end);
    const due = extra.map((entry) => DUE.exec(entry)?.[1]).find(Boolean) ?? '';
    const note = extra
      .filter((entry) => !DUE.test(entry))
      .map((entry) => entry.trim())
      .join('\n');
    return [{ line: index, end, done: match[2] !== ' ', text: match[3], note, due }];
  });
}

/** @param {{ done: boolean, text: string, note?: string, due?: string }} item */
function planLines(item) {
  const note = (item.note ?? '')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => `  ${entry}`);
  return [
    `- [${item.done ? 'x' : ' '}] ${item.text}`,
    ...note,
    ...(item.due ? [`  due: ${item.due}`] : []),
  ];
}

/**
 * Text with one plan changed, or removed when `item` is null.
 * @param {string} text @param {{ line: number, end?: number }} plan
 * @param {{ done: boolean, text: string, note?: string, due?: string } | null} item
 */
export function replacePlan(text, plan, item) {
  const lines = text.split('\n');
  lines.splice(
    plan.line,
    (plan.end ?? plan.line + 1) - plan.line,
    ...(item ? planLines(item) : []),
  );
  return lines.join('\n');
}

/** @param {string} text @param {string | { text: string, note?: string, due?: string }} plan */
export function appendPlan(text, plan) {
  const base = text && !text.endsWith('\n') ? `${text}\n` : (text ?? '');
  const item = typeof plan === 'string' ? { text: plan } : plan;
  return `${base}${planLines({ done: false, ...item }).join('\n')}\n`;
}

export { parseLog, logEntryText } from '../shared/journal.js';

/** @param {string} text @param {{ start: number, end: number }} entry */
export function removeLogEntry(text, entry) {
  const lines = text.split('\n');
  lines.splice(entry.start, entry.end - entry.start);
  return lines.join('\n');
}
