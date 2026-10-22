import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { nowIso } from '../../core/ids.js';
import { conflict, inverse, propose, publicBlock } from './model.js';
import { createDeskStore, hash, readProject, writeAtomic } from './storage.js';
import { createDeskSessions } from './sessions.js';

const messages = {
  INVALID_TIER: '请选择编辑台设置中的版本层级。',
  INVALID_PARENT: '父版本必须属于同一个版本组。',
  DOCX_SECTION_BREAK: '包含分节符的段落不能删除。',
  DOCX_LAST_CELL_PARAGRAPH: '表格单元格必须保留至少一个段落。',
  DOCX_DUPLICATE_ATOM: '公式、图片或域不能在正文中重复使用。',
  DOCX_OPAQUE_BLOCK: '跨段落的域只能整体保留，不能单独修改。',
  DOCX_MARKER_TARGET: '请保留相邻段落，以保存书签和批注位置。',
  DOCX_BLOCK_NOT_FOUND: '这段正文已不存在，请重新载入。',
};

/**
 * One queue covers session state, journal commits and delayed file writes.
 * Each accepted batch is validated before the database or projection changes.
 * @param {import('../../core/index.js').Core} core
 * @param {{versions:ReturnType<typeof import('../versions/index.js').createVersions>,
 * projectFiles:ReturnType<typeof import('../project-files.js').createProjectFiles>,
 * idleMs?:number,schedule?:(callback:()=>any,ms:number)=>any,cancel?:(timer:any)=>void,
 * writeWorking?:typeof writeAtomic}} options
 */
