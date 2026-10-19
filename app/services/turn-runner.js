// Runs one turn: one AI participant speaking once in a meeting.
// It resumes or rebuilds the participant's runtime
// session, streams the answer into a message, records tool calls and ends
// the turn with a status. See docs/architecture/CORE_MODEL.md §6–§7.
// Ordered rounds reserve their answers before starting, so the order in which
// experts finish never changes the order in which they are shown.
import { closeKnowledgeTurn } from './knowledge/versions.js';
import { AppError } from '../core/errors.js';
import { createTurnActivity } from './turn-activity.js';

/** @type {Record<string, 'done' | 'max_tokens' | 'cancelled' | 'failed'>} */
const STATUS_BY_STOP = {
  completed: 'done',
  max_tokens: 'max_tokens',
  cancelled: 'cancelled',
  failed: 'failed',
};

/**
 * @param {{
 *   core: import('../core/index.js').Core,
 *   runtime: import('../runtime/port.js').Runtime,
 *   runtimeName: string,
 *   tools: ReturnType<typeof import('./tools.js').createTools>,
 *   idleReleaseMs?: number,
 *   contextAssembly: ReturnType<typeof import('./context-assembly.js').createContextAssembly>
 * }} deps
 *   A session idle for `idleReleaseMs` is released (its process ends); the next
 *   turn resumes it. Historical meetings keep no process alive.
 * @returns {{reserve: typeof reserve, run: typeof run, interrupt: typeof interrupt}}
 */
