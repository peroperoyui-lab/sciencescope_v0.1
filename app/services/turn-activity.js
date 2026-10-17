import { randomUUID } from 'node:crypto';

/**
 * One activity stream per turn. Thinking updates are projections; keep the
 * complete segment while throttling database/event writes to twice a second.
 * @param {import('../core/index.js').Core} core
 * @param {string} turnId
 */
export function createTurnActivity(core, turnId) {
  let thinking;
  let timer;
  function finish() {
    clearTimeout(timer);
    timer = null;
    if (thinking)
      core.turns.endToolCall(turnId, thinking.id, { result: thinking.text, isError: false });
    thinking = null;
  }
  return {
    finish,
    onEvent(event) {
      if (event.type === 'phase') {
        if (event.phase !== 'thinking') finish();
        core.turns.setPhase(turnId, event.phase);
        return true;
      }
      if (event.type === 'thinking-delta') {
        if (!thinking) {
          thinking = { id: randomUUID(), text: '' };
          core.turns.startToolCall({
            turnId,
            callId: thinking.id,
            name: 'thinking',
            kind: 'thinking',
            args: null,
          });
        }
        thinking.text += event.delta;
        if (!timer)
          timer = setTimeout(() => {
            timer = null;
            core.turns.updateActivity(turnId, thinking.id, thinking.text);
          }, 500);
        return true;
      }
      finish();
      if (event.type === 'compaction') {
        const callId = randomUUID();
        core.turns.startToolCall({
          turnId,
          callId,
          name: 'compaction',
          kind: 'compaction',
          args: null,
        });
        core.turns.endToolCall(turnId, callId, {
          result: { beforeTokens: event.beforeTokens, afterTokens: event.afterTokens },
          isError: false,
        });
        return true;
      }
      if (event.type === 'retry') {
        const { attempt, maxAttempts, error } = event;
        const callId = randomUUID();
        core.turns.startToolCall({ turnId, callId, name: 'retry', kind: 'retry', args: null });
        core.turns.endToolCall(turnId, callId, {
          result: { attempt, maxAttempts, error },
          isError: false,
        });
        return true;
      }
      return false;
    },
  };
}
