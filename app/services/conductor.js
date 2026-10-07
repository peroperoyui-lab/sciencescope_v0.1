// The conductor decides who speaks after a person posts in a meeting, by the
// meeting's speaking policy (docs/design/CORE_MODEL.md §6), and runs those turns.
// Each meeting has one queue of requests, so requests never interleave.
// - `direct` ("工作"): @-mentioned AIs answer in order of mention, otherwise the
//   default respondent. Enabled panel experts can be @-mentioned without being
//   members; they join the meeting when they first speak.
// - `round` ("有序讨论"): the experts in `policy.order` answer in parallel, all
//   cut off at the same person's message; their answers are created up front in
//   that order. The reviewer runs after every expert has ended, and its answer
//   stays out of later context until the person adopts it.
import { mentionedParticipants } from '../core/context.js';
import { AppError } from '../core/errors.js';

/**
 * @param {{ core: import('../core/index.js').Core,
 *   runner: ReturnType<typeof import('./turn-runner.js').createTurnRunner> }} deps
 */
export function createConductor({ core, runner }) {
  /** @type {Map<string, Promise<unknown>>} meeting id → tail of its request queue */
  const queues = new Map();
  /** @type {Set<Promise<unknown>>} */
  const pending = new Set();
  /** @type {Map<string, Set<AbortController>>} meeting id → requests "停止" cancels */
  const requests = new Map();
  /** @type {Map<string, AbortController>} */
  const activeRequests = new Map();
  let isStarted = false;

  function isBusy(meetingId) {
    return queues.has(meetingId);
  }

  function drainOutbox(meetingId) {
    if (!isStarted || isBusy(meetingId)) return;
    core.outbox.dispatch(meetingId);
  }

  function enqueue(meetingId, work) {
    const controller = new AbortController();
    const controllers = requests.get(meetingId) ?? new Set();
    controllers.add(controller);
    requests.set(meetingId, controllers);
    const previous = queues.get(meetingId) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (controller.signal.aborted) return;
      activeRequests.set(meetingId, controller);
      try {
        return await work(controller.signal);
      } finally {
        if (activeRequests.get(meetingId) === controller) activeRequests.delete(meetingId);
      }
    });
    const settled = next.catch((error) => console.error('Turn failed', error));
    queues.set(meetingId, settled);
    pending.add(settled);
    settled.finally(() => {
      pending.delete(settled);
      controllers.delete(controller);
      if (!controllers.size) requests.delete(meetingId);
      if (queues.get(meetingId) === settled) queues.delete(meetingId);
      drainOutbox(meetingId);
    });
    return next;
  }

  /** AIs a person may address in `direct`: members plus enabled panel experts (not reviewers). */
  async function candidates(meeting) {
    const members = new Set(meeting.members.map((member) => member.participantId));
    const result = [];
    for (const row of core.participants.list()) {
      if (row.kind !== 'ai') continue;
      const participant = await core.participants.get(row.id);
      if (participant.definition.panel === 'reviewer') continue;
      if (
        members.has(row.id) ||
        (participant.definition.panel === 'expert' && participant.definition.enabled)
      )
        result.push(participant);
    }
    return result;
  }

  async function join(meetingId, participantId) {
    const participant = await core.participants.get(participantId);
    core.meetings.addMember(meetingId, {
      participantId,
      roleNote: participant.definition?.role ?? '',
    });
    return participant;
  }

  async function runDirect(meeting, message, signal) {
    const available = await candidates(meeting);
    const mentioned = mentionedParticipants(message.text, available);
    const members = available.filter((participant) =>
      meeting.members.some((member) => member.participantId === participant.id),
    );
    const preferred = meeting.policy.respondent ?? 'agent_main';
    const selected = mentioned.length
      ? mentioned
      : members.length
        ? [members.find((participant) => participant.id === preferred)?.id ?? members[0].id]
        : [];
    for (const participantId of selected) {
      if (signal.aborted) return;
      await join(meeting.id, participantId);
      await runner.run({
        meetingId: meeting.id,
        participantId,
        triggerMessageId: message.id,
        cutoffSeq: message.seq,
        signal,
      });
    }
  }

  async function runRound(meeting, message, signal) {
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
      finishRound(meeting, message);
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
    if (!signal.aborted) finishRound(meeting, message);
  }

  /** The secretary subscribes to completion rather than guessing from individual answers. */
  function finishRound(meeting, message) {
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

  function onMessage(message) {
    const author = core.participants
      .list()
      .find((participant) => participant.id === message.authorId);
    if (author?.kind !== 'human') return;
    const meeting = core.meetings.get(message.meetingId);
    enqueue(meeting.id, (signal) =>
      meeting.policy.mode === 'round'
        ? runRound(meeting, message, signal)
        : runDirect(meeting, message, signal),
    );
  }

  /** Close turns left running when the program stopped mid-answer. */
  function recoverInterrupted() {
    for (const turn of core.turns.running()) {
      for (const message of core.messages.since(turn.meetingId, 0)) {
        if (message.turnId === turn.id && message.status === 'streaming')
          core.messages.update(message.id, { status: 'cancelled' });
      }
      core.turns.end(turn.id, { status: 'cancelled', stopReason: 'restart' });
    }
  }

  /**
   * Retry or continue one AI answer: only that participant answers again, with
   * the same cut-off; a review sees the same round's expert answers again.
   * @param {string} messageId @param {boolean} continuation
   */
  function targeted(messageId, continuation) {
    const message = core.messages.get(messageId);
    if (!message.turnId) throw new AppError('NOT_AN_ANSWER', '只能继续或重试 AI 的回答。');
    const turn = core.turns.get(message.turnId);
    const discussion = message.refs?.discussion;
    return enqueue(message.meetingId, async (signal) => {
      const reserved = runner.reserve({
        meetingId: message.meetingId,
        participantId: turn.participantId,
        triggerMessageId: turn.triggerMessageId,
        discussion:
          discussion && continuation ? { ...discussion, continuedFrom: message.id } : discussion,
      });
      const peers =
        discussion?.kind === 'review'
          ? core.messages
              .since(message.meetingId, 0)
              .filter(
                (entry) =>
                  entry.refs?.discussion?.kind === 'expert' &&
                  entry.refs.discussion.triggerMessageId === discussion.triggerMessageId,
              )
              .map((entry) => entry.id)
          : undefined;
      return runner.run({
        meetingId: message.meetingId,
        participantId: turn.participantId,
        triggerMessageId: turn.triggerMessageId,
        reserved,
        cutoffSeq: continuation
          ? message.seq
          : (discussion?.cutoffSeq ??
            (turn.triggerMessageId ? core.messages.get(turn.triggerMessageId).seq : undefined)),
        reviewMessageIds: peers,
        continuation,
        retry: !continuation,
        continuationMessageId: continuation ? message.id : undefined,
        signal,
      });
    });
  }

  let unsubscribe = null;
  return {
    start() {
      if (unsubscribe) return;
      recoverInterrupted();
      isStarted = true;
      unsubscribe = core.events.subscribe((event) => {
        if (event.type === 'message.created') onMessage(event.payload);
        if (event.type === 'meeting.outbox.changed') drainOutbox(event.meetingId);
      });
    },
    stop() {
      isStarted = false;
      unsubscribe?.();
      unsubscribe = null;
      for (const controllers of requests.values())
        for (const controller of controllers) controller.abort();
    },
    /** @param {string} messageId */
    retry: (messageId) => targeted(messageId, false),
    /** @param {string} messageId */
    continue: (messageId) => targeted(messageId, true),
    /** @param {string} meetingId */
    async interrupt(meetingId) {
      if (core.meetings.get(meetingId).policy.mode === 'round') {
        for (const controller of requests.get(meetingId) ?? []) controller.abort();
      } else activeRequests.get(meetingId)?.abort();
      await runner.interrupt(meetingId);
    },
    /**
     * @param {{meetingId:string,authorId:string,text:string,refs?:any,replyTo?:string|null}} input
     */
    submit(input) {
      const state = core.outbox.list(input.meetingId);
      if (isBusy(input.meetingId) || state.items.length || state.paused) {
        const queued = core.outbox.enqueue(input);
        return { queued: true, ...queued };
      }
      return core.messages.post(input);
    },
    /** Resolves when every queued turn has finished (tests, shutdown). */
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}
