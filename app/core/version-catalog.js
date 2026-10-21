// Original paths are relative to the owned project directory, so a project
// rename never changes version identities or binds them to an external folder.
import path from 'node:path';
import { AppError } from './errors.js';

/**
 * @param {{db:import('./db/database.js').Db,
 * events:ReturnType<typeof import('./events.js').createEvents>,
 * projects:ReturnType<typeof import('./projects.js').createProjects>,
 * workspace:ReturnType<typeof import('./workspace/workspace.js').createWorkspace>}} core
 */
export function createVersionCatalog(core) {
  const { db, events } = core;
  function group(id) {
    const row = db.prepare('SELECT * FROM version_groups WHERE id = ?').get(id);
    if (!row) throw new AppError('VERSION_GROUP_NOT_FOUND', '找不到这个版本组。', 404);
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      name: String(row.name),
      sourcePath: row.source_path == null ? null : String(row.source_path),
      format: String(row.format),
      nextNumber: Number(row.next_number),
      autoOrganize: Boolean(row.auto_organize),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
  function get(id) {
    const row = db
      .prepare('SELECT * FROM manuscript_versions WHERE id = ? AND deleted_at IS NULL')
      .get(id);
    if (!row) throw new AppError('VERSION_NOT_FOUND', '找不到这个文献版本。', 404);
    const parent = group(row.group_id);
    return {
      id: String(row.id),
      groupId: parent.id,
      projectId: parent.projectId,
      number: Number(row.number),
      name: String(row.original_name),
      originalPath: String(row.original_path),
      baselineId: row.baseline_id == null ? null : String(row.baseline_id),
      parentId: row.parent_id == null ? null : String(row.parent_id),
      branch: String(row.branch),
      tier: String(row.tier),
      label: String(row.label),
      title: String(row.title),
      origin: String(row.origin),
      contentHash: row.content_hash == null ? null : String(row.content_hash),
      sessionId: row.session_id == null ? null : String(row.session_id),
      notesStatus: String(row.notes_status),
      notesError: String(row.notes_error),
      generatedAt: row.generated_at == null ? null : String(row.generated_at),
      references:
        row.notes_references_json == null ? [] : JSON.parse(String(row.notes_references_json)),
      importedBy: row.imported_by == null ? null : String(row.imported_by),
      createdAt: String(row.created_at),
    };
  }
  function list(projectId) {
    core.projects.get(projectId);
    return db
      .prepare('SELECT id FROM version_groups WHERE project_id = ? ORDER BY created_at, rowid')
      .all(projectId)
      .map((row) => ({
        ...group(row.id),
        versions: db
          .prepare(
            'SELECT id FROM manuscript_versions WHERE group_id = ? AND deleted_at IS NULL ORDER BY number DESC',
          )
          .all(row.id)
          .map((entry) => get(entry.id)),
      }));
  }
  function file(id) {
    const version = get(id);
    return path.join(core.workspace.locate.projectDir(version.projectId), version.originalPath);
  }
  function changed(projectId, action, id, actorId) {
    events.record('versions.changed', { projectId, action, id }, { projectId, actorId });
  }
  return { group, get, list, file, changed };
}
