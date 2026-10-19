import { AppError } from '../../core/errors.js';
import { newId, nowIso } from '../../core/ids.js';
import { createRecords, publicRow } from './records.js';

/**
 * A version groups reversible mutations, not file-backed workspace revisions.
 * Rowid orders history even when several edits share the same timestamp.
 * @param {import('../../core/index.js').Core} core
 * @returns {any}
 */
export function createKnowledgeVersions(core) {
  const { db, events } = core;
  const records = createRecords(db);
  const get = (id) => {
    const row = db.prepare('SELECT * FROM kb_versions WHERE id=?').get(id);
    if (!row)
      throw new AppError('KNOWLEDGE_VERSION_NOT_FOUND', 'Knowledge version does not exist.', 404);
    return publicRow(row);
  };
  function open(input) {
    if (input.turnId) {
      const existing = db.prepare('SELECT id FROM kb_versions WHERE turn_id=?').get(input.turnId);
      if (existing) return get(existing.id);
    }
    const id = newId('kbv');
    db.prepare(
      `INSERT INTO kb_versions(id,source,project_id,actor_id,meeting_id,turn_id,description,created_at)
      VALUES(?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.source,
      input.projectId ?? null,
      input.actorId ?? 'person_user',
      input.meetingId ?? null,
      input.turnId ?? null,
      input.description ?? '',
      nowIso(),
    );
    return get(id);
  }
  function page(table, where, values, options) {
    const offset = Math.max(0, Math.floor(options.offset ?? 0)),
      limit = Math.max(1, Math.floor(options.limit ?? 50));
    const total = Number(
      db.prepare(`SELECT count(*) AS n FROM ${table} ${where}`).get(...values).n,
    );
    const rows = db
      .prepare(`SELECT rowid,* FROM ${table} ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`)
      .all(...values, limit, offset)
      .map(publicRow);
    return { rows, total, offset, limit, remaining: Math.max(0, total - offset - rows.length) };
  }
  function history(ref, options = {}) {
    return page('kb_revisions', 'WHERE ref=?', [ref], options);
  }
  function changes(id) {
    get(id);
    return db
      .prepare('SELECT rowid, * FROM kb_revisions WHERE version_id=? ORDER BY rowid')
      .all(id)
      .map(publicRow);
  }
  function close(id) {
    return db.transaction(() => {
      const version = get(id);
      if (version.closedAt) return version;
      const rows = changes(id);
      if (!rows.length) {
        db.prepare('DELETE FROM kb_versions WHERE id=?').run(id);
        return null;
      }
      const summary = { created: 0, updated: 0, removed: 0 };
      for (const row of rows) {
        if (!row.before) summary.created++;
        else if (!row.after || row.after.status === 'removed') summary.removed++;
        else summary.updated++;
      }
      db.prepare('UPDATE kb_versions SET closed_at=?,summary_json=? WHERE id=?').run(
        nowIso(),
        JSON.stringify(summary),
        id,
      );
      return get(id);
    });
  }
  function closeTurn(turnId) {
    const row = db.prepare('SELECT id FROM kb_versions WHERE turn_id=?').get(turnId);
    return row ? close(row.id) : null;
  }
  function begin(actor) {
    if (actor.versionId) {
      const version = get(actor.versionId);
      if (version.closedAt)
        throw new AppError('KNOWLEDGE_VERSION_CLOSED', 'Knowledge edit session is closed.', 409);
      return { id: version.id, automatic: false };
    }
    const version = open({
      ...actor,
      source: actor.turnId ? 'ai-turn-end' : (actor.source ?? 'leave-page'),
    });
    if (version.closedAt)
      throw new AppError('KNOWLEDGE_VERSION_CLOSED', 'Knowledge turn has already ended.', 409);
    return { id: version.id, automatic: !actor.turnId };
  }
  function record(versionId, ref, op, before, after, actor) {
    const id = newId('kbr');
    db.prepare(
      `INSERT INTO kb_revisions(id,version_id,ref,op,before_json,after_json,actor_id,origin,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      versionId,
      ref,
      op,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      actor.actorId ?? 'person_user',
      actor.origin ?? (actor.turnId ? 'ai' : 'user'),
      nowIso(),
    );
    return id;
  }
  function changed(refs, actor) {
    const unique = [...new Set(refs)];
    if (!unique.length) return;
    events.record('knowledge.changed', { refs: unique }, actor);
    events.record('research.changed', { action: 'knowledge.changed', refs: unique }, actor);
  }
  function restoredState(ref, current, desired) {
    if (!/^(entity|edge):/.test(ref)) return desired;
    if (!current && !desired) return null;
    // Keep identity tombstones for later preserved edges and monotonically
    // increasing revisions for subsequent edits, including undo of a restore.
    return {
      ...(desired ?? { ...current, status: 'removed' }),
      revision: Number(current?.revision ?? desired.revision) + 1,
      updated_at: nowIso(),
    };
  }
  function invalidateDerived(refs) {
    // Derived links are rebuildable hints, not history. Restoring a node must
    // not leave cached relationships describing its abandoned state.
    const statement = db.prepare(
      "DELETE FROM kb_edges WHERE layer='derived' AND (from_ref=? OR to_ref=?)",
    );
    for (const ref of refs) statement.run(ref, ref);
  }
  function restore(id, actor = {}) {
    return db.transaction(() => {
      const target = get(id);
      if (!target.closedAt)
        throw new AppError(
          'KNOWLEDGE_VERSION_OPEN',
          'Close the edit session before restoring it.',
          409,
        );
      const rows = changes(id).reverse(),
        skipped = [],
        affected = [];
      const inverse = open({
        ...actor,
        source: 'before-restore',
        turnId: null,
        projectId: actor.projectId ?? target.projectId,
      });
      // Decide conflicts before adding inverse revisions; our own restore must not conflict with itself.
      const conflicts = new Set(
        rows
          .filter(
            (row) =>
              db
                .prepare(
                  'SELECT version_id FROM kb_revisions WHERE ref=? ORDER BY rowid DESC LIMIT 1',
                )
                .get(row.ref)?.version_id !== id,
          )
          .map((row) => row.ref),
      );
      for (const row of rows) {
        if (conflicts.has(row.ref)) {
          skipped.push(row.ref);
          continue;
        }
        const before = records.read(row.ref);
        const after = restoredState(row.ref, before, row.before);
        records.write(row.ref, after);
        record(inverse.id, row.ref, 'restore', before, after, actor);
        affected.push(row.ref);
      }
      const saved = close(inverse.id);
      if (saved) db.prepare('UPDATE kb_versions SET restored_by=? WHERE id=?').run(saved.id, id);
      invalidateDerived(affected);
      changed(affected, actor);
      return { version: saved, skipped: [...new Set(skipped)], refs: [...new Set(affected)] };
    });
  }
  function restoreRevision(id, actor = {}) {
    return db.transaction(() => {
      const revision = db.prepare('SELECT * FROM kb_revisions WHERE id=?').get(id);
      if (!revision)
        throw new AppError(
          'KNOWLEDGE_REVISION_NOT_FOUND',
          'Knowledge revision does not exist.',
          404,
        );
      const ref = String(revision.ref),
        before = records.read(ref),
        after = restoredState(
          ref,
          before,
          revision.after_json ? JSON.parse(String(revision.after_json)) : null,
        );
      const version = open({ ...actor, source: 'before-restore', turnId: null });
      records.write(ref, after);
      record(version.id, ref, 'restore', before, after, actor);
      invalidateDerived([ref]);
      changed([ref], actor);
      return { version: close(version.id), record: publicRow(after) };
    });
  }
  function list(options = {}) {
    const clauses = [],
      values = [];
    for (const [key, column] of [
      ['projectId', 'project_id'],
      ['meetingId', 'meeting_id'],
      ['turnId', 'turn_id'],
    ])
      if (options[key] !== undefined) {
        clauses.push(`${column} IS ?`);
        values.push(options[key]);
      }
    return page(
      'kb_versions',
      clauses.length ? 'WHERE ' + clauses.join(' AND ') : '',
      values,
      options,
    );
  }
  return {
    open,
    close,
    closeTurn,
    get,
    changes,
    history,
    list,
    begin,
    record,
    changed,
    restore,
    restoreRevision,
  };
}

/**
 * Services that save after a background response share the same durable turn boundary.
 * @param {import('../../core/index.js').Core} core
 * @param {string} turnId
 * @returns {any}
 */
export function closeKnowledgeTurn(core, turnId) {
  return createKnowledgeVersions(core).closeTurn(turnId);
}