export function createDesk(
  core,
  {
    versions,
    projectFiles,
    idleMs = 2000,
    schedule = setTimeout,
    cancel = clearTimeout,
    writeWorking = writeAtomic,
  },
) {
  /** @type {Promise<unknown>} */
  let pending = Promise.resolve();
  /**
   * @template T
   * @param {()=>Promise<T>} work
   * @returns {Promise<T>}
   */
  function serial(work) {
    const task = pending.then(work).catch((error) => {
      if (messages[error.code])
        throw Object.assign(new AppError(error.code, messages[error.code], error.status), {
          details: error.details,
        });
      if (error instanceof AppError) throw error;
      throw new AppError(
        'DESK_DOCUMENT_ERROR',
        '无法处理这份文稿，请确认它是有效的 DOCX 文件且没有被占用。',
      );
    });
    pending = task.catch(() => {});
    return task;
  }
  const store = createDeskStore(core);
  const sessions = createDeskSessions(core, {
    versions,
    projectFiles,
    store,
    serial,
    idleMs,
    schedule,
    cancel,
    writeWorking,
  });
  /**
   * @param {{projectId:string,path:string}} input
   */
  async function registerDocument(input) {
    const file = projectFiles.locate(input.projectId, input.path);
    if (path.extname(file).toLowerCase() !== '.docx')
      throw new AppError('DESK_FORMAT', '目前只能登记 DOCX 文稿。');
    const relative = path
      .relative(projectFiles.rootOf(input.projectId), file)
      .split(path.sep)
      .join('/');
    const row = core.db
      .prepare('SELECT id FROM version_groups WHERE project_id=? AND source_path=?')
      .get(input.projectId, relative);
    if (row) return core.versionCatalog.group(row.id);
    const bytes = await readProject(file);
    const imported = await versions.importFiles(
      {
        projectId: input.projectId,
        files: [{ name: path.basename(file), base64: bytes.toString('base64') }],
      },
      { actorId: 'person_user' },
    );
    core.db
      .prepare(
        'UPDATE version_groups SET source_path=?,source_hash=?,source_version_id=?,updated_at=? WHERE id=?',
      )
      .run(relative, hash(bytes), imported.versions[0].id, nowIso(), imported.group.id);
    return core.versionCatalog.group(imported.group.id);
  }
  /**
   * @param {string} id
   * @param {any} input
   * @param {any} actor
   */
  async function updateBlocks(id, input, actor) {
    const state = await sessions.load(store.get(id));
    if (!Number.isInteger(input.baseSeq) || input.baseSeq < 0 || input.baseSeq > state.session.seq)
      throw new AppError('DESK_SEQUENCE', '请提供当前编辑会话的有效序号。', 409);
    const touched = new Set([
      ...Object.keys(input.blocks ?? {}),
      ...(input.removed ?? []),
      ...(input.inserted ?? []).flatMap((entry) => [entry.after, entry.like]).filter(Boolean),
    ]);
    const conflicting = [
      ...new Set(
        store
          .changes(id)
          .filter((record) => record.seq > input.baseSeq && touched.has(record.blockId))
          .map((record) => record.blockId),
      ),
    ];
    if (conflicting.length)
      throw conflict('DESK_CONFLICT', '这些段落已被修改，请以当前内容重新编辑。', {
        seq: state.session.seq,
        blockIds: conflicting,
        blocks: conflicting.map((blockId) => {
          const block = state.blocks.find((entry) => entry.id === blockId);
          return block ? publicBlock(block) : { id: blockId, removed: true };
        }),
      });
    const proposal = propose(state, input);
    const result = store.commit(state, proposal, actor);
    if (proposal.records.length) sessions.requestFlush(state);
    return result;
  }
  async function undoChange(id, actor) {
    const record = store.change(id);
    const state = await sessions.load(store.get(record.sessionId));
    const proposal = inverse(state, record);
    const result = store.commit(state, proposal, actor, id);
    sessions.requestFlush(state);
    return result;
  }
  async function settleChanges(id, ids) {
    const state = await sessions.load(store.get(id));
    const records = store.changes(id);
    const selected = ids ?? records.map((record) => record.id);
    if (selected.some((changeId) => !records.some((record) => record.id === changeId)))
      throw new AppError('DESK_CHANGE_NOT_FOUND', '请选择本会话里的修改记录。', 404);
    core.db.transaction(() => {
      for (const changeId of selected)
        core.db.prepare('UPDATE desk_changes SET settled=1 WHERE id=?').run(changeId);
      core.events.record('desk.changed', {
        sessionId: id,
        seq: state.session.seq,
        blockIds: [],
        changeIds: selected,
      });
    });
    return sessions.response(state);
  }
  return {
    /**
     * @param {{projectId:string,path:string}} input
     */
    registerDocument: (input) => serial(() => registerDocument(input)),
    /**
     * @param {{groupId:string,versionId?:string,meetingId?:string}} input
     */
    openSession: (input) => serial(() => sessions.open(input)),
    /**
     * @param {string} id
     */
    getSession: (id) => serial(async () => sessions.response(await sessions.load(store.get(id)))),
    /**
     * @param {string} id
     * @param {any} input
     * @param {any} [actor]
     */
    updateBlocks: (id, input, actor = {}) => serial(() => updateBlocks(id, input, actor)),
    /**
     * @param {string} id
     * @param {any} [actor]
     */
    undoChange: (id, actor = {}) => serial(() => undoChange(id, actor)),
    /**
     * @param {string} id
     * @param {string[]} [ids]
     */
    settleChanges: (id, ids) => serial(() => settleChanges(id, ids)),
    /**
     * @param {string} id
     * @param {{to:string,confirm?:boolean,label?:string,tier?:string}} input
     * @param {any} [actor]
     */
    save: (id, input, actor = {}) =>
      serial(async () => sessions.save(await sessions.load(store.get(id)), input, actor)),
    /**
     * @param {string} id
     * @param {any} [actor]
     */
    closeSession: (id, actor = {}) =>
      serial(async () => sessions.close(await sessions.load(store.get(id)), actor)),
    /** Flush acknowledged changes, leaving open sessions recoverable. */
    shutdown: () => serial(() => sessions.shutdown()),
  };
}
