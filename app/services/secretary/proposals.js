// A draft is a card in the originating chat, never a main-thread message.
// Every edit/decision records the prior state so changing a card is reversible.
import { AppError } from '../../core/errors.js';
import { newId } from '../../core/ids.js';

function proposalFrom(row) {
  return {
    id: String(row.id),
    meetingId: String(row.meeting_id),
    mainMeetingId: String(row.main_meeting_id),
    text: String(row.text),
    status: String(row.status),
    actorId: String(row.actor_id),
    turnId: row.turn_id == null ? null : String(row.turn_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * @param {import('../../core/index.js').Core} core
 * @returns {{propose:(context:any,args:any)=>any,decide:(id:string,changes:any)=>any,list:(mainMeetingId:string)=>any[],undo:(historyId:string)=>any,history:(proposalId:string)=>any[]}}
 */
export function createDraftProposals(core) {
  const { db } = core;

  function get(id) {
    const row = db.prepare('SELECT * FROM main_draft_proposals WHERE id = ?').get(id);
    if (!row) throw new AppError('PROPOSAL_NOT_FOUND', '找不到这份指令草稿。', 404);
    return proposalFrom(row);
  }

  function record(previous, proposal, actorId) {
    const historyId = newId('draftrev');
    db.prepare(
      'INSERT INTO main_draft_proposal_history (id, proposal_id, before_json, after_json, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      historyId,
      proposal.id,
      previous == null ? null : JSON.stringify(previous),
      JSON.stringify(proposal),
      actorId,
      new Date().toISOString(),
    );
    core.events.record(
      'secretary.proposal.updated',
      { ...proposal, historyId },
      {
        meetingId: proposal.meetingId,
        projectId: core.meetings.get(proposal.meetingId).projectId,
        actorId,
      },
    );
    return { ...proposal, historyId };
  }

  /**
   * @param {{meetingId:string,participantId:string,turnId?:string}} context
   * @param {{text:string,mainMeetingId?:string}} args
   * @returns {any}
   */
  function propose(context, { text, mainMeetingId }) {
    if (typeof text !== 'string' || !text.trim())
      throw new AppError('DRAFT_TEXT_REQUIRED', '请填写指令草稿。');
    const origin = core.meetings.get(context.meetingId);
    const mainId = mainMeetingId ?? origin.attachedToMeetingId ?? origin.id;
    const main = core.meetings.get(mainId);
    if (main.attachedToMeetingId)
      throw new AppError('MAIN_MEETING_REQUIRED', '请选择要填入指令的主会议。');
    return db.transaction(() => {
      const id = newId('draft');
      const time = new Date().toISOString();
      db.prepare(
        `INSERT INTO main_draft_proposals (id, meeting_id, main_meeting_id, text, status, actor_id, turn_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      ).run(id, origin.id, mainId, text, context.participantId, context.turnId ?? null, time, time);
      return record(null, get(id), context.participantId);
    });
  }

  /**
   * @param {string} id
   * @param {{text?:string,status?:'pending'|'filled'|'dismissed'}} changes
   * @returns {any}
   */
  function decide(id, changes) {
    const previous = get(id);
    const text = changes.text ?? previous.text;
    const status = changes.status ?? previous.status;
    if (typeof text !== 'string' || !text.trim())
      throw new AppError('DRAFT_TEXT_REQUIRED', '请填写指令草稿。');
    if (!['pending', 'filled', 'dismissed'].includes(status))
      throw new AppError('INVALID_PROPOSAL_STATUS', '指令草稿状态无效。');
    if (text === previous.text && status === previous.status) return previous;
    return db.transaction(() => {
      db.prepare(
        'UPDATE main_draft_proposals SET text = ?, status = ?, updated_at = ? WHERE id = ?',
      ).run(text, status, new Date().toISOString(), id);
      return record(previous, get(id), 'person_user');
    });
  }

  /**
   * @param {string} mainMeetingId
   * @returns {any[]}
   */
  function list(mainMeetingId) {
    core.meetings.get(mainMeetingId);
    return db
      .prepare('SELECT * FROM main_draft_proposals WHERE main_meeting_id = ? ORDER BY rowid')
      .all(mainMeetingId)
      .map(proposalFrom);
  }

  /**
   * @param {string} proposalId
   * @returns {any[]}
   */
  function history(proposalId) {
    get(proposalId);
    return db
      .prepare(
        'SELECT * FROM main_draft_proposal_history WHERE proposal_id = ? ORDER BY rowid DESC',
      )
      .all(proposalId)
      .map((row) => ({
        id: String(row.id),
        actorId: String(row.actor_id),
        before: row.before_json == null ? null : JSON.parse(String(row.before_json)),
        after: JSON.parse(String(row.after_json)),
        undoneBy: row.undone_by == null ? null : String(row.undone_by),
        createdAt: String(row.created_at),
      }));
  }

  /**
   * @param {string} historyId
   * @returns {any}
   */
  function undo(historyId) {
    const row = db
      .prepare('SELECT rowid, * FROM main_draft_proposal_history WHERE id = ?')
      .get(historyId);
    if (!row) throw new AppError('REVISION_NOT_FOUND', '找不到这条修改记录。', 404);
    if (row.undone_by != null) throw new AppError('ALREADY_UNDONE', '这条修改已经撤销过。', 409);
    const current = get(String(row.proposal_id));
    const original = JSON.parse(String(row.after_json));
    if (current.text !== original.text || current.status !== original.status)
      throw new AppError('REVISION_CONFLICT', '草稿之后还有新修改，请先撤销较新的修改。', 409);
    const before =
      row.before_json == null
        ? { ...current, status: 'dismissed' }
        : JSON.parse(String(row.before_json));
    return db.transaction(() => {
      db.prepare(
        'UPDATE main_draft_proposals SET text = ?, status = ?, updated_at = ? WHERE id = ?',
      ).run(before.text, before.status, new Date().toISOString(), current.id);
      const changed = record(current, get(current.id), 'person_user');
      db.prepare('UPDATE main_draft_proposal_history SET undone_by = ? WHERE id = ?').run(
        changed.historyId,
        historyId,
      );
      return changed;
    });
  }

  return { propose, decide, list, history, undo };
}
