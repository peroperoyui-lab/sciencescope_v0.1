// A secretary conversation is an ordinary attached meeting. Its messages and
// runtime sessions remain separate; the follow-up packet is its link to Main.
import { AppError } from '../../core/errors.js';
import { createSecretaryCatchUp } from './catch-up.js';
import { createDraftProposals } from './proposals.js';

/**
 * @param {{core:import('../../core/index.js').Core,minutes:any,refreshWaitMs?:number,modelCatalog?:any}} dependencies
 * @returns {{ensure:(mainMeetingId:string)=>any,snapshot:(mainMeetingId:string)=>any,cursor:(meetingId:string)=>any,catchUp:(meetingId:string,options?:any)=>Promise<any>,propose:(context:any,args:any)=>any,decide:(proposalId:string,changes:any)=>any,list:(mainMeetingId:string)=>any[],history:(proposalId:string)=>any[],undo:(historyId:string)=>any}}
 */
export function createSecretaryChat({ core, minutes, refreshWaitMs = 60000, modelCatalog }) {
  const followUp = createSecretaryCatchUp({ core, minutes, refreshWaitMs, modelCatalog });
  const proposals = createDraftProposals(core);

  /**
   * @param {string} mainMeetingId
   * @returns {import('../../core/meetings.js').Meeting}
   */
  function ensure(mainMeetingId) {
    const main = core.meetings.get(mainMeetingId);
    if (main.attachedToMeetingId)
      throw new AppError('MAIN_MEETING_REQUIRED', '请从主会议打开秘书。');
    const existing = core.db
      .prepare('SELECT meeting_id FROM secretary_chats WHERE main_meeting_id = ?')
      .get(mainMeetingId);
    if (existing) return core.meetings.get(String(existing.meeting_id));
    return core.db.transaction(() => {
      const meeting = core.meetings.create(
        {
          projectId: main.projectId,
          title: `${main.title} · 任务秘书`,
          attachedTo: main.id,
          workFolder: main.workFolder,
          members: [{ participantId: 'person_user' }, { participantId: 'agent_secretary' }],
          policy: { mode: 'direct', respondent: 'agent_secretary' },
        },
        { actorId: 'agent_secretary', meetingId: main.id },
      );
      core.db
        .prepare('INSERT INTO secretary_chats (main_meeting_id, meeting_id) VALUES (?, ?)')
        .run(main.id, meeting.id);
      return meeting;
    });
  }

  /**
   * @param {string} mainMeetingId
   * @returns {{meeting:import('../../core/meetings.js').Meeting,cursor:any,proposals:any[]}}
   */
  function snapshot(mainMeetingId) {
    const meeting = ensure(mainMeetingId);
    return {
      meeting,
      cursor: followUp.cursor(meeting.id),
      proposals: proposals.list(mainMeetingId),
    };
  }

  return { ensure, snapshot, ...followUp, ...proposals };
}
