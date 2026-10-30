// The desk side panel's 「对话」 tab (design system PageDeskChat, U8): the chat
// the desk is bound to, the same conversation as in the main window, with a
// slim composer. 引用到对话 puts the quoted sentence into this composer.
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { LOCAL_USER_ID } from '../actions.js';
import { navigateMain } from '../assistant-window.js';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Illustration } from '../illustrations.js';
import { routeHref } from '../route.js';
import { Composer } from './composer.js';
import { Message } from './chat-message.js';
import { listed } from './sidebar.js';

const EMPTY = [];

/** `10-21`: the month and day a branch was made. @param {string} iso */
const day = (iso) => {
  const date = new Date(iso);
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * A menu opened again from the same button once the current menu has closed.
 * @param {HTMLElement} button @returns {any}
 */
const menuAt = (button) => ({
  type: 'click',
  currentTarget: button,
  preventDefault() {},
  stopPropagation() {},
});

/**
 * The project's chats to bind to, latest first; the bound one is ticked.
 * @param {any} actions @param {any[]} meetings @param {string} projectId
 * @param {string | null} current @param {(meetingId: string) => void} onPick
 */
function chatItems(actions, meetings, projectId, current, onPick) {
  const chats = meetings
    .filter((meeting) => meeting.projectId === projectId && listed(meeting))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!chats.length) return [{ text: t('这个项目还没有对话'), disabled: true, run: () => {} }];
  return chats.map((meeting) => ({
    text: meeting.title,
    check: meeting.id === current,
    run: () => onPick(meeting.id),
  }));
}

/**
 * @param {{ meetingId: string | null, projectId: string | null,
 *   onBound: (meetingId: string) => void, focus?: { id: string, at: number } | null }} props
 * `onBound` reports the chat after the person binds, branches or switches;
 * `focus` is an answer to scroll to and mark.
 */
