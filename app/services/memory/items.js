import { AppError } from '../../core/errors.js';
import { newId } from '../../core/ids.js';

/**
 * @param {{core:import('../../core/index.js').Core,research:any,now:()=>string}} dependencies
 * @returns {any}
 */
export function createMemoryItems({ core, research, now }) {
  const { db } = core;
  const store = research.store;

  function requireMemory(id) {
    const item = store.getItem(id);
    if (item.type !== 'memory') throw new AppError('MEMORY_REQUIRED', '请选择记忆条目。');
    return item;
  }

  function record(before, after, actor, op) {
    const id = newId('memrev');
    db.prepare(
      `INSERT INTO memory_item_history (id, item_id, before_json, after_json, actor_id, turn_id, meeting_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      after.id,
      before == null ? null : JSON.stringify(before),
      JSON.stringify(after),
      actor.actorId,
      actor.turnId ?? null,
      actor.meetingId ?? after.origin.meetingId ?? null,
      now(),
    );
    core.events.record(
      'memory.changed',
      { itemId: after.id, historyId: id, op, status: after.status },
      {
        projectId: after.projectId,
        meetingId: actor.meetingId ?? after.origin.meetingId,
        actorId: actor.actorId,
      },
    );
    return { ...after, historyId: id };
  }

  function create(input, actor) {
    return db.transaction(() => record(null, store.createItem(input, actor), actor, 'create'));
  }

  /**
   * @param {string} id
   * @param {any} patch
   * @returns {any}
   */
  function update(id, patch) {
    const before = requireMemory(id);
    const {
      status,
      title,
      body,
      payload,
      subtype,
      visibility,
      scope,
      validFrom,
      expectedRevision,
    } = patch;
    // Confirmation may edit the text but never erase or downgrade its origin.
    const preserved = {
      ...before.payload,
      ...payload,
      originTrust: before.payload.originTrust,
      evidence: before.payload.evidence,
      sourceRefs: before.payload.sourceRefs,
    };
    const actor = { actorId: 'person_user', meetingId: before.origin.meetingId };
    return db.transaction(() =>
      record(
        before,
        store.updateItem(
          id,
          {
            ...(status !== undefined ? { status } : {}),
            ...(title !== undefined ? { title } : {}),
            ...(body !== undefined ? { body } : {}),
            ...(subtype !== undefined ? { subtype } : {}),
            ...(visibility !== undefined ? { visibility } : {}),
            ...(scope !== undefined ? { scope } : {}),
            ...(validFrom !== undefined ? { validFrom } : {}),
            payload: preserved,
            expectedRevision,
          },
          actor,
        ),
        actor,
        'update',
      ),
    );
  }

  /**
   * @param {string} projectId
   * @returns {{items:any[],count:number}}
   */
  function inbox(projectId) {
    if (projectId) core.projects.get(projectId);
    const items = store.listItems({
      projectId,
      includePersonal: false,
      type: 'memory',
      status: 'proposed',
    });
    return { items, count: items.length };
  }

  function revision(row) {
    const after = JSON.parse(String(row.after_json));
    return {
      id: String(row.id),
      resource: 'memory',
      key: String(row.item_id),
      itemId: String(row.item_id),
      op: row.before_json == null ? 'create' : 'update',
      actorId: String(row.actor_id),
      meetingId: row.meeting_id == null ? null : String(row.meeting_id),
      turnId: row.turn_id == null ? null : String(row.turn_id),
      createdAt: String(row.created_at),
      undoneBy: row.undone_by == null ? null : String(row.undone_by),
      before: row.before_json == null ? null : JSON.parse(String(row.before_json)),
      after,
    };
  }

  /**
   * @param {string} id
   * @returns {any[]}
   */
  function history(id) {
    requireMemory(id);
    return db
      .prepare('SELECT * FROM memory_item_history WHERE item_id = ? ORDER BY rowid DESC')
      .all(id)
      .map(revision);
  }

  /**
   * @param {string} projectId
   * @param {{limit?:number}} [options]
   * @returns {any[]}
   */
  function historyProject(projectId, { limit = 100 } = {}) {
    if (projectId) core.projects.get(projectId);
    return db
      .prepare(
        'SELECT h.* FROM memory_item_history h JOIN rb_items i ON i.id = h.item_id WHERE i.project_id IS ? ORDER BY h.rowid DESC LIMIT ?',
      )
      .all(projectId, limit)
      .map(revision);
  }

  /**
   * @param {string} id
   * @returns {any}
   */
  function undo(id) {
    const row = db.prepare('SELECT * FROM memory_item_history WHERE id = ?').get(id);
    if (!row) throw new AppError('REVISION_NOT_FOUND', '找不到这条记忆修改。', 404);
    if (row.undone_by != null) throw new AppError('ALREADY_UNDONE', '这条修改已撤销。', 409);
    const current = requireMemory(String(row.item_id));
    const after = JSON.parse(String(row.after_json));
    if (
      current.title !== after.title ||
      current.body !== after.body ||
      current.status !== after.status ||
      current.subtype !== after.subtype ||
      current.visibility !== after.visibility ||
      current.scope !== after.scope ||
      current.validFrom !== after.validFrom ||
      JSON.stringify(current.payload) !== JSON.stringify(after.payload)
    )
      throw new AppError('REVISION_CONFLICT', '记忆之后还有修改，请先撤销较新的修改。', 409);
    const before =
      row.before_json == null
        ? { ...current, status: 'rejected' }
        : JSON.parse(String(row.before_json));
    const actor = { actorId: 'person_user', meetingId: current.origin.meetingId };
    return db.transaction(() => {
      const restored = record(
        current,
        store.updateItem(
          current.id,
          {
            title: before.title,
            body: before.body,
            status: before.status,
            subtype: before.subtype,
            visibility: before.visibility,
            scope: before.scope,
            validFrom: before.validFrom,
            payload: before.payload,
            expectedRevision: current.revision,
          },
          actor,
        ),
        actor,
        'undo',
      );
      db.prepare('UPDATE memory_item_history SET undone_by = ? WHERE id = ?').run(
        restored.historyId,
        id,
      );
      return restored;
    });
  }

  function decideBatch({ ids, status }) {
    return db.transaction(() => ids.map((id) => update(id, { status })));
  }

  return { create, update, inbox, history, historyProject, undo, decideBatch };
}
