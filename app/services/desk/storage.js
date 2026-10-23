import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { renameWithRetry } from '../../core/rename.js';
import { AppError } from '../../core/errors.js';
import { newId, nowIso } from '../../core/ids.js';

/**
 * @param {Uint8Array} bytes
 */
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * @param {string} file
 * @param {Uint8Array} bytes
 */
export async function writeAtomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await renameWithRetry(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * @param {string} file
 * @returns {Promise<Buffer>}
 */
export async function readProject(file) {
  try {
    return await readFile(file);
  } catch (error) {
    throw new AppError(
      'DESK_SOURCE_UNAVAILABLE',
      error.code === 'ENOENT'
        ? '项目文件已被删除或移动，工作副本仍保留。'
        : '无法读取项目文件，请检查文件是否被占用。',
      409,
    );
  }
}

function session(row) {
  if (!row) throw new AppError('DESK_SESSION_NOT_FOUND', '找不到这个编辑会话。', 404);
  return {
    id: row.id,
    groupId: row.group_id,
    baseVersionId: row.base_version_id,
    meetingId: row.meeting_id,
    status: row.status,
    seq: row.seq,
    savedSeq: row.saved_seq,
    resultVersionId: row.result_version_id,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

function change(row) {
  if (!row) throw new AppError('DESK_CHANGE_NOT_FOUND', '找不到这条修改记录。', 404);
  return {
    id: row.id,
    sessionId: row.session_id,
    versionId: row.version_id,
    seq: row.seq,
    blockId: row.block_id,
    op: row.op,
    before: JSON.parse(row.before_json),
    after: JSON.parse(row.after_json),
    annotations: JSON.parse(row.annotations_json ?? '[]'),
    actorId: row.actor_id,
    meetingId: row.meeting_id,
    turnId: row.turn_id,
    instruction: row.instruction,
    settled: Boolean(row.settled),
    undoneBy: row.undone_by,
    createdAt: row.created_at,
  };
}

/**
 * @param {import('../../core/index.js').Core} core
 * @param {any} [annotations]
 */
export function createDeskStore(core, annotations) {
  const { db } = core;
  const get = (id) => session(db.prepare('SELECT * FROM desk_sessions WHERE id=?').get(id));
  const changes = (id) =>
    db
      .prepare('SELECT * FROM desk_changes WHERE session_id=? ORDER BY seq,rowid')
      .all(id)
      .map(change);
  function create(groupId, versionId, meetingId) {
    const id = newId('desk');
    db.transaction(() => {
      db.prepare(
        'INSERT INTO desk_sessions (id,group_id,base_version_id,meeting_id,created_at) VALUES (?,?,?,?,?)',
      ).run(id, groupId, versionId, meetingId ?? null, nowIso());
      core.events.record('desk.session', { sessionId: id, state: 'open' });
    });
    return get(id);
  }
  function commit(state, proposal, actor, undoId = null) {
    if (!proposal.records.length) return { seq: state.session.seq, inserted: proposal.inserted };
    annotations?.prepare(
      state,
      proposal,
      undoId ? change(db.prepare('SELECT * FROM desk_changes WHERE id=?').get(undoId)) : null,
    );
    const seq = state.session.seq + 1;
    const ids = proposal.records.map(() => newId('chg'));
    const deltas = proposal.records.flatMap((record) => record.annotations ?? []);
    const removedAnnotations = deltas.filter((delta) => delta.before && !delta.after).length;
    db.transaction(() => {
      for (const [index, record] of proposal.records.entries())
        db.prepare(
          `INSERT INTO desk_changes (id,session_id,seq,block_id,op,before_json,after_json,
          actor_id,meeting_id,turn_id,instruction,created_at,annotations_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          ids[index],
          state.session.id,
          seq,
          record.blockId,
          record.op,
          JSON.stringify(record.before),
          JSON.stringify(record.after),
          actor.actorId ?? 'person_user',
          actor.meetingId ?? state.session.meetingId,
          actor.turnId ?? null,
          actor.instruction ?? '',
          nowIso(),
          JSON.stringify(record.annotations ?? []),
        );
      annotations?.applyDatabase(proposal.records);
      if (undoId) db.prepare('UPDATE desk_changes SET undone_by=? WHERE id=?').run(ids[0], undoId);
      db.prepare('UPDATE desk_sessions SET seq=? WHERE id=?').run(seq, state.session.id);
      // Catalog-only annotation edits are already durable and do not dirty the
      // project file. Word comments remain ordinary unsaved document changes.
      if (
        state.session.seq === state.session.savedSeq &&
        proposal.records.every((record) => ['annotation', 'annotation-lost'].includes(record.op))
      )
        db.prepare('UPDATE desk_sessions SET saved_seq=? WHERE id=?').run(seq, state.session.id);
      core.events.record(
        'desk.changed',
        {
          sessionId: state.session.id,
          seq,
          blockIds: proposal.records.map((record) => record.blockId),
          changeIds: ids,
          removedAnnotations,
        },
        actor,
      );
      if (deltas.length)
        core.events.record(
          'desk.annotations.changed',
          {
            sessionId: state.session.id,
            ids: [...new Set(deltas.map((delta) => (delta.after ?? delta.before).id))],
          },
          actor,
        );
    });
    state.blocks = proposal.blocks;
    annotations?.accept(state, proposal.records);
    state.session = get(state.session.id);
    return { seq, inserted: proposal.inserted, removedAnnotations };
  }
  return {
    get,
    create,
    changes,
    commit,
    change: (id) => change(db.prepare('SELECT * FROM desk_changes WHERE id=?').get(id)),
    open: (groupId) => {
      const row = db
        .prepare("SELECT * FROM desk_sessions WHERE group_id=? AND status='open'")
        .get(groupId);
      return row ? session(row) : null;
    },
  };
}
