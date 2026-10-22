import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ownFolders = new Set(['workbench', 'notes', 'minutes', 'versions', 'desk']);
const extensions = new Map([
  ['.docx', 'docx'],
  ['.tex', 'tex'],
  ['.md', 'md'],
  ['.markdown', 'md'],
  ['.pdf', 'pdf'],
]);

/**
 * Read-only listing: listing must not register files or schedule indexing.
 * @param {import('../../core/index.js').Core} core
 * @param {ReturnType<typeof import('../project-files.js').createProjectFiles>} projectFiles
 * @param {string} projectId
 * @param {number} [limit]
 */
export async function listDocuments(core, projectFiles, projectId, limit = 2000) {
  const project = core.projects.get(projectId);
  const root = projectFiles.rootOf(projectId);
  const groups = core.versionCatalog.list(projectId);
  const summary = (group) => {
    const version = group.versions[0];
    return {
      id: group.id,
      latest: version
        ? { id: version.id, number: version.number, branch: version.branch, tier: version.tier }
        : null,
      sourceVersionId: group.sourceVersionId,
    };
  };
  const registered = new Map(
    groups.filter((group) => group.sourcePath).map((group) => [group.sourcePath, summary(group)]),
  );
  const files = [];
  let truncated = false;
  async function walk(folder = '') {
    let entries;
    try {
      entries = await readdir(path.join(root, folder), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      const relative = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          (!project.folder && !folder && ownFolders.has(entry.name))
        )
          continue;
        await walk(relative);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        try {
          const info = await stat(path.join(root, relative));
          files.push({
            path: relative,
            name: entry.name,
            format: extensions.get(path.extname(entry.name).toLowerCase()),
            size: info.size,
            mtime: info.mtime.toISOString(),
            group: registered.get(relative) ?? null,
          });
        } catch {
          /* A folder refresh may race an external move; keep the other entries. */
        }
      }
      if (truncated) return;
    }
    if (files.length >= limit) truncated = true;
  }
  await walk();
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    files,
    groups: groups
      .filter((group) => !group.sourcePath)
      .map((group) => ({ ...summary(group), name: group.name, format: group.format })),
    truncated,
  };
}
