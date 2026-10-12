import path from 'node:path';
import { AppError } from '../../errors.js';
import { TEXT_OPS, applyTextOp } from '../text-ops.js';

/**
 * Notes are an ordinary Markdown resource: shared edits, external changes,
 * undo and boundary snapshots all use the existing workspace machinery.
 * @param {import('../../db/database.js').Db} db
 * @returns {import('../workspace.js').Resource}
 */
export function versionNotesResource(db) {
  return {
    name: 'versions',
    ops: TEXT_OPS,
    apply: applyTextOp,
    file(locate, key) {
      const [projectId, id] = key.split('/');
      const row = db
        .prepare(
          `SELECT v.original_path FROM manuscript_versions v JOIN version_groups g ON g.id = v.group_id WHERE v.id = ? AND g.project_id = ? AND v.deleted_at IS NULL`,
        )
        .get(id, projectId);
      if (!row) throw new AppError('VERSION_NOT_FOUND', '找不到这个文献版本。', 404);
      return path.join(locate.projectDir(projectId), `${row.original_path}.notes.md`);
    },
    async list(locate, projectId) {
      locate.projectDir(projectId);
      return db
        .prepare(
          `SELECT v.id FROM manuscript_versions v JOIN version_groups g ON g.id = v.group_id WHERE g.project_id = ? AND v.deleted_at IS NULL ORDER BY g.created_at, v.number`,
        )
        .all(projectId)
        .map((row) => `${projectId}/${row.id}`);
    },
  };
}
