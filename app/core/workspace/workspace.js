// The workspace: user-readable files plus a revision for every change.
// Agents, the UI and external editors all go through `read` / `edit` / `undo`.
// A file changed outside ScienceScope is noticed on the next read or edit and
// recorded as an `external` revision, so undo history stays truthful.
import path from 'node:path';
import { createSnapshots } from './snapshots.js';
import { AppError } from '../errors.js';
import { hashText, readText, removeFile, writeTextAtomic } from './files.js';

/**
 * @typedef {{ paths: ReturnType<typeof import('../paths.js').dataPaths>,
 *   projectDir: (projectId: string) => string,
 *   meetingBase: (meetingId: string) => string }} Locate
 * @typedef {{ name: string, ops: string[], file: (locate: Locate, key: string) => string,
 *   apply: (text: string | null, op: string, args: any) => string | null,
 *   parse?: (text: string | null) => any,
 *   list?: (locate: Locate, scope: string) => Promise<string[]> }} Resource
 * @typedef {{ actorId?: string | null, meetingId?: string | null, turnId?: string | null }} Actor
 */

function toRevision(row, { withText = false } = {}) {
  const revision = {
    id: String(row.id),
    resource: String(row.resource),
    key: String(row.resource_key).slice(String(row.resource).length + 1),
    op: String(row.op),
    actorId: row.actor_id == null ? null : String(row.actor_id),
    meetingId: row.meeting_id == null ? null : String(row.meeting_id),
    turnId: row.turn_id == null ? null : String(row.turn_id),
    undoneBy: row.undone_by == null ? null : String(row.undone_by),
    createdAt: String(row.created_at),
  };
  if (!withText) return revision;
  return {
    ...revision,
    before: row.before_text == null ? null : String(row.before_text),
    after: row.after_text == null ? null : String(row.after_text),
  };
}

/**
 * @param {{ db: import('../db/database.js').Db, events: ReturnType<typeof import('../events.js').createEvents>,
 *   paths: ReturnType<typeof import('../paths.js').dataPaths>, now: () => string,
 *   newId: (prefix: string) => string, resources: Resource[] }} deps
 */
