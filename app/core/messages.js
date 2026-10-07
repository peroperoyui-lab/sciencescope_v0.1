// Messages: the meeting record, the single source of shared context.
import { AppError } from './errors.js';

/**
 * @typedef {'streaming' | 'done' | 'max_tokens' | 'failed' | 'cancelled'} MessageStatus
 * @typedef {{ id: string, meetingId: string, seq: number, authorId: string, text: string,
 *   status: MessageStatus, turnId: string | null, replyTo: string | null, refs: any,
 *   deliverables?: any[], adopted: boolean | null, adoptionLocked: boolean, createdAt: string, updatedAt: string }} Message
 */

/** SQLite stores the review adoption flag as 1, 0 or NULL (not a review). */
function adoptedValue(adopted) {
  if (adopted == null) return null;
  return Number(adopted);
}

/** @returns {Message} */
function toMessage(row) {
  const refs = JSON.parse(String(row.refs_json));
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    seq: Number(row.seq),
    authorId: String(row.author_id),
    text: String(row.text),
    status: /** @type {MessageStatus} */ (String(row.status)),
    turnId: row.turn_id == null ? null : String(row.turn_id),
    replyTo: row.reply_to == null ? null : String(row.reply_to),
    refs,
    adopted: row.adopted == null ? null : Boolean(row.adopted),
    adoptionLocked: Boolean(refs.contextReadBy?.length),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * @param {{ db: import('./db/database.js').Db, events: any, meetings: any,
 *   now: () => string, newId: (prefix: string) => string, deliverables: any }} deps
 */
export function createMessages({ db, events, meetings, now, newId, deliverables }) {
  const hydrate = (row) => ({ ...toMessage(row), deliverables: deliverables.list(String(row.id)) });
  /** @param {string} id @returns {Message} */
  function get(id) {
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
    if (!row) throw new AppError('MESSAGE_NOT_FOUND', '找不到这条消息。', 404);
    return hydrate(row);
  }

  function scopeOf(message, actorId) {
    const meeting = meetings.get(message.meetingId);
    return { projectId: meeting.projectId, meetingId: message.meetingId, actorId };
  }

  /**
   * Add a message at the end of a meeting.
   * @param {{ meetingId: string, authorId: string, text: string, status?: MessageStatus,
   *   turnId?: string | null, replyTo?: string | null, refs?: any, adopted?: boolean | null }} input
   * @returns {Message}
   */
  function post({
    meetingId,
    authorId,
    text,
    status = 'done',
    turnId = null,
    replyTo = null,
    refs = {},
    adopted = null,
  }) {
    meetings.get(meetingId);
    return db.transaction(() => {
      const last = db
        .prepare('SELECT MAX(seq) AS seq FROM messages WHERE meeting_id = ?')
        .get(meetingId);
      const id = newId('msg');
      const time = now();
      db.prepare(
        `INSERT INTO messages (id, meeting_id, seq, author_id, text, status, turn_id, reply_to,
           refs_json, adopted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        meetingId,
        Number(last?.seq ?? 0) + 1,
        authorId,
        String(text ?? ''),
        status,
        turnId,
        replyTo,
        JSON.stringify(refs),
        adoptedValue(adopted),
        time,
        time,
      );
      meetings.touch(meetingId);
      const message = get(id);
      events.record('message.created', message, scopeOf(message, authorId));
      return message;
    });
  }

  /**
   * Change text, status, refs or the adoption of a review.
   * @param {string} id
   * @param {{ text?: string, status?: MessageStatus, refs?: any, adopted?: boolean | null }} changes
   * @returns {Message}
   */
  function update(id, changes) {
    const message = get(id);
    if (changes.adopted === true && (changes.status ?? message.status) !== 'done') {
      throw new AppError('REVIEW_INCOMPLETE', '审核尚未完成，不能加入后续上下文。', 409);
    }
    if (changes.adopted === false && message.adopted && message.adoptionLocked) {
      throw new AppError('REVIEW_ALREADY_READ', '后续发言已经读到这份审核，不能取消采纳。', 409);
    }
    return db.transaction(() => {
      db.prepare(
        'UPDATE messages SET text = ?, status = ?, refs_json = ?, adopted = ?, updated_at = ? WHERE id = ?',
      ).run(
        changes.text ?? message.text,
        changes.status ?? message.status,
        JSON.stringify(changes.refs ?? message.refs),
        adoptedValue(changes.adopted === undefined ? message.adopted : changes.adopted),
        now(),
        id,
      );
      const updated = get(id);
      events.record('message.updated', updated, scopeOf(updated, null));
      return updated;
    });
  }

  /**
   * Stream text to subscribers while a message is being written (not stored).
   * @param {string} id
   * @param {string} delta
   */
  function streamDelta(id, delta) {
    const message = get(id);
    events.transient('message.delta', { id, delta }, scopeOf(message, message.authorId));
  }

  /**
   * Replace the streamed text shown so far (not stored): used when a failed
   * attempt is dropped or text before a tool call moves into the tool card.
   * @param {string} id
   * @param {string} text
   */
  function streamReplace(id, text) {
    const message = get(id);
    events.transient('message.replace', { id, text }, scopeOf(message, message.authorId));
  }

  /**
   * A page of messages by sequence number.
   * @param {string} meetingId
   * @param {{ before?: number, after?: number, limit?: number }} [page]
   * @returns {{ messages: Message[], hasBefore: boolean, hasAfter: boolean }}
   */
  function list(meetingId, { before, after, limit = 60 } = {}) {
    meetings.get(meetingId);
    let rows;
    if (after != null) {
      rows = db
        .prepare('SELECT * FROM messages WHERE meeting_id = ? AND seq > ? ORDER BY seq LIMIT ?')
        .all(meetingId, after, limit);
    } else {
      const upper = before ?? Number.MAX_SAFE_INTEGER;
      rows = db
        .prepare(
          'SELECT * FROM messages WHERE meeting_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?',
        )
        .all(meetingId, upper, limit)
        .reverse();
    }
    const messages = rows.map(hydrate);
    const first = messages[0]?.seq;
    const last = messages.at(-1)?.seq;
    const exists = (sql, seq) => Boolean(db.prepare(sql).get(meetingId, seq));
    return {
      messages,
      hasBefore:
        first != null &&
        exists('SELECT 1 FROM messages WHERE meeting_id = ? AND seq < ? LIMIT 1', first),
      hasAfter:
        last != null &&
        exists('SELECT 1 FROM messages WHERE meeting_id = ? AND seq > ? LIMIT 1', last),
    };
  }

  /**
   * Every message after a sequence number, oldest first (context assembly).
   * @param {string} meetingId
   * @param {number} afterSeq
   * @returns {Message[]}
   */
  function since(meetingId, afterSeq) {
    return db
      .prepare('SELECT * FROM messages WHERE meeting_id = ? AND seq > ? ORDER BY seq')
      .all(meetingId, afterSeq)
      .map(hydrate);
  }

  /**
   * Messages containing `query` (case-insensitive for Latin letters), newest
   * first, with a short snippet around the first match.
   * @param {string} query
   * @param {{ limit?: number }} [options]
   */
  function search(query, { limit = 30 } = {}) {
    const needle = String(query ?? '').trim();
    if (!needle) return [];
    const escaped = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
    return db
      .prepare(
        `SELECT m.* FROM messages m JOIN meetings g ON g.id = m.meeting_id
         WHERE m.text LIKE ? ESCAPE '\\' AND g.archived = 0
         ORDER BY m.created_at DESC LIMIT ?`,
      )
      .all(`%${escaped}%`, limit)
      .map(hydrate)
      .map((message) => {
        const at = message.text.toLowerCase().indexOf(needle.toLowerCase());
        const start = Math.max(0, at - 30);
        const snippet = message.text.slice(start, at + needle.length + 60).replace(/\s+/g, ' ');
        return {
          id: message.id,
          meetingId: message.meetingId,
          seq: message.seq,
          snippet: `${start > 0 ? '…' : ''}${snippet}`,
        };
      });
  }

  /** Record the reviews actually supplied to an invocation, independently of session cursors.
   * @param {string[]} messageIds
   * @param {string} turnId
   */
  function recordConsumption(messageIds, turnId) {
    const turn = db.prepare('SELECT participant_id FROM turns WHERE id = ?').get(turnId);
    db.transaction(() => {
      for (const id of messageIds) {
        const message = get(id);
        if (!message.adopted) continue;
        const readers = message.refs.contextReadBy ?? [];
        if (readers.some((reader) => reader.turnId === turnId)) continue;
        update(id, {
          refs: {
            ...message.refs,
            contextReadBy: [...readers, { turnId, participantId: String(turn.participant_id) }],
          },
        });
      }
    });
  }

  return { get, post, update, recordConsumption, streamDelta, streamReplace, list, since, search };
}
