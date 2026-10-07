// Projects: a row plus a readable folder `projects/<name>-<id>/` for its files.
// The external research folder (`folder`) is only referenced, never written to.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';
import { projectDirName } from './paths.js';
import { renameWithRetry } from './rename.js';

/** @typedef {{ id: string, name: string, description: string, dirName: string,
 *   folder: string | null, pinned: boolean, archived: boolean,
 *   createdAt: string, updatedAt: string }} Project */

/** @returns {Project} */
function toProject(row) {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    dirName: String(row.dir_name),
    folder: row.folder == null ? null : String(row.folder),
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * @param {{ db: import('./db/database.js').Db, events: any,
 *   paths: ReturnType<typeof import('./paths.js').dataPaths>,
 *   now: () => string, newId: (prefix: string) => string }} deps
 */
export function createProjects({ db, events, paths, now, newId }) {
  /** @param {string} id @returns {Project} */
  function get(id) {
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!row) throw new AppError('PROJECT_NOT_FOUND', '找不到这个项目。', 404);
    return toProject(row);
  }

  /** @param {{ includeArchived?: boolean }} [options] @returns {Project[]} */
  function list({ includeArchived = false } = {}) {
    const where = includeArchived ? '' : 'WHERE archived = 0';
    return db
      .prepare(`SELECT * FROM projects ${where} ORDER BY pinned DESC, updated_at DESC`)
      .all()
      .map(toProject);
  }

  /**
   * @param {{ name: string, description?: string, folder?: string | null }} input
   * @param {import('./workspace/workspace.js').Actor} [actor]
   */
  async function create({ name, description = '', folder = null }, actor = {}) {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new AppError('NAME_REQUIRED', '请填写项目名称。');
    const id = newId('prj');
    const dirName = projectDirName(trimmed, id);
    await mkdir(path.join(paths.projects, dirName), { recursive: true });
    const time = now();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO projects (id, name, description, dir_name, folder, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, trimmed, description, dirName, folder, time, time);
      events.record('project.created', get(id), { projectId: id, actorId: actor.actorId });
    });
    return get(id);
  }

  /**
   * Change name, description, external folder, pinned or archived.
   * Renaming also renames the project's folder so it stays readable.
   * @param {string} id
   * @param {{ name?: string, description?: string, folder?: string | null,
   *   pinned?: boolean, archived?: boolean }} changes
   * @param {import('./workspace/workspace.js').Actor} [actor]
   */
  async function update(id, changes, actor = {}) {
    const project = get(id);
    let dirName = project.dirName;
    const name = changes.name == null ? project.name : String(changes.name).trim();
    if (!name) throw new AppError('NAME_REQUIRED', '请填写项目名称。');
    if (name !== project.name) {
      dirName = projectDirName(name, id);
      await renameWithRetry(
        path.join(paths.projects, project.dirName),
        path.join(paths.projects, dirName),
      );
    }
    db.transaction(() => {
      // Renaming the readable internal directory moves its files. Keep any
      // bound meeting paths pointing at those same files after the rename.
      if (dirName !== project.dirName) {
        const previousRoot = path.join(paths.projects, project.dirName);
        for (const row of db
          .prepare(
            'SELECT id, work_folder FROM meetings WHERE project_id = ? AND work_folder IS NOT NULL',
          )
          .all(id)) {
          const relative = path.relative(previousRoot, String(row.work_folder));
          if (
            relative === '' ||
            (!relative.startsWith('..' + path.sep) &&
              relative !== '..' &&
              !path.isAbsolute(relative))
          )
            db.prepare('UPDATE meetings SET work_folder = ? WHERE id = ?').run(
              path.join(paths.projects, dirName, relative),
              row.id,
            );
        }
      }
      // Older databases may have meetings whose working folder was derived
      // dynamically. Bind them before a location change so only new meetings
      // use the newly selected project folder.
      if (changes.folder !== undefined && changes.folder !== project.folder) {
        db.prepare(
          'UPDATE meetings SET work_folder = ? WHERE project_id = ? AND work_folder IS NULL',
        ).run(project.folder ?? path.join(paths.projects, dirName), id);
      }
      db.prepare(
        `UPDATE projects SET name = ?, description = ?, dir_name = ?, folder = ?, pinned = ?,
           archived = ?, updated_at = ? WHERE id = ?`,
      ).run(
        name,
        changes.description ?? project.description,
        dirName,
        changes.folder === undefined ? project.folder : changes.folder,
        Number(changes.pinned ?? project.pinned),
        Number(changes.archived ?? project.archived),
        now(),
        id,
      );
      events.record('project.updated', get(id), { projectId: id, actorId: actor.actorId });
    });
    return get(id);
  }

  return { get, list, create, update };
}
