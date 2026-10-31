// Turns (one AI speaking once), their tool calls, and each AI's runtime
// session pointer per meeting (its working memory and how far it has read).
import { AppError } from './errors.js';

/** @typedef {'running' | 'done' | 'max_tokens' | 'cancelled' | 'failed'} TurnStatus */
/**
 * @typedef {{id:string,meetingId:string,participantId:string,triggerMessageId:string|null,
 *   status:TurnStatus,phase:string,stopReason:string|null,error:string|null,usage:any,
 *   startedAt:string,endedAt:string|null}} Turn
 * @typedef {{id:string,turnId:string,seq:number,callId:string|null,name:string,kind:string,
 *   args:any,result:any,status:string,preamble:string,startedAt:string,endedAt:string|null}} ToolCall
 */

const nullable = (value) => (value == null ? null : String(value));

/**
 * @param {any} row
 * @returns {Turn}
 */
export function toTurn(row) {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    participantId: String(row.participant_id),
    triggerMessageId: nullable(row.trigger_message_id),
    status: /** @type {TurnStatus} */ (String(row.status)),
    phase: String(row.phase),
    stopReason: nullable(row.stop_reason),
    error: nullable(row.error),
    usage: row.usage_json == null ? null : JSON.parse(String(row.usage_json)),
    startedAt: String(row.started_at),
    endedAt: nullable(row.ended_at),
  };
}

/**
 * @param {any} row
 * @returns {ToolCall}
 */
export function toToolCall(row) {
  return {
    id: String(row.id),
    turnId: String(row.turn_id),
    seq: Number(row.seq),
    callId: nullable(row.call_id),
    name: String(row.name),
    kind: String(row.kind),
    args: JSON.parse(String(row.args_json)),
    result: row.result_json == null ? null : JSON.parse(String(row.result_json)),
    status: String(row.status),
    preamble: String(row.preamble),
    startedAt: String(row.started_at),
    endedAt: nullable(row.ended_at),
  };
}

/**
 * @param {{ db: import('./db/database.js').Db, events: any, meetings: any,
 *   now: () => string, newId: (prefix: string) => string }} deps
 */
