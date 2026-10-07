// History snapshots mark editing boundaries; revisions still record each mutation.
// AI snapshots use that turn's final revision, so concurrent writers are attributed correctly.
import { AppError } from '../errors.js';
import { hashText, removeFile, writeTextAtomic } from './files.js';

const SOURCES = ['leave-page', 'ai-turn-end', 'before-restore'];
const nullable = (value) => (value == null ? null : String(value));

function metadata(row) {
  return {
    id: String(row.id),
    resource: String(row.resource),
    key: String(row.resource_key).slice(String(row.resource).length + 1),
    projectId: nullable(row.project_id),
    revisionId: nullable(row.revision_id),
    actorId: nullable(row.actor_id),
    meetingId: nullable(row.meeting_id),
    turnId: nullable(row.turn_id),
    source: String(row.source),
    description: String(row.description),
    createdAt: String(row.created_at),
  };
}

/**
 * @param {{db:import('../db/database.js').Db,events:any,now:()=>string,newId:(prefix:string)=>string,
 * locate:import('./workspace.js').Locate,resourceOf:(name:string)=>import('./workspace.js').Resource,
 * projectIdOf:(resource:string,key:string)=>string|null,queued:any,currentText:any,
 * lastRevision:any,insertRevision:any}} dependencies
 */
