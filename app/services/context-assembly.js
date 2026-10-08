// What a participant receives, independent of session execution. Keep the
// selection cutoff, late reviews and secretary acknowledgement together so
// rebuilding and resuming share the same reading rules.
import {
  buildFollowupInput,
  buildInstructions,
  buildSeedInput,
  visibleMessages,
  formatTranscript,
} from '../core/context.js';
import { AppError } from '../core/errors.js';
import { compileResearchInput } from './research-input/compile.js';

const withResearchInput = (messages) =>
  messages.map((message) => ({
    ...message,
    text: message.text + compileResearchInput(message.researchInput),
  }));

/**
 * @typedef {import('../core/index.js').Core} Core
 * @typedef {import('../runtime/port.js').ModelChoice} ModelChoice
 * @typedef {{ text: string, commit: (result: {status: string, turnId: string}) => unknown }} FollowupPacket
 * @typedef {{rebuilding: boolean, model: ModelChoice, instructions: string, signal?: AbortSignal}} FollowupOptions
 * @typedef {{input: string, messages: import('../core/messages.js').Message[]}} AssembledInput
 * @typedef {{model: ModelChoice, workFolder: string, instructions: string,
 *   followup: (rebuilding: boolean) => Promise<FollowupPacket | null>,
 *   resumedInput: (afterSeq: number) => (packet: FollowupPacket | null) => AssembledInput,
 *   seedInput: (packet: FollowupPacket | null) => Promise<AssembledInput>}} PreparedContext
 * @typedef {{meetingId: string, participantId: string,
 *   cutoffSeq?: number, reviewMessageIds?: string[], continuation?: boolean,
 *   continuationMessageId?: string, retry?: boolean, signal?: AbortSignal,
 *   execution: {cancelled: boolean}}} ContextRequest
 */

/**
 * @param {{
 *   core: Core,
 *   defaultModel: () => Promise<ModelChoice | null>,
 *   minutesCoverage?: (meetingId: string, revisionId: string | null) => Promise<number>,
 *   minutesCoveredMessageIds?: (meetingId: string, revisionId: string | null) => string[],
 *   followup?: (meetingId: string, options: FollowupOptions) => Promise<FollowupPacket | null>,
 *   assistantOverview?: (meetingId: string, rebuilding: boolean) => Promise<FollowupPacket | null>,
 *   projectBrief?: (projectId: string) => Promise<string>
 * }} dependencies
 * @returns {{describe: (request: ContextRequest) => Promise<PreparedContext>}}
 */
export function createContextAssembly({
  core,
  defaultModel,
  minutesCoverage = async () => 0,
  minutesCoveredMessageIds = () => [],
  followup = async () => null,
  projectBrief = async () => '',
  assistantOverview = async () => null,
}) {
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

  /**
   * The messages a participant is given, in reading order.
   * - An answer counts at the position of the message it replies to (its
   *   "boundary"), so answers that finished late still sit after their question.
   * - Nothing after `cutoffSeq` is included, except answers to earlier messages:
   *   experts in one round all stop at the same person's message.
   * - Only what arrived after `afterSeq` (the participant's last read point),
   *   plus adopted reviews this participant has not read yet.
   * - A resumed session already has its own words, so they are left out.
   */
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

  /**
   * @param {ContextRequest} request
   */
  async function describe({
    meetingId,
    participantId,
    cutoffSeq,
    reviewMessageIds,
    continuation,
    continuationMessageId,
    retry,
    execution,
    signal,
  }) {
    const meeting = core.meetings.get(meetingId);
    const project = meeting.projectId ? core.projects.get(meeting.projectId) : null;
    const participant = await core.participants.get(participantId);
    const attachedTo = meeting.attachedToMeetingId
      ? core.meetings.get(meeting.attachedToMeetingId)
      : null;
    const parentRespondent = attachedTo
      ? await core.participants.get(attachedTo.policy.respondent ?? 'agent_main')
      : null;
    const preferredModels = [
      meeting.policy.model,
      participant.definition?.model,
      attachedTo?.policy.model,
      parentRespondent?.definition?.model,
    ];
    // Definitions allow partial choices; selection keeps the existing model precedence.
    const model = /** @type {ModelChoice} */ (
      preferredModels.find((choice) => choice?.model) ?? (await defaultModel())
    );
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
      projectBrief:
        participant.id === 'agent_main' && project ? await projectBrief(project.id) : '',
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
    const ownContinuation = continuationMessageId ? core.messages.get(continuationMessageId) : null;
    const question =
      retry && cutoffSeq != null
        ? withResearchInput(core.messages.since(meeting.id, 0)).find(
            (message) => message.seq === cutoffSeq,
          )?.text
        : null;
    const followupFor = async (rebuilding) =>
      participant.id === 'agent_assistant'
        ? assistantOverview(meeting.id, rebuilding)
        : followup(meeting.id, { rebuilding, model, instructions, signal });
    const suffix =
      reviewText +
      (question ? '\n\n请重新回答以下用户问题：\n' + question : '') +
      (continuation
        ? '\n\n请继续完成你上一条未完成的回答：\n' + (ownContinuation?.text ?? '')
        : '');

    function resumedInput(afterSeq) {
      const messages = selectedMessages(
        meeting.id,
        afterSeq,
        cutoffSeq,
        participant.id,
        true,
      ).filter((message) => !reviewMessageIds?.includes(message.id));
      return (packet) => ({
        input:
          (packet?.text ?? '') +
          buildFollowupInput({ messages: withResearchInput(messages), nameOf }) +
          suffix,
        messages: [...messages, ...review],
      });
    }
    async function seedInput(packet) {
      const minutes = await core.workspace.read({ resource: 'minutes', key: meeting.id });
      const revisionId = minutes.revisionId;
      const throughSeq = await minutesCoverage(meeting.id, revisionId);
      // A queued earlier question must not see a summary of future questions.
      const usableMinutes = cutoffSeq == null || throughSeq <= cutoffSeq;
      const coveredIds = new Set(minutesCoveredMessageIds(meeting.id, revisionId));
      const messages = selectedMessages(meeting.id, 0, cutoffSeq, participant.id, false).filter(
        (message) =>
          (!usableMinutes ||
            message.seq > throughSeq ||
            (message.adopted === true && !coveredIds.has(message.id))) &&
          !reviewMessageIds?.includes(message.id),
      );
      return {
        input:
          (packet?.text ?? '') +
          buildSeedInput({
            minutes: usableMinutes ? minutes.text : null,
            messages: withResearchInput(messages),
            nameOf,
          }) +
          suffix,
        messages: [...messages, ...review],
      };
    }
    return {
      model,
      workFolder,
      instructions: review.length
        ? `${instructions}\n\n你是本轮审核专家。等待所有专家结束后逐一审核下列回答，注明作者与未完成状态。`
        : instructions,
      followup: followupFor,
      resumedInput,
      seedInput,
    };
  }
  return { describe };
}
