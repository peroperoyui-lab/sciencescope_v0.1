/**
 * The change feed. Every state change records an event in the same transaction;
 * subscribers (the UI over SSE, background participants) are told after commit.
 * Transient events (streaming text) are pushed to subscribers but never stored.
 *
 * @typedef {{ seq: number | null, type: string, projectId: string | null,
 *   meetingId: string | null, actorId: string | null, payload: any, createdAt: string }} AppEvent
 */

/**
 * @param {import('./db/database.js').Db} db
 * @param {{ now: () => string }} deps
 */
export function createEvents(db, { now }) {
  /** @type {Set<(event: AppEvent) => void>} */
  const listeners = new Set();

  function notify(event) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Event listener failed', error);
      }
    }
  }

  /**
   * Store an event. Call inside the transaction that made the change.
   * @param {string} type
   * @param {any} payload
   * @param {{ projectId?: string | null, meetingId?: string | null, actorId?: string | null }} [scope]
   * @returns {AppEvent}
   */
  function record(type, payload, scope = {}) {
    const createdAt = now();
    const result = db
      .prepare(
        `INSERT INTO events (type, project_id, meeting_id, actor_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        type,
        scope.projectId ?? null,
        scope.meetingId ?? null,
        scope.actorId ?? null,
        JSON.stringify(payload),
        createdAt,
      );
    const event = {
      seq: Number(result.lastInsertRowid),
      type,
      projectId: scope.projectId ?? null,
      meetingId: scope.meetingId ?? null,
      actorId: scope.actorId ?? null,
      payload,
      createdAt,
    };
    db.afterCommit(() => notify(event));
    return event;
  }

  /**
   * Push an event to subscribers without storing it (e.g. `message.delta`).
   * @param {string} type
   * @param {any} payload
   * @param {{ projectId?: string | null, meetingId?: string | null, actorId?: string | null }} [scope]
   */
  function transient(type, payload, scope = {}) {
    notify({
      seq: null,
      type,
      projectId: scope.projectId ?? null,
      meetingId: scope.meetingId ?? null,
      actorId: scope.actorId ?? null,
      payload,
      createdAt: now(),
    });
  }

  /**
   * Stored events after `seq`, oldest first.
   * @param {number} seq
   * @param {number} [limit]
   * @returns {AppEvent[]}
   */
  function since(seq, limit = 1000) {
    return db
      .prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?')
      .all(seq, limit)
      .map((row) => ({
        seq: Number(row.seq),
        type: String(row.type),
        projectId: row.project_id == null ? null : String(row.project_id),
        meetingId: row.meeting_id == null ? null : String(row.meeting_id),
        actorId: row.actor_id == null ? null : String(row.actor_id),
        payload: JSON.parse(String(row.payload_json)),
        createdAt: String(row.created_at),
      }));
  }

  /**
   * @param {(event: AppEvent) => void} listener
   * @returns {() => void} Unsubscribe.
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { record, transient, since, subscribe };
}
