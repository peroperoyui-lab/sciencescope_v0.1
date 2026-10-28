// One chat in a two-line list (home 最近工作, 全部对话): its title, a second line
// the caller gives, its state and time. ⋯ and right click give the sidebar's chat menu.
import { ACTIVITY_LABELS, meetingActivity } from '../activity.js';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { chatMenuItems, useBusy } from './sidebar.js';

const TONES = { approval: 'warn', failed: 'danger', queued: '', paused: '' };

/** 16:24 today, 昨天, then 10-20. @param {string} iso */
export function stamp(iso) {
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  const start = (value) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(date)) / 86400000);
  if (days <= 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (days === 1) return t('昨天');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** @param {{ meeting: any, projects: any[], sub: string, icon?: string, time?: string, children?: any }} props */
export function ChatRow({ meeting, projects, sub, icon = 'message-square', time, children }) {
  const actions = useActions();
  const busy = useBusy(meeting.id);
  const activity = useAppState((state) => meetingActivity(state, meeting.id));
  const open = () => navigate({ view: 'meeting', id: meeting.id });
  const menu = (event) => {
    event.stopPropagation();
    const row = event.currentTarget.closest('.ss-list-row');
    actions.openMenu(
      event,
      chatMenuItems(actions, meeting, { busy, projects, row }),
      meeting.title,
    );
  };
  const tone = activity ? TONES[activity.status] : undefined;
  return html`<div
    class="ss-list-row ss-list-row--2"
    role="link"
    tabindex="0"
    data-object="chat"
    data-object-id=${meeting.id}
    onClick=${open}
    onKeyDown=${(event) => {
      if (event.key === 'Enter' && event.target === event.currentTarget) open();
    }}
    onContextMenu=${menu}
  >
    <${Lucide} name=${icon} class="ss-list-row__icon" />
    <div class="ss-list-row__main">
      <span class="ss-list-row__title"
        >${meeting.title}${
          meeting.pinned &&
          html`<span class="ss-chat-row__pin" aria-label=${t('已置顶')} data-tip=${t('已置顶')}
            ><${Lucide} name="pin" small
          /></span>`
        }</span
      >
      <span class="ss-list-row__sub">${sub}</span>
    </div>
    ${
      activity?.status === 'running'
        ? html`<span class="ss-spin" aria-label=${t('运行中')}></span>`
        : tone !== undefined &&
          html`<span class=${`ss-tag ${tone ? `ss-tag--${tone}` : ''}`}
            >${t(ACTIVITY_LABELS[activity.status])}</span
          >`
    }
    <span class="ss-list-row__meta ss-list-row__meta--time"
      >${time ?? stamp(meeting.updatedAt)}</span
    >
    <span class="ss-list-row__actions">
      ${children}
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('对话菜单')}
        aria-haspopup="menu"
        data-tip=${t('对话菜单')}
        onClick=${menu}
      >
        <${Lucide} name="ellipsis" />
      </button>
    </span>
  </div>`;
}
