import { createHash } from 'node:crypto';

/**
 * @param {any} value
 * @returns {string}
 */
export function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * @param {import('../../core/index.js').Core} core
 * @param {()=>string} now
 * @returns {any}
 */
export function createMemoryStore(core, now) {
  const { db } = core;
  const cursor = (meetingId) => {
    const row = db.prepare('SELECT * FROM memory_cursors WHERE meeting_id = ?').get(meetingId);
    return {
      minutesRevision: row?.minutes_revision_id == null ? null : String(row.minutes_revision_id),
      throughSeq: Number(row?.through_seq ?? 0),
    };
  };
  const checkpoint = (meetingId) => {
    const row = db
      .prepare('SELECT checkpoint_json FROM memory_checkpoints WHERE meeting_id = ?')
      .get(meetingId);
    return row ? JSON.parse(String(row.checkpoint_json)) : null;
  };
  const saveCheckpoint = (meetingId, value) =>
    db
      .prepare(
        'INSERT INTO memory_checkpoints (meeting_id, checkpoint_json) VALUES (?, ?) ON CONFLICT(meeting_id) DO UPDATE SET checkpoint_json = excluded.checkpoint_json',
      )
      .run(meetingId, JSON.stringify(value));
  const savedStatus = (meetingId) => {
    const row = db
      .prepare('SELECT status_json FROM memory_runs WHERE meeting_id = ?')
      .get(meetingId);
    return row ? JSON.parse(String(row.status_json)) : {};
  };
  const saveStatus = (meetingId, value) => {
    value.updatedAt = now();
    db.prepare(
      'INSERT INTO memory_runs (meeting_id, status_json) VALUES (?, ?) ON CONFLICT(meeting_id) DO UPDATE SET status_json = excluded.status_json',
    ).run(meetingId, JSON.stringify(value));
    core.events.record(
      'memory.status',
      { meetingId, ...value },
      { meetingId, projectId: core.meetings.get(meetingId).projectId, actorId: 'agent_secretary' },
    );
  };
  const commit = (meetingId, revisionId, throughSeq) => {
    db.prepare(
      'INSERT INTO memory_cursors (meeting_id, minutes_revision_id, through_seq, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(meeting_id) DO UPDATE SET minutes_revision_id = excluded.minutes_revision_id, through_seq = excluded.through_seq, updated_at = excluded.updated_at',
    ).run(meetingId, revisionId, throughSeq, now());
    db.prepare('DELETE FROM memory_checkpoints WHERE meeting_id = ?').run(meetingId);
  };
  return { cursor, checkpoint, saveCheckpoint, savedStatus, saveStatus, commit };
}
