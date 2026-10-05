// Exports (状态栏 → 导出): a meeting as Markdown, and a project snapshot as a
// zip with the project's own folder and every meeting record.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { safeFileName } from '../core/paths.js';

/**
 * A meeting record as readable Markdown.
 * @param {import('../core/index.js').Core} core @param {string} meetingId
 */
export async function meetingMarkdown(core, meetingId) {
  const meeting = core.meetings.get(meetingId);
  const names = new Map(core.participants.list().map((p) => [p.id, p.name]));
  const lines = [`# ${meeting.title}`, ''];
  let page = core.messages.list(meetingId, { after: 0, limit: 500 });
  for (;;) {
    for (const message of page.messages) {
      lines.push(
        `## ${names.get(message.authorId) ?? message.authorId} · ${message.createdAt}`,
        '',
      );
      lines.push(message.text, '');
    }
    if (!page.hasAfter) break;
    page = core.messages.list(meetingId, { after: page.messages.at(-1).seq, limit: 500 });
  }
  return lines.join('\n');
}

async function addFolder(zip, folder, prefix) {
  let entries = [];
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const entry of entries) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await addFolder(zip, file, `${prefix}${entry.name}/`);
    else zip.file(`${prefix}${entry.name}`, await readFile(file));
  }
}

/**
 * @param {import('../core/index.js').Core} core
 * @param {string} projectId
 */
export async function exportProject(core, projectId) {
  const project = core.projects.get(projectId);
  const zip = new JSZip();
  await addFolder(zip, path.join(core.paths.projects, project.dirName), 'project/');
  for (const meeting of core.meetings.list({ projectId, includeArchived: true })) {
    const name = `${safeFileName(meeting.title) || 'meeting'}-${meeting.id}.md`;
    zip.file(`meetings/${name}`, await meetingMarkdown(core, meeting.id));
  }
  return {
    name: `${safeFileName(project.name) || 'project'}.zip`,
    zip: await zip.generateAsync({ type: 'nodebuffer' }),
  };
}
