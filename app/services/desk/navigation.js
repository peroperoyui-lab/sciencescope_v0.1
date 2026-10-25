import { AppError } from '../../core/errors.js';
import { annotationText, relocate } from './annotation-anchors.js';

/**
 * Navigation shares the desk queue, so rebinding precedes later journal writes.
 * @param {import('../../core/index.js').Core} core
 * @param {any} dependencies
 */
export function createDeskNavigation(core, { sessions, store, registerDocument }) {
  /**
   * @param {{projectId:string,meetingId?:string,mode:'continue'|'branch',atMessageId?:string}} input
   */
  function enter({ projectId, meetingId, mode, atMessageId }) {
    core.projects.get(projectId);
    if (!['continue', 'branch'].includes(mode) || (mode === 'branch' && !meetingId))
      throw new AppError('DESK_ENTER_MODE', '请选择接续对话，或从一个对话开新分支。');
    return core.db.transaction(() => {
      let meeting = meetingId
        ? core.meetings.get(meetingId)
        : core.meetings
            .list({ projectId })
            // The person's own chats, as the sidebar lists them: not archived,
            // not temporary (such as 文献版本整理), not attached, not the assistant's.
            .filter(
              (candidate) =>
                !candidate.archived &&
                !candidate.temporary &&
                !candidate.attachedToMeetingId &&
                candidate.policy?.respondent !== 'agent_assistant',
            )
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (meeting && meeting.projectId !== projectId)
        throw new AppError('DESK_MEETING_PROJECT', '请选择这个项目里的对话。');
      let created = false;
      if (mode === 'branch') {
        const latest = core.db
          .prepare('SELECT id FROM messages WHERE meeting_id=? ORDER BY seq DESC LIMIT 1')
          .get(meeting.id);
        if (!latest) throw new AppError('DESK_BRANCH_EMPTY', '对话还没有消息，请先接续当前对话。');
        meeting = core.meetings.fork(meeting.id, { atMessageId: atMessageId ?? String(latest.id) });
        created = true;
      } else if (!meeting) {
        meeting = core.meetings.create({
          projectId,
          title: '编辑台',
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
        });
        created = true;
      }
      const opened = core.db
        .prepare(
          "SELECT s.id FROM desk_sessions s JOIN version_groups g ON g.id=s.group_id WHERE g.project_id=? AND s.status='open' AND s.meeting_id IS NOT ?",
        )
        .all(projectId, meeting.id);
      for (const session of opened) sessions.bind(String(session.id), meeting.id);
      core.meetings.touch(meeting.id);
      core.events.record('desk.entered', { projectId, meetingId: meeting.id, mode });
      return {
        meeting: { id: meeting.id, title: meeting.title, parentMeetingId: meeting.parentMeetingId },
        mode,
        created,
        sessionIds: opened.map((session) => String(session.id)),
      };
    });
  }

  async function focus({ reference }) {
    const location = reference?.location ?? {};
    if (
      reference?.schema !== 1 ||
      !['project-file', 'version'].includes(reference.kind) ||
      (!location.quote?.exact && !location.blockId)
    )
      throw new AppError('DESK_REFERENCE', '请选择带原文或段落位置的文稿引用。');
    const version = reference.kind === 'version' ? core.versionCatalog.get(reference.id) : null;
    const group = version
      ? core.versionCatalog.group(version.groupId)
      : await registerDocument({ projectId: reference.projectId, path: reference.path });
    // Open working text wins over an external file and over an old cited version.
    const session = store.open(group.id) ?? (await sessions.open({ groupId: group.id })).session;
    const state = await sessions.load(session);
    const block = state.blocks.find((item) => item.id === location.blockId);
    const from = location.characters?.start;
    const to = location.characters?.end;
    const hasRange =
      Number.isInteger(from) &&
      Number.isInteger(to) &&
      from >= 0 &&
      to >= from &&
      block &&
      to <= annotationText(block).length;
    const found = location.quote?.exact
      ? relocate(
          state.blocks,
          { blockId: location.blockId, from, to, quote: location.quote },
          // Text block IDs are regenerated across sessions; a duplicate at the
          // old numeric ID must still be disambiguated by its quote context.
          !hasRange || state.document.format !== 'docx',
        )
      : block && { blockId: block.id, from: 0, to: annotationText(block).length };
    const exact =
      found &&
      found.blockId === location.blockId &&
      (!location.quote?.exact || (hasRange && found.from === from && found.to === to));
    const result = {
      projectId: group.projectId,
      path: group.sourcePath,
      groupId: group.id,
      sessionId: session.id,
      versionId: version?.id ?? session.baseVersionId,
      status: found ? (exact ? 'exact' : 'moved') : 'missing',
      ...(found ?? {}),
    };
    core.events.record('desk.focus', result);
    return result;
  }
  return { enter, focus };
}
