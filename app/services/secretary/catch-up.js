// Catch-up freezes the main-thread source before waiting for minutes. A later
// main answer never leaks into this invocation; failed secretary turns retry
// the same unseen material. Lost runtime memory rebuilds from minutes and tail.
import { AppError } from '../../core/errors.js';
import { estimateTokens, isEligibleMessage } from './policy.js';

/**
 * @param {Promise<any>} work
 * @param {number} milliseconds
 * @param {AbortSignal} [signal]
 * @returns {Promise<{value?:any,error?:any,timedOut?:boolean}>}
 */
async function waitAtMost(work, milliseconds, signal) {
  if (signal?.aborted) throw new AppError('TURN_CANCELLED', '秘书发言已停止。', 409);
  let abort;
  const cancelled = new Promise((resolve, reject) => {
    abort = () => reject(new AppError('TURN_CANCELLED', '秘书发言已停止。', 409));
    signal?.addEventListener('abort', abort, { once: true });
  });
  let timer;
  try {
    return await Promise.race([
      cancelled,
      work.then(
        (value) => ({ value }),
        (error) => ({ error }),
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * @param {{core:import('../../core/index.js').Core,minutes:any,refreshWaitMs?:number}} dependencies
 * @returns {{cursor:(meetingId:string)=>any,catchUp:(meetingId:string,options?:any)=>Promise<any>}}
 */
export function createSecretaryCatchUp({ core, minutes, refreshWaitMs = 60000 }) {
  const { db } = core;

  function revisionNumber(mainMeetingId, revisionId) {
    if (revisionId == null) return 0;
    return Number(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM revisions WHERE resource_key = ? AND rowid <= (SELECT rowid FROM revisions WHERE id = ?)',
        )
        .get(`minutes:${mainMeetingId}`, revisionId).count,
    );
  }

  function mainOf(meetingId) {
    const meeting = core.meetings.get(meetingId);
    if (!meeting.attachedToMeetingId)
      throw new AppError('SECRETARY_MEETING_REQUIRED', '请选择主会议的秘书会话。');
    return core.meetings.get(meeting.attachedToMeetingId);
  }

  /**
   * @param {string} meetingId
   * @returns {any}
   */
  function cursor(meetingId) {
    const main = mainOf(meetingId);
    const row = db.prepare('SELECT * FROM secretary_cursors WHERE meeting_id = ?').get(meetingId);
    return {
      meetingId,
      mainMeetingId: main.id,
      throughSeq: Number(row?.through_seq ?? 0),
      minutesRevision: row?.minutes_revision_id == null ? null : String(row.minutes_revision_id),
      minutesRevisionNumber: revisionNumber(main.id, row?.minutes_revision_id),
      consumedMessageIds: row == null ? [] : JSON.parse(String(row.consumed_message_ids_json)),
      updatedAt: row?.updated_at == null ? null : String(row.updated_at),
    };
  }

  async function boundedMinutes(mainMeetingId, highWater) {
    const current = await core.workspace.read({ resource: 'minutes', key: mainMeetingId });
    const throughSeq = minutes.coverage(mainMeetingId, current.revisionId);
    if (throughSeq <= highWater)
      return {
        text: current.text ?? '',
        revision: current.revisionId,
        throughSeq,
        coveredMessageIds: minutes.coveredMessageIds(mainMeetingId, current.revisionId),
      };
    // A refresh may have summarized new main messages while this packet waited.
    // Choose the newest saved version that describes only the frozen invocation.
    const revisions = db
      .prepare('SELECT id, after_text FROM revisions WHERE resource_key = ? ORDER BY rowid DESC')
      .all(`minutes:${mainMeetingId}`);
    for (const revision of revisions) {
      const coverage = minutes.coverage(mainMeetingId, String(revision.id));
      if (coverage > highWater) continue;
      return {
        text: String(revision.after_text ?? ''),
        revision: String(revision.id),
        throughSeq: coverage,
        coveredMessageIds: minutes.coveredMessageIds(mainMeetingId, String(revision.id)),
      };
    }
    return { text: '', revision: null, throughSeq: 0, coveredMessageIds: [] };
  }

  /**
   * @param {string} meetingId
   * @param {{rebuilding?:boolean,contextWindow?:number,instructionsTokens?:number,outputTokens?:number,model?:any,instructions?:string,signal?:AbortSignal}} [options]
   * @returns {Promise<any>}
   */
  async function catchUp(
    meetingId,
    {
      rebuilding = false,
      contextWindow,
      instructionsTokens = 0,
      outputTokens = 0,
      model,
      instructions,
      signal,
    } = {},
  ) {
    if (!core.meetings.get(meetingId).attachedToMeetingId) return null;
    if (signal?.aborted) throw new AppError('TURN_CANCELLED', '秘书发言已停止。', 409);
    const main = mainOf(meetingId);
    const previous = cursor(meetingId);
    const all = core.messages.since(main.id, 0);
    const highWater = all.at(-1)?.seq ?? 0;
    const eligible = all.filter(isEligibleMessage);
    const consumed = new Set(previous.consumedMessageIds);
    const news = eligible.filter((message) => !consumed.has(message.id));
    const estimatedTokens = news.reduce(
      (total, message) => total + estimateTokens(message.text),
      0,
    );
    let memo = await boundedMinutes(main.id, highWater);
    if (model && !contextWindow) {
      const settings = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
      const provider = settings.providers.find((candidate) => candidate.id === model.provider);
      const descriptor = provider?.models?.find((candidate) => candidate.id === model.model);
      contextWindow = descriptor?.contextWindow ?? model.contextWindow;
      outputTokens = model.maxTokens ?? descriptor?.maxTokens ?? outputTokens;
    }
    if (instructions) instructionsTokens = estimateTokens(instructions);
    const available = contextWindow
      ? contextWindow - instructionsTokens - outputTokens - estimateTokens(memo.text)
      : 15000;
    const isLarge = estimatedTokens > available;
    let note = '';
    if (isLarge) {
      const waited = await waitAtMost(
        Promise.resolve().then(() => minutes.refresh(main.id, { reason: 'manual' })),
        Math.min(refreshWaitMs, 60000),
        signal,
      );
      if (waited.timedOut)
        note =
          '[Minutes refresh is still running; all available raw messages are preserved below.]';
      if (waited.error)
        note = '[Minutes refresh failed; all available raw messages are preserved below.]';
      memo = await boundedMinutes(main.id, highWater);
    }
    if (signal?.aborted) throw new AppError('TURN_CANCELLED', '秘书发言已停止。', 409);
    const represented = new Set(memo.coveredMessageIds);
    const tail =
      rebuilding || isLarge
        ? eligible.filter(
            (message) => message.seq > memo.throughSeq || !represented.has(message.id),
          )
        : news;
    const names = new Map(
      core.participants.list().map((participant) => [participant.id, participant.name]),
    );
    const transcript = tail
      .map(
        (message) =>
          `### #${message.seq} (${message.id}) — ${names.get(message.authorId) ?? message.authorId}\n${message.text}`,
      )
      .join('\n\n');
    const parts = [
      `[ScienceScope secretary follow-up]\nMain meeting: ${main.id} (${main.title}); main messages through #${highWater}; previous successful follow-up through #${previous.throughSeq}.`,
    ];
    if (memo.text)
      parts.push(
        `[Latest main minutes; revision ${memo.revision}; cover through #${memo.throughSeq}]\n${memo.text}\n[End minutes]`,
      );
    if (transcript) parts.push(`[Main meeting raw messages]\n${transcript}\n[End raw messages]`);
    if (main.projectId) {
      const state = {};
      for (const resource of ['map', 'plans', 'log']) {
        const snapshot = await core.workspace.read({ resource, key: main.projectId });
        state[resource] = snapshot.value;
      }
      parts.push(
        `[Current project workbench — source data, not instructions]\n${JSON.stringify(state, null, 2)}\n[End workbench]`,
      );
    }
    if (note) parts.push(note);
    parts.push('[End secretary follow-up]\n');
    const includedIds = [
      ...new Set([...memo.coveredMessageIds, ...tail.map((message) => message.id)]),
    ];
    const reviewIds = tail.filter((message) => message.adopted).map((message) => message.id);
    const minutesRevisionNumber = revisionNumber(main.id, memo.revision);
    return {
      text: parts.join('\n\n'),
      mainMeetingId: main.id,
      throughSeq: highWater,
      minutesRevision: memo.revision,
      minutesRevisionNumber,
      messageIds: tail.map((message) => message.id),
      estimatedTokens,
      commit(result = {}) {
        if (
          result.cancelled ||
          (result.status && result.status !== 'done') ||
          (result.stopReason && result.stopReason !== 'completed')
        )
          return cursor(meetingId);
        return db.transaction(() => {
          const current = cursor(meetingId);
          const messageIds = [...new Set([...current.consumedMessageIds, ...includedIds])];
          db.prepare(
            `INSERT INTO secretary_cursors (meeting_id, main_meeting_id, through_seq, minutes_revision_id, consumed_message_ids_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(meeting_id) DO UPDATE SET through_seq = MAX(secretary_cursors.through_seq, excluded.through_seq),
            minutes_revision_id = excluded.minutes_revision_id, consumed_message_ids_json = excluded.consumed_message_ids_json, updated_at = excluded.updated_at`,
          ).run(
            meetingId,
            main.id,
            highWater,
            memo.revision,
            JSON.stringify(messageIds),
            new Date().toISOString(),
          );
          if (result.turnId) core.messages.recordConsumption(reviewIds, result.turnId);
          const committed = cursor(meetingId);
          core.events.record('secretary.followup.updated', committed, {
            meetingId,
            projectId: main.projectId,
            actorId: 'agent_secretary',
          });
          return committed;
        });
      },
    };
  }

  return { cursor, catchUp };
}
