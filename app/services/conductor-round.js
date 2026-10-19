// Ordered discussion scheduling is kept separate from direct answers.
// Both use the same runner and per-meeting queue.

/**
 * @param {{core:import("../core/index.js").Core,runner:ReturnType<typeof import("./turn-runner.js").createTurnRunner>,join:(meetingId:string,participantId:string)=>Promise<any>,meeting:any,message:any,signal:AbortSignal}} dependencies
 */
export async function runRound({ core, runner, join, meeting, message, signal }) {
  const eligible = new Map();
  for (const row of core.participants.list()) {
    if (row.kind !== 'ai') continue;
    const participant = await core.participants.get(row.id);
    if (
      participant.definition?.enabled &&
      ['expert', 'reviewer'].includes(participant.definition.panel)
    )
      eligible.set(row.id, participant);
  }
  const reviewer = eligible.get(meeting.policy.reviewer);
  const order = [...new Set(meeting.policy.order ?? [])].filter(
    (id) => id !== reviewer?.id && eligible.get(id)?.definition.panel === 'expert',
  );
  for (const participantId of order) {
    if (signal.aborted) return;
    await join(meeting.id, participantId);
  }
  if (signal.aborted) return;
  const reserved = order.map((participantId) =>
    runner.reserve({
      meetingId: meeting.id,
      participantId,
      triggerMessageId: message.id,
      discussion: { kind: 'expert', triggerMessageId: message.id, cutoffSeq: message.seq },
    }),
  );
  await Promise.all(
    reserved.map((entry) =>
      runner.run({
        meetingId: meeting.id,
        participantId: entry.turn.participantId,
        triggerMessageId: message.id,
        reserved: entry,
        cutoffSeq: message.seq,
        signal,
      }),
    ),
  );
  if (signal.aborted) return;
  if (!reviewer) {
    finishRound(core, meeting, message);
    return;
  }
  await join(meeting.id, reviewer.id);
  if (signal.aborted) return;
  const review = runner.reserve({
    meetingId: meeting.id,
    participantId: reviewer.id,
    triggerMessageId: message.id,
    discussion: { kind: 'review', triggerMessageId: message.id, cutoffSeq: message.seq },
  });
  await runner.run({
    meetingId: meeting.id,
    participantId: reviewer.id,
    triggerMessageId: message.id,
    reserved: review,
    cutoffSeq: message.seq,
    reviewMessageIds: reserved.map((entry) => entry.answer.id),
    signal,
  });
  if (!signal.aborted) finishRound(core, meeting, message);
}

/** The secretary subscribes to completion rather than guessing from individual answers. */
function finishRound(core, meeting, message) {
  core.db.transaction(() =>
    core.events.record(
      'discussion.finished',
      { triggerMessageId: message.id },
      {
        meetingId: meeting.id,
        projectId: meeting.projectId,
      },
    ),
  );
}
