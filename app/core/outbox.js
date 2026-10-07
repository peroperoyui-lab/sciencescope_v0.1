// Pending user inputs are durable drafts, not formal meeting messages. Dispatch
// posts and removes one entry in a transaction, so restart never duplicates it.
import { AppError } from './errors.js';

function toItem(row) {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    authorId: String(row.author_id),
    text: String(row.text),
    refs: JSON.parse(String(row.refs_json)),
    replyTo: row.reply_to == null ? null : String(row.reply_to),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * @param {{db:import('./db/database.js').Db,events:any,meetings:any,messages:ReturnType<typeof import('./messages.js').createMessages>,
 * now:()=>string,newId:(prefix:string)=>string}} dependencies
 */
export function createOutbox({ db, events, meetings, messages, now, newId }) {
  function ensure(meetingId) {
    meetings.get(meetingId);
    db.prepare('INSERT OR IGNORE INTO meeting_outbox_state (meeting_id, paused) VALUES (?, 0)').run(
      meetingId,
    );
  }

  function rowOf(meetingId, id) {
    const row = db
      .prepare('SELECT * FROM meeting_outbox WHERE meeting_id = ? AND id = ?')
      .get(meetingId, id);
    if (!row) throw new AppError('OUTBOX_ITEM_NOT_FOUND', '找不到这条待发送消息。', 404);
    return row;
  }

  function textOf(text) {
    if (typeof text !== 'string' || !text.trim())
      throw new AppError('MESSAGE_REQUIRED', '请填写消息内容。');
    return text;
  }

  /** @param {string} meetingId @returns {{meetingId:string,paused:boolean,version:number,items:any[]}} */
  function list(meetingId) {
    meetings.get(meetingId);
    const state = db
      .prepare('SELECT paused, version FROM meeting_outbox_state WHERE meeting_id = ?')
      .get(meetingId);
    return {
      meetingId,
      paused: Boolean(state?.paused),
      version: Number(state?.version ?? 0),
      items: db
        .prepare('SELECT * FROM meeting_outbox WHERE meeting_id = ? ORDER BY rowid')
        .all(meetingId)
        .map(toItem),
    };
  }

  function changed(meetingId, actorId) {
    db.prepare('UPDATE meeting_outbox_state SET version = version + 1 WHERE meeting_id = ?').run(
      meetingId,
    );
    const state = list(meetingId);
    events.record('meeting.outbox.changed', state, {
      meetingId,
      actorId,
      projectId: meetings.get(meetingId).projectId,
    });
    return state;
  }

  /**
   * @param {{meetingId:string,authorId:string,text:string,refs?:any,replyTo?:string|null}} input
   * @returns {{item:any,state:ReturnType<typeof list>}}
   */
  function enqueue({ meetingId, authorId, text, refs = {}, replyTo = null }) {
    text = textOf(text);
    return db.transaction(() => {
      ensure(meetingId);
      const id = newId('outbox');
      const time = now();
      db.prepare(
        'INSERT INTO meeting_outbox (id,meeting_id,author_id,text,refs_json,reply_to,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      ).run(id, meetingId, authorId, text, JSON.stringify(refs), replyTo, time, time);
      return { item: toItem(rowOf(meetingId, id)), state: changed(meetingId, authorId) };
    });
  }

  /** @param {string} meetingId @param {string} id @param {{text?:string,refs?:any,replyTo?:string|null}} changes @returns {ReturnType<typeof list>} */
  function edit(meetingId, id, changes) {
    const before = toItem(rowOf(meetingId, id));
    const text = changes.text === undefined ? before.text : textOf(changes.text);
    return db.transaction(() => {
      db.prepare(
        'UPDATE meeting_outbox SET text = ?, refs_json = ?, reply_to = ?, updated_at = ? WHERE id = ?',
      ).run(
        text,
        JSON.stringify(changes.refs ?? before.refs),
        Object.hasOwn(changes, 'replyTo') ? changes.replyTo : before.replyTo,
        now(),
        id,
      );
      return changed(meetingId, before.authorId);
    });
  }

  /** @param {string} meetingId @param {string} [id] @returns {ReturnType<typeof list>} */
  function cancel(meetingId, id) {
    meetings.get(meetingId);
    if (id) rowOf(meetingId, id);
    return db.transaction(() => {
      if (id)
        db.prepare('DELETE FROM meeting_outbox WHERE meeting_id = ? AND id = ?').run(meetingId, id);
      else db.prepare('DELETE FROM meeting_outbox WHERE meeting_id = ?').run(meetingId);
      return changed(meetingId, null);
    });
  }

  /** @param {string} meetingId @param {boolean} paused @returns {ReturnType<typeof list>} */
  function setPaused(meetingId, paused) {
    return db.transaction(() => {
      ensure(meetingId);
      db.prepare('UPDATE meeting_outbox_state SET paused = ? WHERE meeting_id = ?').run(
        Number(paused),
        meetingId,
      );
      return changed(meetingId, null);
    });
  }

  /** @param {string} meetingId @returns {import('./messages.js').Message|null} */
  function dispatch(meetingId) {
    return db.transaction(() => {
      const state = list(meetingId);
      const first = state.items[0];
      if (state.paused || !first) return null;
      const message = messages.post({
        meetingId,
        authorId: first.authorId,
        text: first.text,
        refs: first.refs,
        replyTo: first.replyTo,
      });
      db.prepare('DELETE FROM meeting_outbox WHERE id = ?').run(first.id);
      changed(meetingId, first.authorId);
      return message;
    });
  }

  // Reopening a host retains pending drafts but requires an explicit resume.
  function recover() {
    db.exec(
      'UPDATE meeting_outbox_state SET paused = 1, version = version + 1 WHERE EXISTS (SELECT 1 FROM meeting_outbox WHERE meeting_outbox.meeting_id = meeting_outbox_state.meeting_id)',
    );
  }

  return { list, enqueue, edit, cancel, setPaused, dispatch, recover };
}