export function createSnapshots({
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
}) {
  function rowOf(id) {
    const row = db.prepare('SELECT * FROM resource_snapshots WHERE id = ?').get(id);
    if (!row) throw new AppError('SNAPSHOT_NOT_FOUND', '找不到这个历史版本。', 404);
    return row;
  }

  /**
   * @param {{resource:string,key:string,text:string|null,revisionId:string|null,source:string,
   * description?:string,actor?:import('./workspace.js').Actor,force?:boolean}} input
   */
  function insert({
    resource,
    key,
    text,
    revisionId,
    source,
    description = '',
    actor = {},
    force = false,
  }) {
    const resourceKey = resource + ':' + key;
    const previous = db
      .prepare(
        'SELECT * FROM resource_snapshots WHERE resource_key = ? ORDER BY rowid DESC LIMIT 1',
      )
      .get(resourceKey);
    if (
      !force &&
      ((!previous && text == null) ||
        (previous && nullable(previous.content_hash) === hashText(text)))
    )
      return null;
    const id = newId('snapshot');
    db.prepare(
      `INSERT INTO resource_snapshots
      (id, resource, resource_key, project_id, content_text, content_hash, revision_id,
       actor_id, meeting_id, turn_id, source, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      resource,
      resourceKey,
      projectIdOf(resource, key),
      text,
      hashText(text),
      revisionId,
      actor.actorId ?? null,
      actor.meetingId ?? null,
      actor.turnId ?? null,
      source,
      description,
      now(),
    );
    const snapshot = metadata(rowOf(id));
    events.record('resource.snapshot.created', snapshot, {
      projectId: snapshot.projectId,
      meetingId: snapshot.meetingId,
      actorId: snapshot.actorId,
    });
    return snapshot;
  }

  /**
   * @param {{resource:string,key:string,source?:string,description?:string}} input
   * @param {import('./workspace.js').Actor} [actor]
   * @returns {Promise<any>}
   */
  async function captureSnapshot(
    { resource, key, source = 'leave-page', description = '' },
    actor = {},
  ) {
    if (!SOURCES.includes(source))
      throw new AppError('INVALID_SNAPSHOT_SOURCE', '历史版本来源无效。');
    const file = resourceOf(resource).file(locate, key);
    return queued(resource + ':' + key, async () => {
      const text = await currentText(resource, key, file);
      return db.transaction(() =>
        insert({
          resource,
          key,
          text,
          source,
          description,
          actor,
          revisionId: lastRevision(resource + ':' + key)?.id ?? null,
        }),
      );
    });
  }

  /**
   * @param {{resource?:string,key?:string,projectId?:string,meetingId?:string,limit?:number}} [filter]
   * @returns {any[]}
   */
  function snapshots({ resource, key, projectId, meetingId, limit } = {}) {
    const clauses = [];
    const params = [];
    for (const [column, value] of [
      ['resource', resource],
      ['project_id', projectId],
      ['meeting_id', meetingId],
    ]) {
      if (value !== undefined) {
        clauses.push(column + ' = ?');
        params.push(value);
      }
    }
    if (key !== undefined) {
      clauses.push(
        resource ? 'resource_key = ?' : 'substr(resource_key, length(resource) + 2) = ?',
      );
      params.push(resource ? resource + ':' + key : key);
    }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    return db
      .prepare(
        'SELECT * FROM resource_snapshots ' +
          where +
          ' ORDER BY created_at DESC, rowid DESC' +
          (limit === undefined ? '' : ' LIMIT ?'),
      )
      .all(...params, ...(limit === undefined ? [] : [limit]))
      .map(metadata);
  }

  /** @param {string} id @returns {any} */
  function getSnapshot(id) {
    const row = rowOf(id);
    const text = nullable(row.content_text);
    const handler = resourceOf(String(row.resource));
    return {
      ...metadata(row),
      text,
      exists: text != null,
      value: handler.parse ? handler.parse(text) : text,
    };
  }

  /**
   * @param {string} id
   * @param {import('./workspace.js').Actor} [actor]
   * @returns {Promise<any>}
   */
  async function restoreSnapshot(id, actor = {}) {
    const snapshot = getSnapshot(id);
    const { resource, key, text } = snapshot;
    const file = resourceOf(resource).file(locate, key);
    return queued(resource + ':' + key, async () => {
      const current = await currentText(resource, key, file);
      if (current === text)
        return { revisionId: null, value: snapshot.value, preservedSnapshotId: null };
      // Preserve before touching the file, even if the subsequent write fails.
      const preserved = db.transaction(() =>
        insert({
          resource,
          key,
          text: current,
          revisionId: lastRevision(resource + ':' + key)?.id ?? null,
          source: 'before-restore',
          description: '',
          actor,
          force: true,
        }),
      );
      if (text == null) await removeFile(file);
      else await writeTextAtomic(file, text);
      const revisionId = db.transaction(() => {
        const revision = insertRevision({
          resource,
          key,
          before: current,
          after: text,
          op: 'restore',
          actor,
        });
        db.prepare('UPDATE revisions SET restored_from_revision_id = ? WHERE id = ?').run(
          snapshot.revisionId,
          revision,
        );
        return revision;
      });
      return { revisionId, value: snapshot.value, preservedSnapshotId: preserved.id };
    });
  }

  /** @param {string} id @param {import('./workspace.js').Actor} [actor] @returns {{deleted:boolean}} */
  function deleteSnapshot(id, actor = {}) {
    const snapshot = metadata(rowOf(id));
    return db.transaction(() => {
      db.prepare('DELETE FROM resource_snapshots WHERE id = ?').run(id);
      events.record('resource.snapshot.deleted', snapshot, {
        projectId: snapshot.projectId,
        meetingId: actor.meetingId,
        actorId: actor.actorId,
      });
      return { deleted: true };
    });
  }

  /** @param {string} turnId @returns {any[]} */
  function captureTurnSnapshots(turnId) {
    const turn = db.prepare('SELECT * FROM turns WHERE id = ?').get(turnId);
    if (!turn) throw new AppError('TURN_NOT_FOUND', '找不到这次发言。', 404);
    const rows = db
      .prepare(
        `SELECT * FROM revisions WHERE rowid IN (
      SELECT MAX(rowid) FROM revisions WHERE turn_id = ? GROUP BY resource_key
    ) ORDER BY rowid`,
      )
      .all(turnId);
    return db.transaction(() =>
      rows.flatMap((row) => {
        if (
          db
            .prepare(
              "SELECT id FROM resource_snapshots WHERE turn_id = ? AND resource_key = ? AND source = 'ai-turn-end'",
            )
            .get(turnId, row.resource_key)
        )
          return [];
        const resource = String(row.resource);
        return [
          insert({
            resource,
            key: String(row.resource_key).slice(resource.length + 1),
            text: nullable(row.after_text),
            revisionId: String(row.id),
            source: 'ai-turn-end',
            force: true,
            actor: {
              actorId: String(turn.participant_id),
              meetingId: String(turn.meeting_id),
              turnId,
            },
            description: '',
          }),
        ];
      }),
    );
  }

  return {
    captureSnapshot,
    snapshots,
    getSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    captureTurnSnapshots,
  };
}
