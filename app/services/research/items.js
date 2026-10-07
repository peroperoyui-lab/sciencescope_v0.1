import { AppError } from '../../core/errors.js';
import { filterProject, oneOf, payloadText, recordObject, requiredText } from './records.js';

const subtypes = {
  knowledge: ['finding', 'definition', 'method', 'fact', 'dataset-note', 'other'],
  model: ['theory', 'formula', 'algorithm', 'statistical-model', 'protocol'],
  memory: [
    'preference',
    'goal',
    'decision',
    'convention',
    'open-question',
    'lesson',
    'episode',
    'profile',
  ],
  claim: ['hypothesis', 'claim', 'conclusion'],
  note: ['note', 'mark', 'summary'],
};
const statuses = ['active', 'superseded', 'archived', 'proposed', 'rejected'];

/**
 * @typedef {ReturnType<typeof itemRow>} ResearchItem
 * @typedef {import('../../core/workspace/workspace.js').Actor} Actor
 * @typedef {{ projectId?: string | null, includePersonal?: boolean, type?: string,
 *   subtype?: string, status?: string, scope?: string, visibility?: string,
 *   includeSuperseded?: boolean, pinned?:boolean, limit?: number, offset?: number }} ItemQuery
 * @typedef {{ createItem: (input: any, actor?: Actor) => ResearchItem,
 *   getItem: (id: string) => ResearchItem,
 *   listItems: (options?: ItemQuery) => ResearchItem[],
 *   updateItem: (id: string, patch: any, actor?: Actor) => ResearchItem,
 *   supersedeItem: (id: string, replacement: any, actor?: Actor & {expectedRevision?: number}) =>
 *     {item: ResearchItem, superseded: ResearchItem},
 *   revisions: (id: string) => Array<{revision: number, snapshot: ResearchItem,
 *     changedBy: string, changedAt: string}> }} ResearchItems
 */

function itemRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    projectId: row.project_id == null ? null : String(row.project_id),
    type: String(row.type),
    subtype: String(row.subtype),
    scope: String(row.scope),
    title: String(row.title),
    body: String(row.body),
    payload: JSON.parse(String(row.payload_json)),
    pinned: Boolean(JSON.parse(String(row.payload_json)).pinned),
    status: String(row.status),
    visibility: String(row.visibility),
    revision: Number(row.revision),
    createdBy: String(row.created_by),
    origin: JSON.parse(String(row.origin_json)),
    validFrom: row.valid_from == null ? null : String(row.valid_from),
    validTo: row.valid_to == null ? null : String(row.valid_to),
    supersededBy: row.superseded_by == null ? null : String(row.superseded_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalize(input, current = null) {
  const type = oneOf(input.type ?? current?.type ?? 'note', Object.keys(subtypes), 'item type');
  const subtype = oneOf(
    input.subtype ?? current?.subtype ?? subtypes[type][0],
    subtypes[type],
    'item subtype',
  );
  const projectId = input.projectId === undefined ? (current?.projectId ?? null) : input.projectId;
  const scope = input.scope ?? current?.scope ?? (projectId ? 'project' : 'personal');
  if (!['project', 'personal'].includes(scope) && !/^expert:.+$/u.test(scope)) {
    throw new AppError('INVALID_RESEARCH_RECORD', 'Invalid research item scope.');
  }
  if (scope === 'project' && projectId == null) {
    throw new AppError('INVALID_RESEARCH_RECORD', 'Project items require a project.');
  }
  const body = input.body ?? current?.body ?? '';
  if (typeof body !== 'string') {
    throw new AppError('INVALID_RESEARCH_RECORD', 'Research item body must be text.');
  }
  return {
    projectId,
    type,
    subtype,
    scope,
    title: requiredText(input.title ?? current?.title, 'title'),
    body,
    payload: recordObject(input.payload ?? current?.payload ?? {}),
    status: oneOf(input.status ?? current?.status ?? 'active', statuses, 'item status'),
    visibility: oneOf(
      input.visibility ?? current?.visibility ?? 'shared',
      ['shared', 'private'],
      'visibility',
    ),
    validFrom: input.validFrom === undefined ? (current?.validFrom ?? null) : input.validFrom,
    origin: recordObject(input.origin ?? current?.origin ?? {}),
  };
}

/**
 * @param {{ db: import('../../core/db/database.js').Db, now: () => string,
 *   newId: (prefix: string) => string, putIndex: (...args: any[]) => void,
 *   changed: (...args: any[]) => void }} deps
 * @returns {ResearchItems}
 */
export function createResearchItems({ db, now, newId, putIndex, changed }) {
  /** @param {string} id */
  function getItem(id) {
    const item = itemRow(db.prepare('SELECT * FROM rb_items WHERE id = ?').get(id));
    if (!item) throw new AppError('ITEM_NOT_FOUND', 'Research item not found.', 404);
    return item;
  }

  function indexItem(item) {
    putIndex(
      'item',
      item.id,
      item.projectId,
      item.title,
      `${item.body}\n${payloadText(item.payload)}`,
    );
  }

  function saveRevision(item, actor) {
    db.prepare(
      `INSERT INTO rb_revisions
      (item_id, revision, snapshot_json, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(item.id, item.revision, JSON.stringify(item), actor.actorId ?? 'user', now());
  }

  function assertRevision(item, expectedRevision) {
    if (expectedRevision !== undefined && expectedRevision !== item.revision) {
      throw new AppError('REVISION_CONFLICT', 'Research item revision has changed.', 409);
    }
  }

  function insertItem(input, actor) {
    const value = normalize(input);
    const id = input.id ?? newId('itm');
    const time = now();
    db.prepare(
      `INSERT INTO rb_items (id, project_id, type, subtype, scope, title, body,
      payload_json, status, visibility, created_by, origin_json, valid_from, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      value.projectId,
      value.type,
      value.subtype,
      value.scope,
      value.title,
      value.body,
      JSON.stringify(value.payload),
      value.status,
      value.visibility,
      actor.actorId ?? 'user',
      JSON.stringify(value.origin),
      value.validFrom ?? (value.type === 'memory' ? time : null),
      time,
      time,
    );
    const item = getItem(id);
    indexItem(item);
    return item;
  }

  /** @param {any} input @param {import('../../core/workspace/workspace.js').Actor} [actor] */
  function createItem(input, actor = {}) {
    return db.transaction(() => {
      const item = insertItem(input, actor);
      changed('item.created', item, actor);
      return item;
    });
  }

  /** @param {string} id @param {any} patch
   * @param {import('../../core/workspace/workspace.js').Actor} [actor] */
  function updateItem(id, patch, actor = {}) {
    return db.transaction(() => {
      const current = getItem(id);
      assertRevision(current, patch.expectedRevision);
      const value = normalize(patch, current);
      saveRevision(current, actor);
      db.prepare(
        `UPDATE rb_items SET project_id = ?, type = ?, subtype = ?, scope = ?,
        title = ?, body = ?, payload_json = ?, status = ?, visibility = ?, origin_json = ?,
        valid_from = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
      ).run(
        value.projectId,
        value.type,
        value.subtype,
        value.scope,
        value.title,
        value.body,
        JSON.stringify(value.payload),
        value.status,
        value.visibility,
        JSON.stringify(value.origin),
        value.validFrom,
        now(),
        id,
      );
      const item = getItem(id);
      indexItem(item);
      changed('item.updated', item, actor);
      return item;
    });
  }

  /** @param {string} id @param {any} replacement
   * @param {import('../../core/workspace/workspace.js').Actor & { expectedRevision?: number }} [actor] */
  function supersedeItem(id, replacement, actor = {}) {
    return db.transaction(() => {
      const current = getItem(id);
      assertRevision(current, replacement.expectedRevision ?? actor.expectedRevision);
      if (current.status !== 'active') {
        throw new AppError('NOT_ACTIVE', 'Only active research items can be superseded.', 409);
      }
      const item = insertItem(
        {
          type: current.type,
          subtype: current.subtype,
          projectId: current.projectId,
          scope: current.scope,
          visibility: current.visibility,
          origin: current.origin,
          ...replacement,
        },
        actor,
      );
      saveRevision(current, actor);
      const time = now();
      db.prepare(
        `UPDATE rb_items SET status = 'superseded', valid_to = ?, superseded_by = ?,
        revision = revision + 1, updated_at = ? WHERE id = ?`,
      ).run(time, item.id, time, id);
      changed('item.superseded', current, actor);
      return { item, superseded: getItem(id) };
    });
  }

  /** @param {ItemQuery} [options] */
  function listItems(options = {}) {
    const where = [];
    const params = [];
    filterProject('project_id', options, where, params);
    const status = options.status ?? (options.includeSuperseded ? 'any' : 'active');
    if (status !== 'any') {
      where.push('status = ?');
      params.push(status);
    }
    for (const field of ['type', 'subtype', 'scope', 'visibility']) {
      if (options[field] !== undefined) {
        where.push(`${field} = ?`);
        params.push(options[field]);
      }
    }
    if (options.pinned !== undefined) {
      where.push("coalesce(json_extract(payload_json,'$.pinned'),0)=?");
      params.push(options.pinned ? 1 : 0);
    }
    return db
      .prepare(
        `SELECT * FROM rb_items ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY coalesce(json_extract(payload_json,'$.pinned'),0) DESC, updated_at DESC, id LIMIT ? OFFSET ?`,
      )
      .all(...params, options.limit ?? -1, options.offset ?? 0)
      .map(itemRow);
  }

  /** @param {string} id */
  function revisions(id) {
    return db
      .prepare('SELECT * FROM rb_revisions WHERE item_id = ? ORDER BY revision DESC')
      .all(id)
      .map((row) => ({
        revision: Number(row.revision),
        snapshot: JSON.parse(String(row.snapshot_json)),
        changedBy: String(row.changed_by),
        changedAt: String(row.changed_at),
      }));
  }

  return { createItem, getItem, listItems, updateItem, supersedeItem, revisions };
}
