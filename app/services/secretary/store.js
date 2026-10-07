// Coverage follows the revision ancestry, including inverse revisions made by
// Workspace.undo. A user edit inherits coverage instead of claiming new messages.

/**
 * @param {import('../../core/index.js').Core} core
 * @returns {{currentRevision:(meetingId:string)=>any, state:(meetingId:string,revision?:any)=>{throughSeq:number,coveredMessageIds:string[]}, save:(meetingId:string,revisionId:string,throughSeq:number,messageIds:string[])=>void, status:(meetingId:string)=>any, patchStatus:(meetingId:string,changes:any)=>void}}
 */
export function createMinutesStore(core) {
  const { db } = core;

  function currentRevision(meetingId) {
    return db
      .prepare('SELECT rowid, * FROM revisions WHERE resource_key = ? ORDER BY rowid DESC LIMIT 1')
      .get(`minutes:${meetingId}`);
  }

  function predecessor(row) {
    return db
      .prepare(
        'SELECT rowid, * FROM revisions WHERE resource_key = ? AND rowid < ? ORDER BY rowid DESC LIMIT 1',
      )
      .get(row.resource_key, row.rowid);
  }

  function state(meetingId, revision) {
    const id = typeof revision === 'string' ? revision : revision?.id;
    let row =
      revision === null
        ? null
        : id
          ? db
              .prepare('SELECT rowid, * FROM revisions WHERE id = ? AND resource_key = ?')
              .get(id, `minutes:${meetingId}`)
          : currentRevision(meetingId);
    while (row) {
      if (!String(row.after_text ?? '').trim()) break;
      const metadata = db
        .prepare('SELECT * FROM minutes_coverage WHERE revision_id = ?')
        .get(row.id);
      if (metadata)
        return {
          throughSeq: Number(metadata.through_seq),
          coveredMessageIds: JSON.parse(String(metadata.covered_message_ids_json)),
        };
      if (row.op === 'undo') {
        const original = db
          .prepare('SELECT rowid, * FROM revisions WHERE undone_by = ?')
          .get(row.id);
        row = original ? predecessor(original) : null;
      } else row = predecessor(row);
    }
    return { throughSeq: 0, coveredMessageIds: [] };
  }

  function save(meetingId, revisionId, throughSeq, messageIds) {
    db.prepare(
      'INSERT INTO minutes_coverage (revision_id, meeting_id, through_seq, covered_message_ids_json) VALUES (?, ?, ?, ?)',
    ).run(revisionId, meetingId, throughSeq, JSON.stringify(messageIds));
  }

  function status(meetingId) {
    const row = db.prepare('SELECT * FROM minutes_status WHERE meeting_id = ?').get(meetingId);
    return {
      error: row?.error == null ? null : String(row.error),
      incompleteOutput: row?.incomplete_output == null ? null : String(row.incomplete_output),
      exportPath: row?.export_path == null ? null : String(row.export_path),
      exportError: row?.export_error == null ? null : String(row.export_error),
      workbenchError: row?.workbench_error == null ? null : String(row.workbench_error),
    };
  }

  function patchStatus(meetingId, changes) {
    const value = { ...status(meetingId), ...changes };
    db.prepare(
      `INSERT INTO minutes_status (meeting_id, error, incomplete_output, export_path, export_error, workbench_error, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(meeting_id) DO UPDATE SET error = excluded.error,
      incomplete_output = excluded.incomplete_output, export_path = excluded.export_path, export_error = excluded.export_error,
      workbench_error = excluded.workbench_error, updated_at = excluded.updated_at`,
    ).run(
      meetingId,
      value.error,
      value.incompleteOutput,
      value.exportPath,
      value.exportError,
      value.workbenchError,
      new Date().toISOString(),
    );
    const meeting = core.meetings.get(meetingId);
    core.events.record(
      'minutes.status',
      { meetingId, ...value },
      { meetingId, projectId: meeting.projectId, actorId: 'agent_secretary' },
    );
  }

  return { currentRevision, state, save, status, patchStatus };
}
