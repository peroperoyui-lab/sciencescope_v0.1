// Bytes remain canonical. Parsing is a replaceable, on-demand projection;
// a parse failure leaves the original available to its default application.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from '../../core/ids.js';
import { AppError } from '../../core/errors.js';
import { parseDocument } from '../research/parsers/index.js';
import { openPath, recyclePath } from '../system.js';
import { compareText } from './comparison.js';
import { createVersionStorage } from './storage.js';
import { createVersionGraph } from './graph.js';
import { createVersionDiffs } from './diffs.js';

/**
 * @param {import('../../core/index.js').Core} core
 * @param {{open?:typeof openPath,recycle?:typeof recyclePath,diffs?:Parameters<typeof createVersionDiffs>[1]}} [options]
 */
export function createVersions(
  core,
  { open = openPath, recycle = recyclePath, diffs: diffOptions } = {},
) {
  const catalog = core.versionCatalog;
  // A tier rename spans projects; all version mutations share its queue so
  // imports and metadata edits cannot race the settings-save compensation.
  let pending = Promise.resolve();
  function serial(work) {
    const next = pending.then(work, work);
    pending = next.catch(() => {});
    return next;
  }
  const diffs = createVersionDiffs(core, diffOptions);
  const storage = createVersionStorage(core, serial, diffs.enqueue);
  const graph = createVersionGraph(core, serial);
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
    return serial(async () => {
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
  async function openNotes(id) {
    await open(`${catalog.file(id)}.notes.md`);
    return { opened: true };
  }
  async function editNotes(id, text, expectedRevisionId) {
    const version = catalog.get(id);
    const key = `${version.projectId}/${id}`;
    const result = await core.workspace.edit(
      { resource: 'versions', key, op: 'write', args: { text }, expectedRevisionId },
      { actorId: 'person_user' },
    );
    await core.workspace.captureSnapshot({ resource: 'versions', key }, { actorId: 'person_user' });
    return result;
  }
  async function compare(id, baselineId = catalog.get(id).parentId) {
    // Callers may explicitly supply the saved comparison selection. Without
    // one, the version graph's parent is the comparison baseline.
    const current = await read(id, { limit: Infinity });
    const previous = baselineId ? await read(baselineId, { limit: Infinity }) : null;
    if (previous && previous.version.groupId !== current.version.groupId)
      throw new AppError('INVALID_BASELINE', '请选择同一版本组的版本进行比较。');
    const ready =
      current.parseStatus === 'ready' && (!previous || previous.parseStatus === 'ready');
    const text = (entry) => entry?.blocks.map((block) => block.text).join('\n\n') ?? '';
    const changes = ready ? compareText(text(previous), text(current)) : [];
    return {
      current,
      previous,
      changes,
      status: !ready
        ? 'originals-only'
        : changes.every((part) => part.type === 'unchanged')
          ? 'unchanged'
          : 'ready',
    };
  }
  async function saveAsNew(id, actor = {}) {
    const previous = catalog.get(id);
    const version = await storage.createVersion(
      {
        groupId: previous.groupId,
        parentId: id,
        path: catalog.file(id),
        name: previous.name,
        origin: 'save-as-new',
      },
      actor,
    );
    return { group: catalog.group(previous.groupId), versions: [version] };
  }
  return {
    list: catalog.list,
    get: catalog.get,
    file: catalog.file,
    ...storage,
    ...graph,
    renameGroup,
    remove,
    read,
    openOriginal,
    openNotes,
    editNotes,
    compare,
    diff: diffs.diff,
    diffIdle: diffs.idle,
    close: diffs.close,
    saveAsNew,
  };
}