export function createTurns({ db, events, meetings, now, newId }) {
  function scope(meetingId, actorId) {
    return { projectId: meetings.get(meetingId).projectId, meetingId, actorId };
  }

  /** @param {string} id */
  function get(id) {
    const row = db.prepare('SELECT * FROM turns WHERE id = ?').get(id);
    if (!row) throw new AppError('TURN_NOT_FOUND', '找不到这次发言。', 404);
    return toTurn(row);
  }

  /**
   * @param {{ meetingId: string, participantId: string, triggerMessageId?: string | null }} input
   */
  function start({ meetingId, participantId, triggerMessageId = null }) {
    const id = newId('turn');
    return db.transaction(() => {
      db.prepare(
        `INSERT INTO turns (id, meeting_id, participant_id, trigger_message_id, status, started_at)
         VALUES (?, ?, ?, ?, 'running', ?)`,
      ).run(id, meetingId, participantId, triggerMessageId, now());
      const turn = get(id);
      events.record('turn.started', turn, scope(meetingId, participantId));
      return turn;
    });
  }

  /**
   * @param {string} id
   * @param {{ status: TurnStatus, stopReason?: string | null, usage?: any, error?: string | null }} result
   */
  function end(id, { status, stopReason = null, usage = null, error = null }) {
    const turn = get(id);
    return db.transaction(() => {
      setPhase(id, '');
      db.prepare(
        "UPDATE turns SET status = ?, stop_reason = ?, usage_json = ?, error = ?, ended_at = ?, phase = '' WHERE id = ?",
      ).run(status, stopReason, usage == null ? null : JSON.stringify(usage), error, now(), id);
      const ended = get(id);
      events.record('turn.ended', ended, scope(turn.meetingId, turn.participantId));
      return ended;
    });
  }

  /**
   * @param {string} id
   * @param {string} phase
   */
  function setPhase(id, phase) {
    const turn = get(id);
    if (turn.phase === phase) return turn;
    return db.transaction(() => {
      db.prepare('UPDATE turns SET phase = ? WHERE id = ?').run(phase, id);
      const updated = get(id);
      events.record('turn.phase', updated, scope(turn.meetingId, turn.participantId));
      return updated;
    });
  }

  /** Turns still marked running, e.g. after the program was closed mid-turn. */
  function running() {
    return db.prepare("SELECT * FROM turns WHERE status = 'running'").all().map(toTurn);
  }

  /**
   * @param {{ turnId: string, callId: string, name: string, args: any, preamble?: string, kind?:string, status?:string }} input
   */
  function startToolCall({
    turnId,
    callId,
    name,
    args,
    preamble = '',
    kind = 'tool',
    status = 'running',
  }) {
    const turn = get(turnId);
    const id = newId('tool');
    return db.transaction(() => {
      const last = db
        .prepare('SELECT MAX(seq) AS seq FROM tool_calls WHERE turn_id = ?')
        .get(turnId);
      db.prepare(
        `INSERT INTO tool_calls (id, turn_id, seq, call_id, name, args_json, status, preamble, started_at, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        turnId,
        Number(last?.seq ?? 0) + 1,
        callId,
        name,
        JSON.stringify(args ?? null),
        status,
        preamble,
        now(),
        kind,
      );
      const call = toToolCall(db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id));
      events.record('tool.started', call, scope(turn.meetingId, turn.participantId));
      return call;
    });
  }

  /**
   * A live projection update for thinking or approval metadata during execution.
   * @param {string} turnId
   * @param {string} callId
   * @param {any} result
   */
  function updateActivity(turnId, callId, result) {
    const turn = get(turnId);
    return db.transaction(() => {
      db.prepare('UPDATE tool_calls SET result_json = ? WHERE turn_id = ? AND call_id = ?').run(
        JSON.stringify(result),
        turnId,
        callId,
      );
      const call = toToolCall(
        db
          .prepare('SELECT * FROM tool_calls WHERE turn_id = ? AND call_id = ?')
          .get(turnId, callId),
      );
      events.record('tool.updated', call, scope(turn.meetingId, turn.participantId));
      return call;
    });
  }

  /**
   * @param {string} turnId
   * @param {string} callId
   * @param {{ result: any, isError: boolean, status?:string }} outcome
   */
  function endToolCall(turnId, callId, { result, isError, status }) {
    const turn = get(turnId);
    const row = db
      .prepare('SELECT * FROM tool_calls WHERE turn_id = ? AND call_id = ?')
      .get(turnId, callId);
    if (!row) return null;
    // Approval metadata is recorded before execution and survives its outcome,
    // including a later tool error. Ordinary results retain their existing shape.
    const approvedBy = JSON.parse(String(row.result_json ?? 'null'))?.approvedBy;
    if (approvedBy)
      result = {
        ...(result && typeof result === 'object' ? result : { value: result }),
        approvedBy,
      };
    return db.transaction(() => {
      db.prepare(
        'UPDATE tool_calls SET result_json = ?, status = ?, ended_at = ? WHERE id = ?',
      ).run(JSON.stringify(result ?? null), status ?? (isError ? 'failed' : 'done'), now(), row.id);
      const call = toToolCall(db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(row.id));
      events.record('tool.ended', call, scope(turn.meetingId, turn.participantId));
      return call;
    });
  }

  /** @param {string} turnId */
  function toolCalls(turnId) {
    return db
      .prepare('SELECT * FROM tool_calls WHERE turn_id = ? ORDER BY seq')
      .all(turnId)
      .map(toToolCall);
  }

  /**
   * The runtime session holding an AI's working memory in a meeting.
   * @param {string} meetingId
   * @param {string} participantId
   * @returns {{ runtime: string, sessionId: string, lastSeq: number } | null}
   */
  function session(meetingId, participantId) {
    const row = db
      .prepare('SELECT * FROM runtime_sessions WHERE meeting_id = ? AND participant_id = ?')
      .get(meetingId, participantId);
    if (!row) return null;
    return {
      runtime: String(row.runtime),
      sessionId: String(row.session_id),
      lastSeq: Number(row.last_seq),
    };
  }

  /**
   * @param {string} meetingId
   * @param {string} participantId
   * @param {{ runtime: string, sessionId: string, lastSeq: number }} value
   */
  function saveSession(meetingId, participantId, { runtime, sessionId, lastSeq }) {
    db.prepare(
      `INSERT INTO runtime_sessions (meeting_id, participant_id, runtime, session_id, last_seq)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (meeting_id, participant_id)
       DO UPDATE SET runtime = excluded.runtime, session_id = excluded.session_id,
         last_seq = excluded.last_seq`,
    ).run(meetingId, participantId, runtime, sessionId, lastSeq);
  }

  /** Forget a session so the next turn rebuilds working memory from the record. */
  function dropSession(meetingId, participantId) {
    db.prepare('DELETE FROM runtime_sessions WHERE meeting_id = ? AND participant_id = ?').run(
      meetingId,
      participantId,
    );
  }

  return {
    get,
    start,
    end,
    setPhase,
    running,
    startToolCall,
    endToolCall,
    updateActivity,
    toolCalls,
    session,
    saveSession,
    dropSession,
  };
}
