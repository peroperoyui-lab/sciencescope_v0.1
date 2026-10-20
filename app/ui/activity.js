// Status is derived from foreground turns and durable queued input.
// Summary/background secretary turns do not represent a running chat reply.
/**
 * @param {import('./state.js').State} state
 * @param {string} meetingId
 * @returns {{status:string,updatedAt:string}|null}
 */
export function meetingActivity(state, meetingId) {
  const running = Object.values(state.running).find(
    (turn) => turn.meetingId === meetingId && turn.participantId !== 'agent_secretary',
  );
  if (running) {
    const asking = (state.toolCalls[running.id] ?? []).some(
      (call) => call.kind === 'approval' && call.status === 'pending',
    );
    return { status: asking ? 'approval' : 'running', updatedAt: running.startedAt };
  }
  const outbox = state.outboxes[meetingId];
  if (outbox?.items.length)
    return { status: outbox.paused ? 'paused' : 'queued', updatedAt: outbox.items[0].updatedAt };
  const latest = Object.values(state.turns)
    .filter((turn) => turn.meetingId === meetingId && turn.participantId !== 'agent_secretary')
    .sort((left, right) => (right.endedAt ?? '').localeCompare(left.endedAt ?? ''))[0];
  if (latest?.status === 'failed' && state.acknowledgedActivity[meetingId] !== latest.endedAt)
    return { status: 'failed', updatedAt: latest.endedAt };
  return null;
}

export const ACTIVITY_LABELS = {
  running: '运行中',
  approval: '待批准',
  queued: '排队中',
  paused: '已暂停',
  failed: '失败',
};
