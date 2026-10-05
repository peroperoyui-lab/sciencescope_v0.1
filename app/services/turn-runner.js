// Runs one turn: one AI participant speaking once in a meeting.
// It assembles the context, resumes or rebuilds the participant's runtime
// session, streams the answer into a message, records tool calls and ends
// the turn with a status. See docs/design/CORE_MODEL.md §6–§7.
import {
  buildFollowupInput,
  buildInstructions,
  buildSeedInput,
  visibleMessages,
} from '../core/context.js';

/** @type {Record<string, 'done' | 'max_tokens' | 'cancelled' | 'failed'>} */
const STATUS_BY_STOP = {
  completed: 'done',
  max_tokens: 'max_tokens',
  cancelled: 'cancelled',
  failed: 'failed',
};

/**
 * @param {{ core: import('../core/index.js').Core,
 *   runtime: import('../runtime/port.js').Runtime, runtimeName: string,
 *   tools: ReturnType<typeof import('./tools.js').createTools>,
 *   defaultModel: () => Promise<import('../runtime/port.js').ModelChoice | null> }} deps
 */
export function createTurnRunner({ core, runtime, runtimeName, tools, defaultModel }) {
  /** @type {Map<string, string>} turn id → runtime session id, for interrupts */
  const active = new Map();

  async function nameMap() {
    const names = new Map();
    for (const participant of core.participants.list()) names.set(participant.id, participant.name);
    return (id) => names.get(id) ?? id;
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
    if (meeting.workFolder) return meeting.workFolder;
    if (project?.folder) return project.folder;
    if (project) return core.workspace.locate.projectDir(project.id);
    return core.paths.root;
  }

  /** Start or resume the session; returns the session id and the input to send. */
  async function prepareSession({ meeting, participant, project, turnId, nameOf }) {
    const model = participant.definition?.model?.model
      ? participant.definition.model
      : await defaultModel();
    if (!model) throw new Error('还没有设置模型。请在设置中添加服务商与模型。');
    const workFolder = workFolderOf(meeting, project);
    const options = {
      model: /** @type {import('../runtime/port.js').ModelChoice} */ (model),
      workFolder,
      instructions: buildInstructions({
        participant,
        meeting,
        members: await membersOf(meeting),
        project,
        workFolder,
      }),
      tools: tools.specs,
      onToolCall: ({ name, args }) =>
        tools.run(name, args, { participantId: participant.id, meetingId: meeting.id, turnId }),
    };
    const saved = core.turns.session(meeting.id, participant.id);
    if (saved && saved.runtime === runtimeName) {
      try {
        const sessionId = await runtime.startSession({ ...options, sessionId: saved.sessionId });
        const fresh = visibleMessages(core.messages.since(meeting.id, saved.lastSeq)).filter(
          (message) => message.authorId !== participant.id,
        );
        return { sessionId, input: buildFollowupInput({ messages: fresh, nameOf }) };
      } catch {
        core.turns.dropSession(meeting.id, participant.id);
      }
    }
    const sessionId = await runtime.startSession(options);
    const minutes = await core.workspace.read({ resource: 'minutes', key: meeting.id });
    const messages = visibleMessages(core.messages.since(meeting.id, 0));
    return { sessionId, input: buildSeedInput({ minutes: minutes.text, messages, nameOf }) };
  }

  /**
   * @param {{ meetingId: string, participantId: string, triggerMessageId?: string | null }} input
   */
  async function run({ meetingId, participantId, triggerMessageId = null }) {
    const meeting = core.meetings.get(meetingId);
    const project = meeting.projectId ? core.projects.get(meeting.projectId) : null;
    const participant = await core.participants.get(participantId);
    const nameOf = await nameMap();

    const turn = core.turns.start({ meetingId, participantId, triggerMessageId });
    const answer = core.messages.post({
      meetingId,
      authorId: participantId,
      text: '',
      status: 'streaming',
      turnId: turn.id,
      replyTo: triggerMessageId,
    });

    let text = '';
    let attemptBase = '';
    let stepText = '';
    let preamble = '';

    /** @param {import('../runtime/port.js').RuntimeEvent} event */
    function onEvent(event) {
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
      } else if (event.type === 'tool-result') {
        core.turns.endToolCall(turn.id, event.callId, {
          result: event.result,
          isError: event.isError,
        });
      }
    }

    try {
      const { sessionId, input } = await prepareSession({
        meeting,
        participant,
        project,
        turnId: turn.id,
        nameOf,
      });
      active.set(turn.id, sessionId);
      const result = await runtime.send(sessionId, input, onEvent);
      const status = STATUS_BY_STOP[result.stopReason] ?? 'failed';
      const finalText = text || (status === 'failed' ? (result.error ?? '这次发言失败了。') : text);
      core.messages.update(answer.id, { text: finalText, status });
      core.turns.saveSession(meetingId, participantId, {
        runtime: runtimeName,
        sessionId,
        lastSeq: answer.seq,
      });
      return core.turns.end(turn.id, {
        status,
        stopReason: result.stopReason,
        usage: result.usage,
      });
    } catch (error) {
      core.messages.update(answer.id, {
        text: text || `这次发言失败了：${error.message}`,
        status: 'failed',
      });
      return core.turns.end(turn.id, { status: 'failed', stopReason: 'error' });
    } finally {
      active.delete(turn.id);
    }
  }

  /** @param {string} meetingId */
  async function interrupt(meetingId) {
    const turns = core.turns.running().filter((turn) => turn.meetingId === meetingId);
    for (const turn of turns) {
      const sessionId = active.get(turn.id);
      if (sessionId) await runtime.interrupt(sessionId);
    }
  }

  return { run, interrupt };
}
