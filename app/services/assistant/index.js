// One durable global utility meeting; overview acknowledgement belongs to the
// resumed context. Rebuilding always sends the projection, even after a saved hash.
import { overviewHash, workspaceOverview } from './overview.js';

/**
 * @param {{core: import('../../core/index.js').Core}} dependencies
 * @returns {{ensure: () => import('../../core/meetings.js').Meeting,
 *   packet: (meetingId: string, rebuilding: boolean) => Promise<import('../context-assembly.js').FollowupPacket | null>}}
 */
export function createAssistant({ core }) {
  function state() {
    return core.db.prepare('SELECT * FROM assistant_state WHERE singleton = 1').get();
  }
  function ensure() {
    const saved = state();
    if (saved) return core.meetings.get(String(saved.meeting_id));
    return core.db.transaction(() => {
      const meeting = core.meetings.create(
        {
          title: '全局助手',
          members: [{ participantId: 'person_user' }, { participantId: 'agent_assistant' }],
          policy: { mode: 'direct', respondent: 'agent_assistant' },
        },
        { actorId: 'person_user' },
      );
      core.db
        .prepare('INSERT INTO assistant_state(singleton,meeting_id) VALUES(1,?)')
        .run(meeting.id);
      return meeting;
    });
  }
  async function packet(meetingId, rebuilding) {
    const saved = state();
    if (!saved || saved.meeting_id !== meetingId) return null;
    const text = await workspaceOverview(core);
    const hash = overviewHash(text);
    if (!rebuilding && saved.overview_hash === hash) return null;
    return {
      text: text + '\n\n',
      commit() {
        core.db.prepare('UPDATE assistant_state SET overview_hash=? WHERE singleton=1').run(hash);
      },
    };
  }
  return { ensure, packet };
}
