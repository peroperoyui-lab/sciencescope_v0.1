// All entry points use the same writer. A multi-file import stages its copies
// before one database commit, so a failed file never registers half a batch.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { newId, nowIso } from '../../core/ids.js';
import { safeFileName } from '../../core/paths.js';
import { AppError } from '../../core/errors.js';

/**
 * @typedef {{groupId:string,parentId?:string|null,bytes?:Uint8Array,path?:string,name?:string,
 * origin:string,title?:string,label?:string,tier?:string,sessionId?:string}} VersionInput
 */

/**
 * @param {import('../../core/index.js').Core} core
 * @param {(work:()=>Promise<any>)=>Promise<any>} serial
 */
export function createVersionStorage(core, serial) {
  const catalog = core.versionCatalog;

  function writer(group, isNew, actor) {
    const saved = [];
    function branchFor(parent) {
      if (!parent) return '';
      const rows = core.db
        .prepare('SELECT parent_id, branch FROM manuscript_versions WHERE group_id=?')
        .all(group.id);
      const hasChild =
        rows.some((row) => row.parent_id === parent.id) ||
        saved.some((entry) => entry.parentId === parent.id);
      if (!hasChild) return parent.branch;
      const used = new Set([
        ...rows.map((row) => row.branch),
        ...saved.map((entry) => entry.branch),
      ]);
      let number = 1;
      while (used.has(`分支 ${number}`)) number += 1;
      return `分支 ${number}`;
    }
    /**
     * @param {VersionInput} input
     */
    async function stageVersion(input) {
      const parent = input.parentId
        ? (saved.find((entry) => entry.id === input.parentId) ?? catalog.get(input.parentId))
        : null;
      if (parent && parent.groupId !== group.id)
        throw new AppError('INVALID_PARENT', 'The parent must belong to the same version group.');
      if (input.tier) {
        const settings = await core.workspace.read({ resource: 'settings', key: 'app' });
        if (!settings.value.desk.tiers.includes(input.tier))
          throw new AppError('INVALID_TIER', 'Choose a tier from the editing desk settings.');
      }
      const name =
        input.name ?? (input.path ? path.basename(input.path) : (parent?.name ?? group.name));
      const filename = safeFileName(name, name.length);
      if (!filename) throw new AppError('INVALID_NAME', '文件名称无效。');
      const bytes = input.bytes ?? (await readFile(input.path));
      const id = newId('version');
      const number = group.nextNumber + saved.length;
      const relative = path.posix.join('versions', group.id, `v${number}-${id}`, filename);
      const absolute = path.join(core.workspace.locate.projectDir(group.projectId), relative);
      const entry = {
        groupId: group.id,
        title: input.title,
        label: input.label,
        tier: input.tier,
        origin: input.origin,
        sessionId: input.sessionId,
        id,
        name,
        number,
        relative,
        absolute,
        parentId: parent?.id ?? null,
        branch: branchFor(parent),
        contentHash: createHash('sha256').update(bytes).digest('hex'),
      };
      await mkdir(path.dirname(absolute), { recursive: true });
      saved.push(entry);
      await writeFile(absolute, bytes, { flag: 'wx' });
      return entry;
    }
    function commit() {
      core.db.transaction(() => {
        const time = nowIso();
        if (isNew)
          core.db
            .prepare(
              `INSERT INTO version_groups (id,project_id,name,format,created_at,updated_at)
               VALUES (?,?,?,?,?,?)`,
            )
            .run(group.id, group.projectId, group.name, group.format, time, time);
        for (const entry of saved)
          core.db
            .prepare(
              `INSERT INTO manuscript_versions
               (id,group_id,number,original_name,original_path,baseline_id,parent_id,branch,
                title,label,tier,origin,content_hash,session_id,imported_by,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              entry.id,
              group.id,
              entry.number,
              entry.name,
              entry.relative,
              entry.parentId,
              entry.parentId,
              entry.branch,
              entry.title ?? '',
              entry.label ?? '',
              entry.tier ?? '',
              entry.origin,
              entry.contentHash,
              entry.sessionId ?? null,
              actor.actorId ?? null,
              time,
            );
        core.db
          .prepare('UPDATE version_groups SET next_number=?,updated_at=? WHERE id=?')
          .run(group.nextNumber + saved.length, time, group.id);
        // Existing imports and copy restoration still trigger secretary notes.
        const action = saved.every((entry) => entry.origin === 'desk') ? 'created' : 'imported';
        catalog.changed(group.projectId, action, group.id, actor.actorId);
      });
      return {
        group: catalog.group(group.id),
        versions: saved.map((entry) => catalog.get(entry.id)),
      };
    }
    async function discard() {
      // Only files staged by this writer are removed; registered originals stay.
      for (const entry of saved) await rm(entry.absolute, { force: true });
    }
    return { createVersion: stageVersion, commit, discard };
  }

  /**
   * @param {VersionInput} input
   * @param {import('../../core/workspace/workspace.js').Actor} [actor]
   */
  function createVersion(input, actor = {}) {
    return serial(async () => {
      const batch = writer(catalog.group(input.groupId), false, actor);
      try {
        await batch.createVersion(input);
        return batch.commit().versions[0];
      } catch (error) {
        await batch.discard();
        throw error;
      }
    });
  }

  /**
   * Preserve user-selected batch order and monotonically increasing numbers,
   * including gaps left by deleted versions.
   * @param {{projectId:string,groupId?:string,groupName?:string,files:{name:string,base64:string}[]}} input
   * @param {import('../../core/workspace/workspace.js').Actor} [actor]
   */
  function importFiles(input, actor = {}) {
    return serial(async () => {
      const { projectId, files } = input;
      core.projects.get(projectId);
      if (!files?.length) throw new AppError('FILES_REQUIRED', '请选择要导入的文件。');
      const previous = input.groupId ? catalog.group(input.groupId) : null;
      if (previous && previous.projectId !== projectId)
        throw new AppError('VERSION_GROUP_NOT_FOUND', '找不到这个版本组。', 404);
      const name = (input.groupName ?? files[0].name).trim();
      if (!name) throw new AppError('NAME_REQUIRED', '请填写版本组名称。');
      const extension = path.extname(files[0].name).slice(1).toLowerCase();
      const group = previous ?? {
        id: newId('vgroup'),
        projectId,
        name,
        nextNumber: 1,
        format:
          extension === 'markdown'
            ? 'md'
            : ['docx', 'tex', 'md', 'pdf'].includes(extension)
              ? extension
              : 'other',
      };
      const batch = writer(group, !previous, actor);
      try {
        let parentId = previous
          ? (catalog.list(projectId).find((entry) => entry.id === group.id)?.versions[0]?.id ??
            null)
          : null;
        for (const file of files) {
          const created = await batch.createVersion({
            groupId: group.id,
            parentId,
            name: file.name,
            bytes: Buffer.from(file.base64, 'base64'),
            origin: 'import',
          });
          parentId = created.id;
        }
        return batch.commit();
      } catch (error) {
        await batch.discard();
        throw error;
      }
    });
  }
  return { createVersion, importFiles };
}
