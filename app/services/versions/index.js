// Bytes remain canonical. Parsing is a replaceable, on-demand projection;
// a parse failure leaves the original available to its default application.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { newId, nowIso } from '../../core/ids.js';
import { safeFileName } from '../../core/paths.js';
import { AppError } from '../../core/errors.js';
import { parseDocument } from '../research/parsers/index.js';
import { openPath, recyclePath } from '../system.js';

/**
 * @param {import('../../core/index.js').Core} core
 * @param {{open?:typeof openPath,recycle?:typeof recyclePath}} [options]
 */
export function createVersions(core, { open = openPath, recycle = recyclePath } = {}) {
  const catalog = core.versionCatalog;
  const queues = new Map();
  function serial(projectId, work) {
    const next = (queues.get(projectId) ?? Promise.resolve()).then(work, work);
    queues.set(
      projectId,
      next.catch(() => {}),
    );
    return next;
  }
  /**
   * Preserve user-selected batch order and monotonically increasing numbers,
   * including gaps left by deleted versions.
   * @param {{projectId:string,groupId?:string,groupName?:string,files:{name:string,base64:string}[]}} input
   * @param {import('../../core/workspace/workspace.js').Actor} [actor]
   */
  function importFiles(input, actor = {}) {
    return serial(input.projectId, async () => {
      const { projectId, files } = input;
      core.projects.get(projectId);
      if (!files?.length) throw new AppError('FILES_REQUIRED', '请选择要导入的文件。');
      const previous = input.groupId ? catalog.group(input.groupId) : null;
      if (previous && previous.projectId !== projectId)
        throw new AppError('VERSION_GROUP_NOT_FOUND', '找不到这个版本组。', 404);
      const groupId = previous?.id ?? newId('vgroup');
      const name = (input.groupName ?? files[0].name).trim();
      if (!name) throw new AppError('NAME_REQUIRED', '请填写版本组名称。');
      const directory = path.join(core.workspace.locate.projectDir(projectId), 'versions', groupId);
      await mkdir(directory, { recursive: true });
      const saved = [];
      try {
        let number = previous?.nextNumber ?? 1;
        let baselineId = previous
          ? (catalog.list(projectId).find((group) => group.id === groupId)?.versions[0]?.id ?? null)
          : null;
        for (const file of files) {
          const id = newId('version');
          const filename = safeFileName(file.name, file.name.length);
          if (!filename) throw new AppError('INVALID_NAME', '文件名称无效。');
          const relative = path.posix.join('versions', groupId, `v${number}-${id}`, filename);
          const absolute = path.join(core.workspace.locate.projectDir(projectId), relative);
          await mkdir(path.dirname(absolute), { recursive: true });
          await writeFile(absolute, Buffer.from(file.base64, 'base64'), { flag: 'wx' });
          saved.push({ id, number, name: file.name, relative, absolute, baselineId });
          baselineId = id;
          number += 1;
        }
        core.db.transaction(() => {
          const time = nowIso();
          if (!previous)
            core.db
              .prepare(
                'INSERT INTO version_groups (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
              )
              .run(groupId, projectId, name, time, time);
          for (const version of saved)
            core.db
              .prepare(
                `INSERT INTO manuscript_versions (id, group_id, number, original_name, original_path, baseline_id, imported_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                version.id,
                groupId,
                version.number,
                version.name,
                version.relative,
                version.baselineId,
                actor.actorId ?? null,
                time,
              );
          core.db
            .prepare('UPDATE version_groups SET next_number = ?, updated_at = ? WHERE id = ?')
            .run(number, time, groupId);
          catalog.changed(projectId, 'imported', groupId, actor.actorId);
        });
        return {
          group: catalog.group(groupId),
          versions: saved.map((entry) => catalog.get(entry.id)),
        };
      } catch (error) {
        // Remove only unregistered copies from this failed import.
        for (const entry of saved) await rm(entry.absolute, { force: true });
        throw error;
      }
    });
  }
  function renameGroup(id, name, actorId = 'person_user') {
    const group = catalog.group(id);
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('NAME_REQUIRED', '请填写版本组名称。');
    core.db.transaction(() => {
      core.db
        .prepare('UPDATE version_groups SET name = ?, updated_at = ? WHERE id = ?')
        .run(trimmed, nowIso(), id);
      catalog.changed(group.projectId, 'renamed', id, actorId);
    });
    return catalog.group(id);
  }
  async function remove(id, actorId = 'person_user') {
    const version = catalog.get(id);
    return serial(version.projectId, async () => {
      // One folder contains original plus notes: recycle both atomically as
      // a single selected directory, without a permanent-delete fallback.
      await recycle(path.dirname(catalog.file(id)));
      core.db.transaction(() => {
        core.db
          .prepare('UPDATE manuscript_versions SET deleted_at = ? WHERE id = ?')
          .run(nowIso(), id);
        catalog.changed(version.projectId, 'deleted', id, actorId);
      });
      return { deleted: id };
    });
  }
  /**
   * @param {string} id
   * @param {{offset?:number,limit?:number}} [options]
   */
  async function read(id, { offset = 0, limit = 20 } = {}) {
    const version = catalog.get(id);
    const notes = await core.workspace.read({
      resource: 'versions',
      key: `${version.projectId}/${id}`,
    });
    try {
      const parsed = await parseDocument(await readFile(catalog.file(id)), { name: version.name });
      const blocks = parsed.blocks.slice(offset, offset + limit);
      return {
        version,
        notes,
        parseStatus: 'ready',
        pages: parsed.pages ?? null,
        blocks,
        total: parsed.blocks.length,
        offset,
        remaining: Math.max(0, parsed.blocks.length - offset - blocks.length),
      };
    } catch (error) {
      return {
        version,
        notes,
        parseStatus: 'failed',
        error: error.message,
        blocks: [],
        total: 0,
        offset,
        remaining: 0,
      };
    }
  }
  async function openOriginal(id, reveal = false) {
    const file = catalog.file(id);
    await open(reveal ? path.dirname(file) : file);
    return { opened: true };
  }
  return {
    list: catalog.list,
    get: catalog.get,
    file: catalog.file,
    importFiles,
    renameGroup,
    remove,
    read,
    openOriginal,
  };
}