export function createWorkspace({ db, events, paths, now, newId, resources }) {
  const registry = new Map(resources.map((resource) => [resource.name, resource]));
  /** @type {Map<string, Promise<unknown>>} */
  const queues = new Map();

  /** @type {Locate} */
  const locate = {
    paths,
    projectDir(projectId) {
      const row = db.prepare('SELECT dir_name FROM projects WHERE id = ?').get(projectId);
      if (!row) throw new AppError('PROJECT_NOT_FOUND', '找不到这个项目。', 404);
      return path.join(paths.projects, String(row.dir_name));
    },
    meetingBase(meetingId) {
      const row = db.prepare('SELECT project_id FROM meetings WHERE id = ?').get(meetingId);
      if (!row) throw new AppError('MEETING_NOT_FOUND', '找不到这个会议。', 404);
      return row.project_id == null ? paths.root : locate.projectDir(String(row.project_id));
    },
  };

  function resourceOf(name) {
    const resource = registry.get(name);
    if (!resource) throw new AppError('UNKNOWN_RESOURCE', `没有这种资源：${name}`, 404);
    return resource;
  }

  function projectIdOf(resource, key) {
    if (resource === 'agent' || resource === 'settings') return null;
    if (resource === 'minutes') {
      const row = db.prepare('SELECT project_id FROM meetings WHERE id = ?').get(key);
      return row?.project_id == null ? null : String(row.project_id);
    }
    if (resource === 'plans' && key === 'global') return null;
    return key.split('/')[0];
  }

  /**
   * Serialize work per file so two edits never interleave.
   * @template T
   * @param {string} resourceKey
   * @param {() => Promise<T>} work
   * @returns {Promise<T>}
   */
  function queued(resourceKey, work) {
    const previous = queues.get(resourceKey) ?? Promise.resolve();
    const next = previous.then(work, work);
    queues.set(
      resourceKey,
      next.catch(() => {}),
    );
    return next;
  }

  function lastRevision(resourceKey) {
    return db
      .prepare(
        'SELECT * FROM revisions WHERE resource_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(resourceKey);
  }

  function insertRevision({ resource, key, op, before, after, actor }) {
    const id = newId('rev');
    db.prepare(
      `INSERT INTO revisions (id, resource, resource_key, op, before_text, after_text, after_hash,
         actor_id, meeting_id, turn_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      resource,
      `${resource}:${key}`,
      op,
      before,
      after,
      hashText(after),
      actor.actorId ?? null,
      actor.meetingId ?? null,
      actor.turnId ?? null,
      now(),
    );
    events.record(
      'resource.changed',
      { resource, key, revisionId: id, op },
      { projectId: projectIdOf(resource, key), meetingId: actor.meetingId, actorId: actor.actorId },
    );
    return id;
  }

  /** Record a change made outside ScienceScope, if any. Returns the current text. */
  async function currentText(resource, key, file) {
    const text = await readText(file);
    const last = lastRevision(`${resource}:${key}`);
    if (last && hashText(text) !== (last.after_hash == null ? null : String(last.after_hash))) {
      const before = last.after_text == null ? null : String(last.after_text);
      db.transaction(() =>
        insertRevision({ resource, key, op: 'external', before, after: text, actor: {} }),
      );
    }
    return text;
  }

  /**
   * @param {{ resource: string, key: string }} target
   * @returns {Promise<{ resource: string, key: string, exists: boolean, text: string | null, value: any, revisionId: string | null }> }
   */
  async function read({ resource, key }) {
    const handler = resourceOf(resource);
    const file = handler.file(locate, key);
    const { text, revisionId } = await queued(`${resource}:${key}`, async () => {
      const current = await currentText(resource, key, file);
      return { text: current, revisionId: lastRevision(`${resource}:${key}`)?.id ?? null };
    });
    const value = handler.parse ? handler.parse(text) : text;
    return { resource, key, exists: text != null, text, value, revisionId };
  }

  /**
   * Apply an operation, write the file and record a revision.
   * @param {{ resource: string, key: string, op: string, args?: any,
   *   expectedRevisionId?: string | null, forceRevision?: boolean }} change
   * @param {Actor} [actor]
   * @returns {Promise<{ revisionId: string | null, value: any }>}
   */
  async function edit(change, actor = {}) {
    const { resource, key, op, args = {} } = change;
    const handler = resourceOf(resource);
    if (!handler.ops.includes(op)) {
      throw new AppError('UNKNOWN_OP', `${resource} 不支持操作 ${op}。`);
    }
    const file = handler.file(locate, key);
    return queued(`${resource}:${key}`, async () => {
      const before = await currentText(resource, key, file);
      // Background summaries must not overwrite an edit made while the model ran.
      // Check inside the file queue, including externally recorded revisions.
      if (
        Object.hasOwn(change, 'expectedRevisionId') &&
        (lastRevision(`${resource}:${key}`)?.id ?? null) !== change.expectedRevisionId
      ) {
        throw new AppError('REVISION_CONFLICT', '内容已被更新，请刷新后再编辑。', 409);
      }
      const after = handler.apply(before, op, args);
      const value = handler.parse ? handler.parse(after) : after;
      if (after === before && !change.forceRevision) return { revisionId: null, value };
      if (after == null) await removeFile(file);
      else await writeTextAtomic(file, after);
      const revisionId = db.transaction(() =>
        insertRevision({ resource, key, op, before, after, actor }),
      );
      return { revisionId, value };
    });
  }

  /**
   * Undo a revision by writing back its `before` text. Refused when the
   * resource changed afterwards (undo the later change first).
   * @param {string} revisionId
   * @param {Actor} [actor]
   */
  async function undo(revisionId, actor = {}) {
    const row = db.prepare('SELECT * FROM revisions WHERE id = ?').get(revisionId);
    if (!row) throw new AppError('REVISION_NOT_FOUND', '找不到这条修改记录。', 404);
    if (row.undone_by != null) throw new AppError('ALREADY_UNDONE', '这条修改已经撤销过。', 409);
    const resource = String(row.resource);
    const key = toRevision(row).key;
    const file = resourceOf(resource).file(locate, key);
    return queued(`${resource}:${key}`, async () => {
      const current = await currentText(resource, key, file);
      if (hashText(current) !== (row.after_hash == null ? null : String(row.after_hash))) {
        throw new AppError('REVISION_CONFLICT', '之后还有新的修改，请先撤销更新的那一条。', 409);
      }
      const restored = row.before_text == null ? null : String(row.before_text);
      if (restored == null) await removeFile(file);
      else await writeTextAtomic(file, restored);
      return db.transaction(() => {
        const undoId = insertRevision({
          resource,
          key,
          op: 'undo',
          before: current,
          after: restored,
          actor,
        });
        db.prepare('UPDATE revisions SET undone_by = ? WHERE id = ?').run(undoId, revisionId);
        events.record(
          'revision.undone',
          { revisionId, undoRevisionId: undoId },
          { meetingId: actor.meetingId, actorId: actor.actorId },
        );
        return { revisionId: undoId };
      });
    });
  }

  /**
   * Revisions, newest first. Filter by resource and key, or by meeting.
   * @param {{ resource?: string, key?: string, meetingId?: string, limit?: number }} [filter]
   */
  function history({ resource, key, meetingId, limit = 100 } = {}) {
    const clauses = [];
    const params = [];
    if (resource && key) {
      clauses.push('resource_key = ?');
      params.push(`${resource}:${key}`);
    } else if (resource) {
      clauses.push('resource = ?');
      params.push(resource);
    }
    if (meetingId) {
      clauses.push('meeting_id = ?');
      params.push(meetingId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db
      .prepare(`SELECT * FROM revisions ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
      .all(...params, limit)
      .map((row) => toRevision(row));
  }

  /** @param {string} revisionId */
  function getRevision(revisionId) {
    const row = db.prepare('SELECT * FROM revisions WHERE id = ?').get(revisionId);
    if (!row) throw new AppError('REVISION_NOT_FOUND', '找不到这条修改记录。', 404);
    return toRevision(row, { withText: true });
  }

  /**
   * Keys of a resource within a scope (e.g. notes of a project).
   * @param {{ resource: string, scope: string }} query
   */
  async function list({ resource, scope }) {
    const handler = resourceOf(resource);
    return handler.list ? handler.list(locate, scope) : [];
  }

  const snapshots = createSnapshots({
    db,
    events,
    now,
    newId,
    locate,
    resourceOf,
    projectIdOf,
    queued,
    currentText,
    lastRevision,
    insertRevision,
  });

  return {
    ...snapshots,
    read,
    edit,
    undo,
    history,
    getRevision,
    list,
    locate,
    resources: () => [...registry.values()].map(({ name, ops }) => ({ name, ops })),
  };
}
