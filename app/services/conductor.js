// The conductor decides who speaks after a person posts in a meeting, by the
// meeting's speaking policy, and runs those turns. R2 implements `direct`:
// mentioned AIs answer in order of mention, otherwise the meeting's default
// respondent (or its first AI member). `round` and `autonomous` come in R4.
import { mentionedParticipants } from '../core/context.js';
import { AppError } from '../core/errors.js';

/**
 * @param {{ core: import('../core/index.js').Core,
 *   runner: ReturnType<typeof import('./turn-runner.js').createTurnRunner> }} deps
 */
export function createConductor({ core, runner }) {
  /** @type {Map<string, Promise<unknown>>} one queue per meeting, so turns don't interleave */
  const queues = new Map();
  /** @type {Set<Promise<unknown>>} */
  const pending = new Set();

  function enqueue(meetingId, work) {
    const previous = queues.get(meetingId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.catch((error) => console.error('Turn failed', error));
    queues.set(meetingId, settled);
    pending.add(settled);
    settled.finally(() => pending.delete(settled));
    return next;
  }

  /** @param {import('../core/meetings.js').Meeting} meeting @param {string} text */
  async function respondents(meeting, text) {
    const ais = [];
    for (const member of meeting.members) {
      const participant = await core.participants.get(member.participantId);
      if (participant.kind === 'ai') ais.push({ id: participant.id, name: participant.name });
    }
    if (!ais.length) return [];
    const mentioned = mentionedParticipants(text, ais);
    if (mentioned.length) return mentioned;
    const preferred = meeting.policy.respondent;
    return [preferred && ais.some((ai) => ai.id === preferred) ? preferred : ais[0].id];
  }

  /**
   * React to a message: when a person speaks, the chosen AIs answer.
   * @param {import('../core/messages.js').Message} message
   */
  async function onMessage(message) {
    const author = core.participants
      .list()
      .find((participant) => participant.id === message.authorId);
    if (author?.kind !== 'human') return;
    const meeting = core.meetings.get(message.meetingId);
    for (const participantId of await respondents(meeting, message.text)) {
      enqueue(meeting.id, () =>
        runner.run({ meetingId: meeting.id, participantId, triggerMessageId: message.id }),
      );
    }
  }

  /** Close turns left running when the program stopped mid-answer. */
  function recoverInterrupted() {
    for (const turn of core.turns.running()) {
      for (const message of core.messages.since(turn.meetingId, 0)) {
        if (message.turnId === turn.id && message.status === 'streaming') {
          core.messages.update(message.id, { status: 'cancelled' });
        }
      }
      core.turns.end(turn.id, { status: 'cancelled', stopReason: 'restart' });
    }
  }

  let unsubscribe = () => {};

  return {
    start() {
      recoverInterrupted();
      unsubscribe = core.events.subscribe((event) => {
        if (event.type !== 'message.created') return;
        // Choosing respondents is async; track it so `idle()` waits for it too.
        const dispatch = onMessage(event.payload).catch((error) =>
          console.error('Could not start turns', error),
        );
        pending.add(dispatch);
        dispatch.finally(() => pending.delete(dispatch));
      });
    },
    stop: () => unsubscribe(),
    /**
     * Answer again after a failed or stopped answer: the same participant
     * responds to the same message, in a new turn.
     * @param {string} messageId The failed answer.
     */
    retry(messageId) {
      const message = core.messages.get(messageId);
      if (!message.turnId) throw new AppError('NOT_AN_ANSWER', '只能重试 AI 的回答。');
      const turn = core.turns.get(message.turnId);
      return enqueue(message.meetingId, () =>
        runner.run({
          meetingId: message.meetingId,
          participantId: turn.participantId,
          triggerMessageId: turn.triggerMessageId,
        }),
      );
    },
    /** @param {string} meetingId */
    interrupt: (meetingId) => runner.interrupt(meetingId),
    /** Resolves when every queued turn has finished (tests, shutdown). */
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}
