import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { navigate } from '../route.js';
import { ACTIVITY_LABELS, meetingActivity } from '../activity.js';

/**
 * @param {{meetingId:string}} props
 */
export function ActivityBadge({ meetingId }) {
  const activity = useAppState((state) => meetingActivity(state, meetingId));
  if (!activity) return null;
  return html`<span
    class="chat-activity-badge"
    data-state=${activity.status}
    aria-label=${t(ACTIVITY_LABELS[activity.status])}
    >${t(ACTIVITY_LABELS[activity.status])}</span
  >`;
}

/**
 * @param {{currentMeetingId?:string}} props
 */
export function BackgroundActivity({ currentMeetingId }) {
  const actions = useActions();
  const background = useAppState((state) =>
    state.meetings
      .filter(
        (meeting) =>
          !meeting.archived &&
          !meeting.attachedToMeetingId &&
          meeting.id !== state.assistantMeeting?.id &&
          meeting.policy.respondent !== 'agent_assistant' &&
          meeting.id !== currentMeetingId,
      )
      .map((meeting) => ({ meeting, activity: meetingActivity(state, meeting.id) }))
      .filter(({ activity }) => activity && !['completed', 'failed'].includes(activity.status)),
  );
  if (!background.length) return null;
  return html`<button
    class="background-activity-summary"
    onClick=${(event) =>
      actions.openMenu(
        event,
        background.map(({ meeting, activity }) => ({
          text: `${meeting.title} · ${t(ACTIVITY_LABELS[activity.status])}`,
          icon: 'chat',
          run: () => navigate({ view: 'meeting', id: meeting.id }),
        })),
        t('后台对话'),
      )}
  >
    ${t('后台任务 {count} · 查看状态', { count: background.length })}
  </button>`;
}
