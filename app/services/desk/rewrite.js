import { randomUUID } from 'node:crypto';
import { AppError } from '../../core/errors.js';

/**
 * Post the selection through the normal meeting/outbox path. The subscription
 * waits only for reservation of a turn, never for the model's answer.
 * @param {import('../../core/index.js').Core} core
 * @param {ReturnType<typeof import('./index.js').createDesk>} desk
 * @param {ReturnType<typeof import('../conductor.js').createConductor>} conductor
 * @returns {(id:string,input:any,signal?:AbortSignal)=>Promise<any>}
 */
export function createDeskRewrite(core, desk, conductor) {
  return async (id, input, signal) => {
    const current = await desk.getSession(id);
    const meetingId = current.session.meetingId;
    if (!meetingId) throw new AppError('DESK_MEETING_REQUIRED', '请先为编辑会话绑定一个对话。');
    const meeting = core.meetings.get(meetingId);
    const people = core.participants.list();
    if (
      !meeting.members.some((member) =>
        people.some((person) => person.id === member.participantId && person.kind === 'ai'),
      )
    )
      throw new AppError('DESK_MEETING_REQUIRED', '请先在绑定的对话中添加专家。');
    const paragraph = current.blocks.findIndex((block) => block.id === input.blockId);
    if (paragraph < 0) throw new AppError('DOCX_BLOCK_NOT_FOUND', '这段正文已不存在，请重新划选。');
    const quote = typeof input.quote === 'string' ? { exact: input.quote } : input.quote;
    if (!quote?.exact) throw new AppError('DESK_SELECTION_REQUIRED', '请先划选要改写的文字。');
    if (!conductor)
      throw new AppError('DESK_RUNTIME_UNAVAILABLE', '对话服务尚未启动，请稍后重试。');
    const version = core.versionCatalog.get(current.session.baseVersionId);
    const key = `${version.projectId}/${current.session.groupId}`;
    const location = { paragraph: paragraph + 1, blockId: input.blockId, quote };
    const reference = {
      schema: 1,
      kind: 'version',
      id: version.id,
      projectId: version.projectId,
      location,
    };
    const mark = {
      id: randomUUID(),
      selectionId: randomUUID(),
      sourceId: version.id,
      target: reference,
      reference,
      title: version.name,
      location,
      quote,
      text: quote.exact,
      manuscriptKey: key,
    };
    let posted, resolveTurn, rejectTurn;
    const started = new Promise((resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    });
    const unsubscribe = core.events.subscribe((event) => {
      if (event.type === 'turn.started' && event.payload.triggerMessageId === posted?.id)
        resolveTurn(event.payload.id);
    });
    const abort = () =>
      rejectTurn(
        new AppError('DESK_REWRITE_CANCELLED', '请求已关闭；已发送的改写可在对话里查看。'),
      );
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) throw new AppError('DESK_REWRITE_CANCELLED', '改写请求已取消。');
      posted = conductor.submit({
        meetingId,
        authorId: 'person_user',
        text: input.instruction,
        researchInput: { materials: [], marks: [mark] },
      });
      if ('queued' in posted)
        return { messageId: null, turnId: null, queued: true, itemId: posted.item.id };
      return { messageId: posted.id, turnId: await started };
    } finally {
      unsubscribe();
      signal?.removeEventListener('abort', abort);
    }
  };
}
