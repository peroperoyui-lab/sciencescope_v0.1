// Goal state is durable; the conductor alone decides when another turn starts.
// A restarted host never silently resumes work that may have external effects.
import { AppError } from './errors.js';

/**
 * @param {{db:import('./db/database.js').Db,events:any,meetings:any,now:()=>string}} dependencies
 */
export function createGoals({ db, events, meetings, now }) {
  function get(meetingId) {
    const row = db.prepare('SELECT * FROM meeting_goals WHERE meeting_id=?').get(meetingId);
    if (!row) return null;
    return {
      meetingId: String(row.meeting_id),
      text: String(row.text),
      status: String(row.status),
      rounds: Number(row.rounds),
      maxRounds: Number(row.max_rounds),
      reason: String(row.reason),
      startedAt: String(row.started_at),
      updatedAt: String(row.updated_at),
    };
  }
  function changed(meetingId, actorId) {
    const goal = get(meetingId);
    events.record('goal.changed', goal, {
      meetingId,
      projectId: meetings.get(meetingId).projectId,
      actorId,
    });
    return goal;
  }
  function roundsValue(value) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new AppError('INVALID_GOAL_ROUNDS', '最多轮数需要是正整数。');
    return value;
  }
  function ensureEligible(meetingId) {
    const meeting = meetings.get(meetingId);
    const assistant = db.prepare('SELECT meeting_id FROM assistant_state WHERE singleton=1').get();
    if (meeting.attachedToMeetingId || assistant?.meeting_id === meetingId)
      throw new AppError('GOAL_NOT_AVAILABLE', '这个会话不提供自动化。');
    if (meeting.policy.mode === 'round')
      throw new AppError('GOAL_DISCUSSION_CONFLICT', '请先结束有序讨论，再使用自动化。');
    return meeting;
  }
  function start(meetingId, text, maxRounds = 30, actorId = 'person_user') {
    ensureEligible(meetingId);
    if (typeof text !== 'string' || !text.trim())
      throw new AppError('GOAL_REQUIRED', '请填写目标。');
    roundsValue(maxRounds);
    return db.transaction(() => {
      const time = now();
      db.prepare(
        `INSERT INTO meeting_goals(meeting_id,text,status,rounds,max_rounds,reason,started_at,updated_at)
        VALUES(?,?,'running',0,?,'',?,?) ON CONFLICT(meeting_id) DO UPDATE SET
        text=excluded.text,status='running',rounds=0,max_rounds=excluded.max_rounds,
        reason='',started_at=excluded.started_at,updated_at=excluded.updated_at`,
      ).run(meetingId, text, maxRounds, time, time);
      meetings.update(meetingId, { policy: { mode: 'autonomous', goal: text } }, { actorId });
      return changed(meetingId, actorId);
    });
  }
  function update(meetingId, changes, actorId = 'person_user') {
    const goal = get(meetingId);
    if (!goal) throw new AppError('GOAL_NOT_FOUND', '这个会议还没有目标。', 404);
    const maxRounds = roundsValue(changes.maxRounds ?? goal.maxRounds);
    return db.transaction(() => {
      db.prepare(
        'UPDATE meeting_goals SET status=?,rounds=?,max_rounds=?,reason=?,updated_at=? WHERE meeting_id=?',
      ).run(
        changes.status ?? goal.status,
        changes.rounds ?? goal.rounds,
        maxRounds,
        changes.reason ?? goal.reason,
        now(),
        meetingId,
      );
      return changed(meetingId, actorId);
    });
  }
  function report(meetingId, status, summary, actorId) {
    if (!['complete', 'blocked'].includes(status) || typeof summary !== 'string')
      throw new AppError('INVALID_GOAL_REPORT', '请提供目标的完成状态和总结。');
    const goal = get(meetingId);
    // A pause can arrive during the current turn. Its completion may still be
    // reported; ending a goal, however, must never be undone by a late tool call.
    if (!goal || !['running', 'paused'].includes(goal.status))
      throw new AppError('GOAL_NOT_RUNNING', '当前没有可以更新的目标。');
    return update(
      meetingId,
      { status: status === 'complete' ? 'completed' : 'blocked', reason: summary },
      actorId,
    );
  }
  function recover() {
    for (const row of db
      .prepare("SELECT meeting_id FROM meeting_goals WHERE status='running'")
      .all())
      update(String(row.meeting_id), { status: 'paused', reason: '程序已重新启动，请继续目标。' });
  }
  return { get, start, update, report, recover, ensureEligible };
}