export function DeskChat({ meetingId, projectId, onBound, focus = null }) {
  const actions = useActions();
  const meetings = useAppState((state) => state.meetings);
  const meeting = meetings.find((entry) => entry.id === meetingId) ?? null;
  const parent = meetings.find((entry) => entry.id === meeting?.parentMeetingId) ?? null;
  const participants = useAppState((state) => state.participants);
  const messages = useAppState((state) => (meetingId ? state.messages[meetingId] : null));
  const hasBefore = useAppState((state) => (meetingId ? state.hasBefore[meetingId] : false));
  const drafts = useAppState((state) => state.drafts);
  const running = useAppState((state) =>
    Object.values(state.running).some(
      (turn) =>
        turn.meetingId === meetingId &&
        state.messages[meetingId]?.some((message) => message.turnId === turn.id),
    ),
  );
  const scroller = useRef(/** @type {HTMLElement | null} */ (null));
  const follow = useRef(true);
  const more = useRef(/** @type {HTMLElement | null} */ (null));

  useEffect(() => {
    if (meetingId) actions.attempt(() => actions.openMeeting(meetingId));
  }, [meetingId]);
  useLayoutEffect(() => {
    if (follow.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, drafts]);
  // 「来源」 asked for one answer: scroll to it once it is loaded, and stop following the end.
  useLayoutEffect(() => {
    if (!focus || !scroller.current) return;
    const node = scroller.current.querySelector(`[data-message-id="${CSS.escape(focus.id)}"]`);
    if (!node) return;
    follow.current = false;
    node.scrollIntoView({ block: 'center' });
  }, [focus?.at, !!messages?.length]);

  /** @param {{ mode: 'continue' | 'branch', meetingId?: string }} how */
  const enter = (how) =>
    actions.attempt(async () => {
      const entered = await actions.enterDesk({ projectId, ...how });
      onBound(entered.meeting.id);
    });
  const pick = (button) =>
    actions.openMenu(
      menuAt(button),
      chatItems(actions, meetings, projectId, meetingId, (id) =>
        enter({ mode: 'continue', meetingId: id }),
      ),
      t('换成别的对话'),
    );

  if (!projectId) return null;
  if (!meetingId)
    return html`<div class="ss-panel__body">
      <div class="ss-empty">
        <${Illustration} name="chat" />
        <div class="ss-empty__title">${t('还没有绑定对话')}</div>
        <div class="ss-empty__text">
          ${t('绑定后可以在这里和专家讨论这份文稿，秘书也跟着这段对话。')}
        </div>
        <div class="ss-empty__actions">
          <button
            type="button"
            class="ss-btn ss-btn--primary ss-btn--sm"
            onClick=${() => enter({ mode: 'continue' })}
          >
            ${t('接续最近的对话')}
          </button>
          <button
            type="button"
            class="ss-btn ss-btn--sm"
            onClick=${(event) => pick(event.currentTarget)}
          >
            ${t('选一个对话…')}
          </button>
        </div>
      </div>
    </div>`;

  const openMain = () => navigateMain(routeHref({ view: 'meeting', id: meetingId }));
  const byId = new Map(participants.map((participant) => [participant.id, participant]));
  const roleOf = (id) => meeting?.members.find((m) => m.participantId === id)?.roleNote ?? '';
  const items = [
    { text: t('在主窗口打开'), icon: 'app-window', run: openMain },
    {
      text: t('从最新消息开新分支'),
      icon: 'git-branch',
      disabled: !messages?.length,
      run: () => enter({ mode: 'branch', meetingId }),
    },
    {
      text: t('换成别的对话…'),
      icon: 'arrow-left-right',
      // Opened after this menu has closed.
      run: () => requestAnimationFrame(() => more.current && pick(more.current)),
    },
  ];
  return html`<section class="ss-desk-chat" aria-label=${t('绑定的对话')}>
    <div class="ss-toolbar ss-desk-chat__bar">
      <${Lucide} name="message-square" small />
      <span class="ss-desk-chat__title ss-truncate" title=${meeting?.title ?? ''}
        >${meeting?.title ?? t('正在读取…')}</span
      >
      ${meeting?.parentMeetingId && html`<span class="ss-tag">${t('分支')}</span>`}
      <span class="ss-titlebar__spacer"></span>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('在主窗口打开这段对话')}
        data-tip=${t('在主窗口打开这段对话')}
        onClick=${openMain}
      >
        <${Lucide} name="app-window" />
      </button>
      <button
        type="button"
        class="ss-icon-btn"
        ref=${more}
        aria-label=${t('更多')}
        aria-haspopup="menu"
        data-tip=${t('更多')}
        onClick=${(event) => actions.openMenu(event, items, meeting?.title ?? '')}
      >
        <${Lucide} name="ellipsis" />
      </button>
    </div>
    <div
      class="ss-content ss-desk-chat__thread"
      ref=${scroller}
      tabindex="0"
      aria-label=${t('对话记录')}
      onScroll=${(event) => {
        const box = event.currentTarget;
        follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      }}
    >
      <div class="ss-thread ss-thread--panel">
        ${
          parent &&
          html`<p class="ss-desk-chat__origin">
            <${Lucide} name="git-branch" small />${t(
              '{day} 从「{title}」分出，原对话停在分出的地方',
              { day: day(meeting.createdAt), title: parent.title },
            )}
          </p>`
        }
        ${
          hasBefore &&
          html`<div class="chat-day">
            <button
              type="button"
              class="ss-btn ss-btn--ghost ss-btn--sm"
              onClick=${() => actions.attempt(() => actions.loadEarlier(meetingId))}
            >
              ${t('加载更早的消息')}
            </button>
          </div>`
        }
        ${(messages ?? EMPTY).map(
          (message) =>
            html`<${Message}
              key=${message.id}
              message=${message}
              author=${
                byId.get(message.authorId) ??
                (message.authorId === LOCAL_USER_ID ? { kind: 'human' } : null)
              }
              roleNote=${roleOf(message.authorId)}
              target=${focus?.id === message.id}
              compact
            />`,
        )}
      </div>
    </div>
    <div class="ss-desk-chat__composer">
      <${Composer}
        key=${meetingId}
        meetingId=${meetingId}
        projectId=${projectId}
        running=${running}
        onStop=${() => actions.attempt(() => actions.interrupt(meetingId))}
        onSend=${(text, input) => actions.postMessage(meetingId, text, input)}
        slim
        placeholder="和专家讨论这份文稿，@ 点名"
      />
    </div>
  </section>`;
}
