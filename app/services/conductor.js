// The conductor decides who speaks after a person posts in a meeting, by the
// meeting's speaking policy (docs/architecture/CORE_MODEL.md §6), and runs those turns.
// Each meeting has one queue of requests, so requests never interleave.
// - `direct` ("工作"): @-mentioned AIs answer concurrently, displayed in mention order, otherwise the
//   default respondent. Enabled panel experts can be @-mentioned without being
//   members; they join the meeting when they first speak.
// - `round` ("有序讨论"): the experts in `policy.order` answer in parallel, all
//   cut off at the same person's message; their answers are created up front in
//   that order. The reviewer runs after every expert has ended, and its answer
//   stays out of later context until the person adopts it.
// - `autonomous` ("自动化"): the respondent keeps working toward the meeting's
//   goal one turn after another, until it calls `goal_update`, the person pauses
//   or ends it, the round limit is reached or a turn fails. Messages the person
//   sends meanwhile wait in the outbox and join the next turn's input.
import { mentionedParticipants, mentionedInputs } from '../core/context.js';
import { AppError } from '../core/errors.js';
import { runRound } from './conductor-round.js';

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
  // Dispatching drafts during automation only appends input. It must not
  // enqueue separate answers in addition to the next goal turn.
  const collectingInputs = new Set();
  let isStarted = false;

  function isBusy(meetingId) {
    return queues.has(meetingId);
  }

  function drainOutbox(meetingId) {
    if (!isStarted || isBusy(meetingId)) return;
    const goal = core.goals.get(meetingId);
    if (goal && ['running', 'paused', 'blocked'].includes(goal.status)) return;
    core.outbox.dispatch(meetingId);
  }

  function collectInputs(meetingId) {
    collectingInputs.add(meetingId);
    try {
      while (core.outbox.dispatch(meetingId)) {
        /* all ready drafts enter this turn */
      }
    } finally {
      collectingInputs.delete(meetingId);
    }
  }

  async function runAutonomous(meetingId, signal) {
    try {
      while (isStarted && !signal.aborted) {
        const goal = core.goals.get(meetingId);
        if (goal?.status !== 'running') return;
        if (goal.rounds >= goal.maxRounds) {
          core.goals.update(meetingId, {
            status: 'paused',
            reason: '已达到设置的最多轮数，请调整轮数后继续。',
          });
          return;
        }
        collectInputs(meetingId);
        const meeting = core.meetings.get(meetingId);
        if (meeting.policy.mode !== 'autonomous') {
          core.goals.update(meetingId, {
            status: 'paused',
            reason: '发言模式已更改，请确认后继续。',
          });
          return;
        }
        core.goals.update(meetingId, { rounds: goal.rounds + 1 });
        const participantId = meeting.policy.respondent ?? 'agent_main';
        await join(meetingId, participantId);
        const latest = core.messages.since(meetingId, 0).at(-1);
        const result = await runner.run({
          meetingId,
          participantId,
          cutoffSeq: latest?.seq,
          signal,
        });
        const current = core.goals.get(meetingId);
        if (result?.status !== 'done' && ['running', 'paused'].includes(current.status)) {
          const answer = core.messages
            .since(meetingId, 0)
            .find((message) => message.turnId === result?.id);
          core.goals.update(meetingId, {
            status: 'paused',
            reason: answer?.text || '这轮回答未完成，请检查后继续。',
          });
          return;
        }
        if (current.status !== 'running') return;
        // Yield to HTTP pause/end requests even when a scripted turn resolves
        // immediately. Real model execution already yields while streaming.
        await new Promise((resolve) => setImmediate(resolve));
      }
    } catch (error) {
      if (core.goals.get(meetingId)?.status === 'running')
        core.goals.update(meetingId, { status: 'paused', reason: error.message });
    }
  }

  function scheduleGoal(meetingId) {
    if (isStarted && !isBusy(meetingId))
      void enqueue(meetingId, (signal) => runAutonomous(meetingId, signal));
  }

  function resumeGoal(meetingId) {
    core.goals.ensureEligible(meetingId);
    const goal = core.goals.get(meetingId);
    if (!goal || !['paused', 'blocked'].includes(goal.status))
      throw new AppError('GOAL_NOT_PAUSED', '请先暂停目标，再继续。');
    const updated = core.goals.update(meetingId, { status: 'running', reason: '' });
    scheduleGoal(meetingId);
    return updated;
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
      if (core.goals.get(meetingId)?.status === 'running') scheduleGoal(meetingId);
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
    if (selected.length > 1) {
      const inputs = mentionedInputs(message.text, available);
      for (const participantId of selected) {
        if (signal.aborted) return;
        await join(meeting.id, participantId);
      }
      if (signal.aborted) return;
      const reserved = selected.map((participantId) =>
        runner.reserve({
          meetingId: meeting.id,
          participantId,
          triggerMessageId: message.id,
          discussion: {
            kind: 'mention',
            triggerMessageId: message.id,
            cutoffSeq: message.seq,
            input: inputs.get(participantId),
          },
        }),
      );
      await Promise.all(
        reserved.map((entry) =>
          runner.run({
            meetingId: meeting.id,
            participantId: entry.turn.participantId,
            triggerMessageId: message.id,
            cutoffSeq: message.seq,
            triggerText: entry.answer.refs.discussion.input,
            reserved: entry,
            signal,
          }),
        ),
      );
      return;
    }
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

  function onMessage(message) {
    const author = core.participants
      .list()
      .find((participant) => participant.id === message.authorId);
    if (author?.kind !== 'human') return;
    if (collectingInputs.has(message.meetingId)) return;
    const meeting = core.meetings.get(message.meetingId);
    if (meeting.policy.mode === 'autonomous') {
      let goal = core.goals.get(meeting.id);
      if (!goal) goal = core.goals.start(meeting.id, meeting.policy.goal ?? message.text);
      if (goal.status === 'blocked') resumeGoal(meeting.id);
      else if (goal.status === 'running') scheduleGoal(meeting.id);
      if (['running', 'paused', 'blocked'].includes(goal.status)) return;
    }
    enqueue(meeting.id, (signal) =>
      meeting.policy.mode === 'round'
        ? runRound({ core, runner, join, meeting, message, signal })
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
        triggerText: discussion?.kind === 'mention' ? discussion.input : undefined,
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
      if (core.goals.get(meetingId)?.status === 'running')
        core.goals.update(meetingId, { status: 'paused', reason: '当前回答已停止，请继续目标。' });
      if (core.meetings.get(meetingId).policy.mode === 'round') {
        for (const controller of requests.get(meetingId) ?? []) controller.abort();
      } else activeRequests.get(meetingId)?.abort();
      await runner.interrupt(meetingId);
    },
    /**
     * @param {{meetingId:string,authorId:string,text:string,refs?:any,researchInput?:any,replyTo?:string|null}} input
     */
    submit(input) {
      const state = core.outbox.list(input.meetingId);
      const goal = core.goals.get(input.meetingId);
      if (
        isBusy(input.meetingId) ||
        state.items.length ||
        state.paused ||
        goal?.status === 'paused'
      ) {
        const queued = core.outbox.enqueue(input);
        if (goal?.status === 'blocked') resumeGoal(input.meetingId);
        return { queued: true, ...queued };
      }
      return core.messages.post(input);
    },
    /**
     * @param {string} meetingId
     * @param {{text:string,maxRounds?:number,researchInput?:any}} options
     */
    startGoal(meetingId, { text, maxRounds = 30, researchInput }) {
      if (isBusy(meetingId)) throw new AppError('MEETING_BUSY', '请等当前回答结束，再设定目标。');
      return core.db.transaction(() => {
        const goal = core.goals.start(meetingId, text, maxRounds);
        core.messages.post({ meetingId, authorId: 'person_user', text, researchInput });
        return goal;
      });
    },
    /**
     * @param {string} meetingId
     * @param {{action?:string,maxRounds?:number}} options
     */
    async controlGoal(meetingId, { action, maxRounds }) {
      if (maxRounds !== undefined) core.goals.update(meetingId, { maxRounds });
      if (action === 'resume') return resumeGoal(meetingId);
      if (action === 'pause')
        return core.goals.update(meetingId, { status: 'paused', reason: '用户已暂停目标。' });
      if (action === 'end') {
        const goal = core.goals.update(meetingId, { status: 'ended', reason: '用户已结束目标。' });
        activeRequests.get(meetingId)?.abort();
        await runner.interrupt(meetingId);
        return goal;
      }
      return core.goals.get(meetingId);
    },
    /** Resolves when every queued turn has finished (tests, shutdown). */
    async idle() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}
