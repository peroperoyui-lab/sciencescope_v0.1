import { readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { nowIso } from '../../core/ids.js';
import { conflict } from './model.js';
import { readDocument, restoreDocument, writeDocument, documentResponse } from './formats.js';
import { hash, readProject, writeAtomic } from './storage.js';

/**
 * @param {import('../../core/index.js').Core} core
 * @param {any} dependencies
 */
export function createDeskSessions(
  core,
  { versions, projectFiles, store, annotations, serial, idleMs, schedule, cancel, writeWorking },
) {
  const states = new Map();
  const catalog = core.versionCatalog;
  const latest = (groupId) =>
    catalog.list(catalog.group(groupId).projectId).find((group) => group.id === groupId)
      .versions[0];
  function paths(session) {
    const group = catalog.group(session.groupId);
    const root = path.join(core.workspace.locate.projectDir(group.projectId), 'desk', session.id);
    return {
      root,
      file: path.join(root, path.basename(catalog.file(session.baseVersionId))),
      source: path.join(root, '.state', `source.${group.format}`),
      checkpoint: path.join(root, '.state', 'checkpoint.json'),
    };
  }
  async function remember(session, files, document, flushedSeq) {
    const records = store.changes(session.id);
    const state = {
      session,
      files,
      document,
      ...(await restoreDocument(document, records)),
      flushedSeq,
      timer: null,
    };
    annotations.hydrate(state, records);
    states.set(session.id, state);
    if (state.flushedSeq < session.seq) requestFlush(state);
    return state;
  }
  async function load(session) {
    if (session.status !== 'open')
      throw new AppError('DESK_SESSION_CLOSED', '这个编辑会话已关闭。', 409);
    if (states.has(session.id)) return states.get(session.id);
    const files = paths(session);
    // Read the working file as well as the immutable reference package. The
    // journal replays acknowledged changes, even if a crash preceded idle flush.
    const format = catalog.group(session.groupId).format;
    await readDocument(await readFile(files.file), format);
    const document = await readDocument(await readFile(files.source), format);
    const checkpoint = JSON.parse(await readFile(files.checkpoint, 'utf8'));
    return remember(session, files, document, checkpoint.seq);
  }
  async function initialize(session, document) {
    const files = paths(session);
    await mkdir(path.dirname(files.source), { recursive: true });
    await writeAtomic(files.source, document.bytes);
    await writeAtomic(files.file, document.bytes);
    await writeAtomic(files.checkpoint, Buffer.from(JSON.stringify({ seq: 0 })));
    return remember(session, files, document, 0);
  }
  function response(state) {
    return {
      session: store.get(state.session.id),
      ...documentResponse(state),
      changes: store
        .changes(state.session.id)
        .filter((record) => !record.undoneBy && !record.settled),
    };
  }
  async function flush(state) {
    // Project renames move its owned data directory, including an open desk.
    state.files = paths(state.session);
    if (state.timer != null) cancel(state.timer);
    state.timer = null;
    if (state.flushedSeq === state.session.seq) return;
    await writeWorking(state.files.file, await writeDocument(state));
    await writeAtomic(
      state.files.checkpoint,
      Buffer.from(JSON.stringify({ seq: state.session.seq })),
    );
    state.flushedSeq = state.session.seq;
  }
  function requestFlush(state) {
    if (state.timer != null) cancel(state.timer);
    state.timer = schedule(
      () =>
        serial(() => flush(state)).catch(() => {
          core.events.transient('desk.session', {
            sessionId: state.session.id,
            state: 'save-error',
            message: '工作副本尚未写入，请重试保存。',
          });
        }),
      idleMs,
    );
  }
  /** Record what the project file now holds and which version it descends from. */
  function synced(groupId, sourceHash, versionId) {
    core.db
      .prepare('UPDATE version_groups SET source_hash=?,source_version_id=? WHERE id=?')
      .run(sourceHash, versionId, groupId);
  }
  // Saving to the project file makes no version, so an external edit is a
  // change from what ScienceScope last saw or wrote, not from the latest version.
  async function external(group, actor = {}) {
    if (!group.sourcePath) return { version: latest(group.id), changed: false };
    const bytes = await readProject(projectFiles.locate(group.projectId, group.sourcePath));
    const current = group.sourceVersionId ? catalog.get(group.sourceVersionId) : latest(group.id);
    if (hash(bytes) === (group.sourceHash ?? current.contentHash))
      return { version: current, changed: false };
    const version = await versions.createVersion(
      {
        groupId: group.id,
        parentId: current.id,
        bytes,
        name: path.basename(group.sourcePath),
        origin: 'external',
      },
      actor,
    );
    synced(group.id, hash(bytes), version.id);
    return { version, changed: true };
  }
  async function saveVersion(state, options, actor) {
    await flush(state);
    const base = state.session.baseVersionId;
    const version = await versions.createVersion(
      {
        groupId: state.session.groupId,
        parentId: state.session.baseVersionId,
        path: state.files.file,
        origin: 'desk',
        sessionId: state.session.id,
        label: options.label,
        tier: options.tier,
      },
      actor,
    );
    core.db.transaction(() => {
      core.db
        .prepare('UPDATE desk_changes SET version_id=? WHERE session_id=? AND version_id IS NULL')
        .run(version.id, state.session.id);
      core.db
        .prepare('UPDATE desk_sessions SET base_version_id=? WHERE id=?')
        .run(version.id, state.session.id);
      for (const table of ['manuscript_bindings', 'manuscript_comments'])
        core.db
          .prepare(`UPDATE ${table} SET version_id=? WHERE group_id=? AND status='anchored'`)
          .run(version.id, state.session.groupId);
      // A project file written from this lineage now descends from the new version.
      core.db
        .prepare('UPDATE version_groups SET source_version_id=? WHERE id=? AND source_version_id=?')
        .run(version.id, state.session.groupId, base);
    });
    state.session = store.get(state.session.id);
    return version;
  }
  async function close(state, actor, discard = false) {
    await flush(state);
    let result = null;
    if (
      !discard &&
      hash(await readFile(state.files.file)) !==
        catalog.get(state.session.baseVersionId).contentHash
    )
      result = await saveVersion(state, {}, actor);
    core.db.transaction(() => {
      core.db
        .prepare(
          "UPDATE desk_sessions SET status='closed',closed_at=?,result_version_id=? WHERE id=?",
        )
        .run(nowIso(), result?.id ?? null, state.session.id);
      core.events.record('desk.session', { sessionId: state.session.id, state: 'closed' }, actor);
    });
    states.delete(state.session.id);
    await rm(state.files.root, { recursive: true, force: true });
    return { session: store.get(state.session.id), version: result };
  }
  /**
   * @param {{groupId:string,versionId?:string,meetingId?:string}} input
   */
  async function open({ groupId, versionId, meetingId }) {
    const group = catalog.group(groupId);
    if (!['docx', 'tex', 'md', 'pdf'].includes(group.format))
      throw new AppError('DESK_FORMAT', '请选择 DOCX、TeX、Markdown 或 PDF 文稿。');
    if (meetingId && core.meetings.get(meetingId).projectId !== group.projectId)
      throw new AppError('DESK_MEETING_PROJECT', '请选择这个项目里的对话。');
    const existing = store.open(groupId);
    const source = await external(group);
    if (existing) {
      const state = await load(existing);
      if (!source.changed) {
        if (meetingId && meetingId !== existing.meetingId) bind(existing.id, meetingId);
        return response(state);
      }
      if (existing.seq !== existing.savedSeq)
        throw conflict(
          'DESK_EXTERNAL_CHANGE',
          '项目文件已在外部修改，请重新打开外部版本，或将当前修改另存为版本。',
          { versionId: source.version.id },
        );
      await close(state, {}, true);
    }
    const version = source.changed ? source.version : catalog.get(versionId ?? source.version.id);
    if (version.groupId !== groupId)
      throw new AppError('INVALID_VERSION', '请选择这个版本组里的版本。');
    const bytes = await readFile(catalog.file(version.id));
    const document = await readDocument(bytes, group.format);
    const session = store.create(groupId, version.id, meetingId ?? existing?.meetingId);
    try {
      const state = await initialize(session, document);
      const proposal = await annotations.reanchor(state);
      if (proposal.records.length) {
        store.commit(state, proposal, { actorId: 'person_user' });
        requestFlush(state);
      }
      return response(state);
    } catch (error) {
      core.db.prepare('DELETE FROM desk_sessions WHERE id=?').run(session.id);
      await rm(paths(session).root, { recursive: true, force: true });
      throw error;
    }
  }
  async function save(state, options, actor) {
    if (options.to === 'version')
      return { version: await saveVersion(state, options, actor), session: state.session };
    if (options.to !== 'project')
      throw new AppError('DESK_SAVE_TARGET', '请选择保存到项目文件或版本。');
    const group = catalog.group(state.session.groupId);
    if (!group.sourcePath)
      throw new AppError('DESK_SOURCE_REQUIRED', '这个版本组还没有关联项目文件。');
    const source = await external(group, actor);
    if (source.changed)
      throw conflict(
        'DESK_EXTERNAL_CHANGE',
        '项目文件已在外部修改，当前修改仍在工作副本中，请另存为版本或重新打开。',
        { versionId: source.version.id },
      );
    if (source.version.id !== state.session.baseVersionId && options.confirm !== true)
      throw conflict(
        'DESK_SAVE_CONFIRM',
        `项目文件当前对应 v${source.version.number}，确认后才会写回。`,
        { versionId: source.version.id, versionNumber: source.version.number },
      );
    await flush(state);
    // Recheck after ZIP generation: an external editor may have saved during it.
    const target = projectFiles.locate(group.projectId, group.sourcePath);
    if (hash(await readProject(target)) !== (group.sourceHash ?? source.version.contentHash)) {
      const changed = await external(group, actor);
      throw conflict('DESK_EXTERNAL_CHANGE', '项目文件在保存期间发生变化，工作副本仍保留。', {
        versionId: changed.version.id,
      });
    }
    const bytes = await readFile(state.files.file);
    try {
      await writeAtomic(target, bytes);
    } catch {
      throw new AppError(
        'DESK_SAVE_FAILED',
        '无法写回项目文件，请关闭占用它的程序后重试；工作副本仍保留。',
        409,
      );
    }
    core.db.transaction(() => {
      core.db.prepare('UPDATE desk_sessions SET saved_seq=seq WHERE id=?').run(state.session.id);
      synced(group.id, hash(bytes), state.session.baseVersionId);
    });
    state.session = store.get(state.session.id);
    return { session: state.session };
  }
  function bind(id, meetingId) {
    core.db.prepare('UPDATE desk_sessions SET meeting_id=? WHERE id=?').run(meetingId, id);
    core.db.afterCommit(() => {
      if (states.has(id)) states.get(id).session = store.get(id);
    });
  }
  return {
    bind,
    load,
    response,
    requestFlush,
    open,
    save,
    close,
    flush,
    async shutdown() {
      for (const row of core.db.prepare("SELECT * FROM desk_sessions WHERE status='open'").all())
        await flush(await load(store.get(row.id)));
    },
  };
}