export function createTurnRunner({
  core,
  runtime,
  runtimeName,
  tools,
  contextAssembly,
  idleReleaseMs = 10 * 60 * 1000,
}) {
  /** @type {Map<string, { sessionId: string | null, cancelled: boolean }>} turn id → execution */
  const active = new Map();
  /** @type {Map<string, NodeJS.Timeout>} session id → pending release */
  const releases = new Map();

  function holdSession(sessionId) {
    clearTimeout(releases.get(sessionId));
    releases.delete(sessionId);
  }
  function releaseLater(sessionId) {
    const timer = setTimeout(() => {
      releases.delete(sessionId);
      void runtime.release(sessionId).catch(() => {});
    }, idleReleaseMs);
    timer.unref();
    releases.set(sessionId, timer);
  }

  /**
   * Start a turn and create its (empty) answer now; `run` fills it later.
   * A review answer starts unadopted.
   * @param {{
   *   meetingId: string,
   *   participantId: string,
   *   triggerMessageId?: string | null,
   *   discussion?: {kind: string, [key: string]: unknown}
   * }} input
   */
  function reserve({ meetingId, participantId, triggerMessageId = null, discussion }) {
    return core.db.transaction(() => {
      const turn = core.turns.start({ meetingId, participantId, triggerMessageId });
      const answer = core.messages.post({
        meetingId,
        authorId: participantId,
        text: '',
        status: 'streaming',
        turnId: turn.id,
        replyTo: triggerMessageId,
        adopted: discussion?.kind === 'review' ? false : null,
        refs: discussion ? { discussion: { ...discussion, phase: 'waiting' } } : {},
      });
      return { turn, answer };
    });
  }

  /**
   * Start or resume the session; returns the session id, the input to send and what it contains.
   */
  async function prepareSession(request) {
    const { meetingId, participantId, turnId, cutoffSeq, execution } = request;
    const context = await contextAssembly.describe(request);
    const options = {
      model: context.model,
      workFolder: context.workFolder,
      env: context.env,
      instructions: context.instructions,
      tools: tools.specs,
      onToolCall: ({ name, args, callId, signal }) =>
        tools.run(name, args, {
          participantId,
          meetingId,
          turnId,
          callId,
          environmentId: context.environmentId,
          workFolder: context.workFolder,
          env: context.env,
          signal,
        }),
    };
    const saved = core.turns.session(meetingId, participantId);
    if (
      saved &&
      saved.runtime === runtimeName &&
      (cutoffSeq == null || saved.lastSeq <= cutoffSeq)
    ) {
      let sessionId;
      try {
        sessionId = await runtime.startSession({ ...options, sessionId: saved.sessionId });
      } catch {
        core.turns.dropSession(meetingId, participantId);
      }
      if (sessionId) {
        const input = context.resumedInput(saved.lastSeq);
        // Register the resumed process before waiting for a catch-up refresh,
        // so stop/close can interrupt it even while preparation is pending.
        execution.sessionId = sessionId;
        const packet = await context.followup(false);
        if (execution.cancelled) throw new AppError('TURN_CANCELLED', 'Turn was cancelled.');
        return {
          sessionId,
          packet,
          ...(await input(packet)),
        };
      }
    }
    const packet = await context.followup(true);
    if (execution.cancelled) throw new AppError('TURN_CANCELLED', 'Turn was cancelled.');
    const sessionId = await runtime.startSession(options);
    return { sessionId, packet, ...(await context.seedInput(packet)) };
  }

  /**
   * @param {{
   *   meetingId: string,
   *   participantId: string,
   *   triggerMessageId?: string | null,
   *   reserved?: ReturnType<typeof reserve>,
   *   cutoffSeq?: number,
   *   reviewMessageIds?: string[],
   *   continuation?: boolean,
   *   continuationMessageId?: string,
   *   retry?: boolean,
   *   signal?: AbortSignal
   * }} input
   *   `reviewMessageIds`: the round's expert answers a reviewer checks.
   */
  async function run(input) {
    const {
      meetingId,
      participantId,
      triggerMessageId = null,
      reserved,
      cutoffSeq,
      continuationMessageId,
      signal,
    } = input;
    const { turn, answer } = reserved ?? reserve({ meetingId, participantId, triggerMessageId });
    const execution = { sessionId: null, cancelled: Boolean(signal?.aborted) };
    active.set(turn.id, execution);
    const cancel = () => {
      execution.cancelled = true;
      if (execution.sessionId) void runtime.interrupt(execution.sessionId).catch(() => {});
    };
    signal?.addEventListener('abort', cancel, { once: true });
    let text = '';
    let attemptBase = '';
    let stepText = '';
    let preamble = '';
    const activity = createTurnActivity(core, turn.id);

    /** @param {import('../runtime/port.js').RuntimeEvent} event */
    function onEvent(event) {
      if (execution.cancelled) return;
      if (activity.onEvent(event)) return;
      if (event.type === 'attempt-start') {
        attemptBase = text;
        stepText = '';
      } else if (event.type === 'text-delta') {
        text += event.delta;
        stepText += event.delta;
        core.messages.streamDelta(answer.id, event.delta);
      } else if (event.type === 'attempt-discarded') {
        text = attemptBase;
        stepText = '';
        core.messages.streamReplace(answer.id, text);
      } else if (event.type === 'step-end') {
        if (event.hasToolCalls && stepText) {
          // Text written right before a tool call explains the call; it
          // belongs to the tool card, not to the answer.
          preamble = stepText.trim();
          text = text.slice(0, text.length - stepText.length);
          core.messages.streamReplace(answer.id, text);
        }
        stepText = '';
      } else if (event.type === 'tool-call') {
        core.turns.startToolCall({
          turnId: turn.id,
          callId: event.callId,
          name: event.name,
          args: event.args,
          preamble,
        });
        preamble = '';
      } else if (event.type === 'tool-result')
        core.turns.endToolCall(turn.id, event.callId, {
          result: event.result,
          isError: event.isError,
        });
    }

    const endTurn = (result) => {
      activity.finish();
      core.workspace.captureTurnSnapshots(turn.id);
      closeKnowledgeTurn(core, turn.id);
      return core.turns.end(turn.id, result);
    };

    try {
      if (execution.cancelled) {
        core.messages.update(answer.id, { status: 'cancelled' });
        return endTurn({ status: 'cancelled', stopReason: 'cancelled' });
      }
      const prepared = await prepareSession({ ...input, turnId: turn.id, execution });
      execution.sessionId = prepared.sessionId;
      holdSession(prepared.sessionId);
      if (execution.cancelled) {
        await runtime.interrupt(prepared.sessionId);
        core.messages.update(answer.id, { status: 'cancelled' });
        return endTurn({ status: 'cancelled', stopReason: 'cancelled' });
      }
      const current = core.messages.get(answer.id);
      if (current.refs.discussion)
        core.messages.update(answer.id, {
          refs: { ...current.refs, discussion: { ...current.refs.discussion, phase: 'answering' } },
        });
      core.messages.recordConsumption(
        prepared.messages.map((message) => message.id),
        turn.id,
      );
      const result = await runtime.send(
        prepared.sessionId,
        prepared.input,
        onEvent,
        prepared.images,
      );
      const status = execution.cancelled
        ? 'cancelled'
        : (STATUS_BY_STOP[result.stopReason] ?? 'failed');
      const previousReview =
        continuationMessageId && answer.refs?.discussion?.kind === 'review'
          ? core.messages.get(continuationMessageId).text
          : '';
      const finalText = previousReview ? [previousReview, text].filter(Boolean).join('\n\n') : text;
      core.messages.update(answer.id, {
        text: finalText || (status === 'failed' ? (result.error ?? '这次发言失败了。') : ''),
        status,
      });
      // Only a completed answer acknowledges its main-meeting follow-up.
      if (status === 'done') await prepared.packet?.commit({ status, turnId: turn.id });
      const lastSeq = cutoffSeq ?? answer.seq;
      core.turns.saveSession(meetingId, participantId, {
        runtime: runtimeName,
        sessionId: prepared.sessionId,
        lastSeq,
      });
      return endTurn({
        status,
        stopReason: execution.cancelled ? 'cancelled' : result.stopReason,
        usage: result.usage,
        error: status === 'cancelled' ? null : (result.error ?? null),
      });
    } catch (error) {
      const status = execution.cancelled ? 'cancelled' : 'failed';
      core.messages.update(answer.id, {
        text: text || (status === 'failed' ? `这次发言失败了：${error.message}` : ''),
        status,
      });
      return endTurn({
        status,
        stopReason: execution.cancelled ? 'cancelled' : 'error',
        error: status === 'failed' ? error.message : null,
      });
    } finally {
      activity.finish();
      signal?.removeEventListener('abort', cancel);
      active.delete(turn.id);
      if (execution.sessionId) releaseLater(execution.sessionId);
    }
  }

  /** @param {string} meetingId */
  async function interrupt(meetingId) {
    const interruptions = [];
    for (const turn of core.turns.running().filter((entry) => entry.meetingId === meetingId)) {
      const execution = active.get(turn.id);
      if (!execution) continue;
      execution.cancelled = true;
      if (execution.sessionId) interruptions.push(runtime.interrupt(execution.sessionId));
    }
    await Promise.all(interruptions);
  }
  return { reserve, run, interrupt };
}
