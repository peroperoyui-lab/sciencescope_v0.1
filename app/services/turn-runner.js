// Runs a participant turn through the public runtime port. Ordered rounds can
// reserve messages before starting so completion order never changes display order.
import {
  buildFollowupInput,
  buildInstructions,
  buildSeedInput,
  visibleMessages,
  formatTranscript,
} from '../core/context.js';
import { AppError } from '../core/errors.js';

/** @type {Record<string, 'done'|'max_tokens'|'cancelled'|'failed'>} */
const STATUS_BY_STOP = {
  completed: 'done',
  max_tokens: 'max_tokens',
  cancelled: 'cancelled',
  failed: 'failed',
};

/** @param {{core:import('../core/index.js').Core,runtime:import('../runtime/port.js').Runtime,runtimeName:string,tools:ReturnType<typeof import('./tools.js').createTools>,defaultModel:()=>Promise<import('../runtime/port.js').ModelChoice|null>,idleReleaseMs?:number}} dependencies */
export function createTurnRunner({
  core,
  runtime,
  runtimeName,
  tools,
  defaultModel,
  idleReleaseMs = 10 * 60 * 1000,
}) {
  const active = new Map();
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

  async function membersOf(meeting) {
    const members = [];
    for (const member of meeting.members) {
      const participant = await core.participants.get(member.participantId);
      members.push({
        id: participant.id,
        name: participant.name,
        kind: participant.kind,
        roleNote: member.roleNote,
      });
    }
    return members;
  }

  function workFolderOf(meeting, project) {
    return (
      meeting.workFolder ??
      project?.folder ??
      (project ? core.workspace.locate.projectDir(project.id) : core.paths.root)
    );
  }

  /** @param {{meetingId:string,participantId:string,triggerMessageId?:string|null,discussion?:any}} input */
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

  function selectedMessages(meetingId, afterSeq, cutoffSeq, participantId, resumed) {
    const all = core.messages.since(meetingId, 0);
    const byId = new Map(all.map((message) => [message.id, message]));
    const boundaryOf = (message) =>
      message.turnId && message.replyTo
        ? (byId.get(message.replyTo)?.seq ?? message.seq)
        : message.seq;
    const bounded = all.filter(
      (message) =>
        cutoffSeq == null ||
        message.seq <= cutoffSeq ||
        (message.turnId && boundaryOf(message) < cutoffSeq),
    );
    return visibleMessages(bounded)
      .filter((message) => {
        const unreadReview =
          message.adopted === true &&
          message.refs?.discussion?.kind === 'review' &&
          !(message.refs?.contextReadBy ?? []).some(
            (reader) => reader.participantId === participantId,
          );
        const arrivedAnswer = message.turnId && boundaryOf(message) >= afterSeq;
        return (
          ((message.turnId ? arrivedAnswer : message.seq > afterSeq) || unreadReview) &&
          (!resumed || message.authorId !== participantId)
        );
      })
      .sort((left, right) => boundaryOf(left) - boundaryOf(right) || left.seq - right.seq);
  }
  async function prepareSession({
    meeting,
    participant,
    project,
    turnId,
    cutoffSeq,
    reviewMessageIds,
    continuation,
    continuationMessageId,
    retry,
    execution,
  }) {
    const model = participant.definition?.model?.model
      ? participant.definition.model
      : await defaultModel();
    if (!model) throw new Error('还没有设置模型。请在设置中添加服务商与模型。');
    if (execution.cancelled) throw new AppError('TURN_CANCELLED', 'Turn was cancelled.');
    const names = new Map(core.participants.list().map((entry) => [entry.id, entry.name]));
    const nameOf = (id) => names.get(id) ?? id;
    const workFolder = workFolderOf(meeting, project);
    const instructions = buildInstructions({
      participant,
      meeting,
      members: await membersOf(meeting),
      project,
      workFolder,
    });
    if (execution.cancelled) throw new AppError('TURN_CANCELLED', 'Turn was cancelled.');
    const review = reviewMessageIds?.map((id) => core.messages.get(id)) ?? [];
    const reviewText = review.length
      ? '\n\n本轮专家回答（含未完成状态），请分别检查其事实、依据、方法与结论：\n\n' +
        review
          .map(
            (message) =>
              `【${nameOf(message.authorId)}；${message.status === 'done' ? '已完成' : '未完成：' + message.status}】\n${formatTranscript([message], nameOf)}`,
          )
          .join('\n\n')
      : '';
    const options = {
      model,
      workFolder,
      instructions: review.length
        ? `${instructions}\n\n你是本轮审核专家。等待所有专家结束后逐一审核下列回答，注明作者与未完成状态。`
        : instructions,
      tools: tools.specs,
      onToolCall: ({ name, args }) =>
        tools.run(name, args, { participantId: participant.id, meetingId: meeting.id, turnId }),
    };
    const saved = core.turns.session(meeting.id, participant.id);
    const ownContinuation = continuationMessageId ? core.messages.get(continuationMessageId) : null;
    const question =
      retry && cutoffSeq != null
        ? core.messages.since(meeting.id, 0).find((message) => message.seq === cutoffSeq)?.text
        : null;
    const suffix =
      reviewText +
      (question ? '\n\n请重新回答以下用户问题：\n' + question : '') +
      (continuation
        ? '\n\n请继续完成你上一条未完成的回答：\n' + (ownContinuation?.text ?? '')
        : '');
    if (
      saved &&
      saved.runtime === runtimeName &&
      (cutoffSeq == null || saved.lastSeq <= cutoffSeq)
    ) {
      try {
        const sessionId = await runtime.startSession({ ...options, sessionId: saved.sessionId });
        const messages = selectedMessages(
          meeting.id,
          saved.lastSeq,
          cutoffSeq,
          participant.id,
          true,
        ).filter((message) => !reviewMessageIds?.includes(message.id));
        return {
          sessionId,
          input: buildFollowupInput({ messages, nameOf }) + suffix,
          messages: [...messages, ...review],
        };
      } catch {
        core.turns.dropSession(meeting.id, participant.id);
      }
    }
    const sessionId = await runtime.startSession(options);
    const minutes = await core.workspace.read({ resource: 'minutes', key: meeting.id });
    const messages = selectedMessages(meeting.id, 0, cutoffSeq, participant.id, false).filter(
      (message) => !reviewMessageIds?.includes(message.id),
    );
    return {
      sessionId,
      input: buildSeedInput({ minutes: minutes.text, messages, nameOf }) + suffix,
      messages: [...messages, ...review],
    };
  }

  /** @param {{meetingId:string,participantId:string,triggerMessageId?:string|null,reserved?:ReturnType<typeof reserve>,cutoffSeq?:number,reviewMessageIds?:string[],continuation?:boolean,continuationMessageId?:string,retry?:boolean,signal?:AbortSignal}} input */
  async function run({
    meetingId,
    participantId,
    triggerMessageId = null,
    reserved,
    cutoffSeq,
    reviewMessageIds,
    continuation = false,
    retry = false,
    continuationMessageId,
    signal,
  }) {
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

    /** @param {import('../runtime/port.js').RuntimeEvent} event */
    function onEvent(event) {
      if (execution.cancelled) return;
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

    try {
      if (execution.cancelled) {
        core.messages.update(answer.id, { status: 'cancelled' });
        return core.turns.end(turn.id, { status: 'cancelled', stopReason: 'cancelled' });
      }
      const meeting = core.meetings.get(meetingId);
      const project = meeting.projectId ? core.projects.get(meeting.projectId) : null;
      const participant = await core.participants.get(participantId);
      const prepared = await prepareSession({
        meeting,
        participant,
        project,
        turnId: turn.id,
        cutoffSeq,
        reviewMessageIds,
        continuation,
        continuationMessageId,
        retry,
        execution,
      });
      execution.sessionId = prepared.sessionId;
      holdSession(prepared.sessionId);
      if (execution.cancelled) {
        await runtime.interrupt(prepared.sessionId);
        core.messages.update(answer.id, { status: 'cancelled' });
        return core.turns.end(turn.id, { status: 'cancelled', stopReason: 'cancelled' });
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
      const result = await runtime.send(prepared.sessionId, prepared.input, onEvent);
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
      const lastSeq = cutoffSeq ?? answer.seq;
      core.turns.saveSession(meetingId, participantId, {
        runtime: runtimeName,
        sessionId: prepared.sessionId,
        lastSeq,
      });
      return core.turns.end(turn.id, {
        status,
        stopReason: execution.cancelled ? 'cancelled' : result.stopReason,
        usage: result.usage,
      });
    } catch (error) {
      const status = execution.cancelled ? 'cancelled' : 'failed';
      core.messages.update(answer.id, {
        text: text || (status === 'failed' ? `这次发言失败了：${error.message}` : ''),
        status,
      });
      return core.turns.end(turn.id, {
        status,
        stopReason: execution.cancelled ? 'cancelled' : 'error',
      });
    } finally {
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
