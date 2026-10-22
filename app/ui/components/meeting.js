// A meeting (design system PageChat): a 44px header, the conversation (answers
// stream in live with their activity timeline and status line) and the
// composer. Everything shown comes from the store; the event stream keeps it
// current.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { LOCAL_USER_ID } from '../actions.js';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { Composer } from './composer.js';
import { Message } from './chat-message.js';
import { DiscussionStrip } from './discussion-strip.js';
import { MinutesDialog } from './minutes-dialog.js';
import { MemoryStatusDialog } from './memory-status.js';
import { SecretaryPanel } from './secretary-panel.js';
import { FieldForm } from './overlays.js';
import { ProjectSummary } from './project-summary.js';

const EMPTY = [];

const pad = (n) => String(n).padStart(2, '0');
/** "2026 / 09 / 17" @param {Date} date */
const dayLabel = (date) =>
  `${date.getFullYear()} / ${pad(date.getMonth() + 1)} / ${pad(date.getDate())}`;

/** Keep the view at the bottom while new text arrives, unless the user scrolled up. */
function useStickToBottom(dependency) {
  const scroller = useRef(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && atBottom.current) element.scrollTop = element.scrollHeight;
  }, dependency);
  const onScroll = (event) => {
    const element = event.currentTarget;
    atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
  };
  return { scroller, onScroll };
}

/**
 * 查找当前对话: messages containing the text; Enter / arrows step through them.
 * @param {{ messages: any[], onTarget: (id: string | null) => void, onClose: () => void }} props
 */
function FindBar({ messages, onTarget, onClose }) {
  const [text, setText] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef(null);
  const lower = text.trim().toLowerCase();
  const matches = lower ? messages.filter((m) => m.text.toLowerCase().includes(lower)) : [];
  const current = matches.length ? Math.min(index, matches.length - 1) : 0;
  useEffect(() => input.current?.focus(), []);
  useEffect(() => onTarget(matches[current]?.id ?? null), [lower, current, matches.length]);
  const step = (by) => matches.length && setIndex((current + by + matches.length) % matches.length);
  return html`<div class="chat-find" role="search">
    <label class="ss-input ss-input--sm">
      <${Lucide} name="search" />
      <input
        ref=${input}
        placeholder=${t('查找当前对话')}
        aria-label=${t('查找当前对话')}
        value=${text}
        onInput=${(event) => {
          setText(event.currentTarget.value);
          setIndex(0);
        }}
        onKeyDown=${(event) => {
          if (event.key === 'Escape') {
            // Closing the find bar must not also stop a running answer.
            event.preventDefault();
            onClose();
          }
          if (event.key === 'Enter' && !event.isComposing) step(event.shiftKey ? -1 : 1);
        }}
      />
    </label>
    <span class="chat-find__count"
      >${lower ? (matches.length ? `${current + 1} / ${matches.length}` : '0 / 0') : ''}</span
    >
    <button
      type="button"
      class="ss-icon-btn ss-icon-btn--sm"
      aria-label=${t('上一个')}
      data-tip=${t('上一个')}
      onClick=${() => step(-1)}
    >
      <${Lucide} name="chevron-up" />
    </button>
    <button
      type="button"
      class="ss-icon-btn ss-icon-btn--sm"
      aria-label=${t('下一个')}
      data-tip=${t('下一个')}
      onClick=${() => step(1)}
    >
      <${Lucide} name="chevron-down" />
    </button>
    <button
      type="button"
      class="ss-icon-btn ss-icon-btn--sm"
      aria-label=${t('关闭查找')}
      data-tip=${t('关闭查找')}
      data-kbd="Esc"
      onClick=${onClose}
    >
      <${Lucide} name="x" />
    </button>
  </div>`;
}

/** @param {{ meetingId: string, focusMessageId?: string }} props */
export function MeetingView({ meetingId, focusMessageId }) {
  const actions = useActions();
  const meeting = useAppState((state) => state.meetings.find((m) => m.id === meetingId));
  const project = useAppState((state) => state.projects.find((p) => p.id === meeting?.projectId));
  const participants = useAppState((state) => state.participants);
  const messages = useAppState((state) => state.messages[meetingId]);
  const hasBefore = useAppState((state) => state.hasBefore[meetingId]);
  const drafts = useAppState((state) => state.drafts);
  const running = useAppState((state) =>
    // Background work records usage turns but has no message in this transcript.
    Object.values(state.running).some(
      (turn) =>
        turn.meetingId === meetingId &&
        state.messages[meetingId]?.some((message) => message.turnId === turn.id),
    ),
  );
  const compact = useAppState((state) => state.settings?.appearance?.transcript === 'compact');
  const [loadError, setLoadError] = useState('');
  const [finding, setFinding] = useState(false);
  const [summary, setSummary] = useState(false);
  const [secretary, setSecretary] = useState(false);
  const [target, setTarget] = useState(focusMessageId ?? null);
  const { scroller, onScroll } = useStickToBottom([messages, drafts]);

  // Ctrl+F opens the find bar for this meeting.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFinding(true);
      }
    };
    const onFind = () => setFinding(true);
    addEventListener('keydown', onKey);
    addEventListener('sciencescope:find', onFind);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('sciencescope:find', onFind);
    };
  }, []);
  // A new link into the same meeting (search, evidence) re-targets this view.
  useEffect(() => setTarget(focusMessageId ?? null), [focusMessageId]);
  // Scroll the found (or linked) message into view once. A linked message may
  // be older than the loaded page, so earlier pages load until it appears.
  const shown = useRef(/** @type {string|null} */ (null));
  const earlier = useRef(false);
  const [paged, setPaged] = useState(0);
  useEffect(() => {
    shown.current = null;
  }, [target]);
  useEffect(() => {
    if (!target || shown.current === target) return;
    const element = scroller.current?.querySelector(`[data-message-id="${target}"]`);
    if (element) {
      shown.current = target;
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (hasBefore && messages?.length && !earlier.current) {
      earlier.current = true;
      actions
        .loadEarlier(meetingId)
        .catch(() => {})
        .finally(() => {
          earlier.current = false;
          setPaged((count) => count + 1);
        });
    }
  }, [target, messages, hasBefore, paged]);

  useEffect(() => {
    setLoadError('');
    actions.openMeeting(meetingId).catch((error) => setLoadError(error.message));
  }, [meetingId]);

  if (!meeting) {
    return html`<main class="main">
      <div class="empty">${loadError || t('找不到这个对话。')}</div>
    </main>`;
  }
  const byId = new Map(participants.map((p) => [p.id, p]));
  const roleOf = (id) => meeting.members.find((m) => m.participantId === id)?.roleNote ?? '';
  const menuItems = [
    ...(project
      ? [
          {
            text: t('项目置顶摘要'),
            icon: 'newspaper',
            run: () => setSummary(true),
          },
        ]
      : []),
    {
      text: t('重命名'),
      icon: 'edit',
      run: () =>
        actions.openModal(
          t('重命名对话'),
          html`<${FieldForm}
            label=${t('名称')}
            value=${meeting.title}
            submitText=${t('保存')}
            onSubmit=${(title) => actions.updateMeeting(meeting.id, { title })}
          />`,
        ),
    },
    {
      text: meeting.pinned ? t('取消置顶') : t('置顶'),
      icon: 'pin',
      run: () =>
        actions.attempt(() => actions.updateMeeting(meeting.id, { pinned: !meeting.pinned })),
    },
    { sep: true },
    {
      text: t('创建新对话'),
      icon: 'chat',
      run: () => (project ? navigate({ view: 'new', id: project.id }) : actions.newIndependent()),
    },
    { text: t('创建独立新对话'), icon: 'plus', run: actions.newIndependent },
    {
      text: t('Python 环境'),
      icon: 'gear',
      run: () =>
        actions.attempt(() =>
          actions.pythonMenu(
            meeting.id,
            document.querySelector('[data-workspace-menu]').getBoundingClientRect(),
          ),
        ),
    },
    ...(project
      ? [
          {
            text: t('工作站'),
            icon: 'cube',
            run: () => navigate({ view: 'workbench', id: project.id }),
          },
        ]
      : []),
    {
      text: t('对话纪要'),
      icon: 'file',
      run: () =>
        actions.openModal(
          t('对话纪要'),
          html`<${MinutesDialog} meetingId=${meeting.id} />`,
          'minutes-modal',
        ),
    },
    ...(meeting.projectId
      ? [
          {
            text: t('整理这段对话'),
            icon: 'book',
            run: () =>
              actions.openModal(
                t('整理这段对话'),
                html`<${MemoryStatusDialog}
                  meetingId=${meeting.id}
                  projectId=${meeting.projectId}
                />`,
              ),
          },
        ]
      : []),
    { sep: true },
    {
      text: t('归档'),
      icon: 'folder',
      run: () =>
        actions.attempt(async () => {
          await actions.updateMeeting(meeting.id, { archived: true });
          navigate({ view: 'home' });
        }),
    },
  ];

  let previousDay = '';
  const members = meeting.members
    .map((member) => byId.get(member.participantId))
    .filter((participant) => participant && participant.kind !== 'human');
  return html`<main class="main ss-main">
    <div class="ss-header">
      <div class="ss-header__title" title=${meeting.title}><span>${meeting.title}</span></div>
      ${
        members.length > 0 &&
        html`<span class="ss-header__sep"></span>
          <span
            class="ss-avatars"
            style="align-self:center"
            data-tip=${members.map((member) => member.name).join('、')}
            >${members.slice(0, 4).map((member) => html`<span class="ss-avatar">${member.name.slice(0, 1).toUpperCase()}</span>`)}</span
          >`
      }
      <div class="ss-header__actions">
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('查找当前对话')}
          data-tip=${t('查找当前对话')}
          data-kbd="Ctrl F"
          onClick=${() => setFinding(true)}
        >
          <${Lucide} name="search" />
        </button>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('会议秘书')}
          aria-pressed=${String(secretary)}
          data-tip=${t('会议秘书')}
          onClick=${() => setSecretary(!secretary)}
        >
          <${Lucide} name="panel-right" />
        </button>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('工作区菜单')}
          data-tip=${t('更多')}
          data-workspace-menu
          onClick=${(event) => actions.openMenu(event, menuItems, meeting.title)}
        >
          <${Lucide} name="ellipsis" />
        </button>
      </div>
    </div>
    <div class=${`chatlayout ${compact ? 'hide-tools' : ''}`}>
      <div class="chat-col">
        ${meeting.policy.mode === 'round' && html`<${DiscussionStrip} meetingId=${meeting.id} running=${running} />`}
        ${
          finding &&
          html`<${FindBar}
            messages=${messages ?? EMPTY}
            onTarget=${setTarget}
            onClose=${() => {
              setFinding(false);
              setTarget(null);
            }}
          />`
        }
        <div
          class="ss-content"
          tabindex="0"
          aria-label=${t('对话记录')}
          ref=${scroller}
          onScroll=${onScroll}
        >
          <div class="ss-thread">
            ${
              hasBefore &&
              html`<div class="chat-day">
                <button
                  type="button"
                  class="ss-btn ss-btn--ghost ss-btn--sm"
                  onClick=${() => actions.loadEarlier(meetingId)}
                >
                  ${t('加载更早的消息')}
                </button>
              </div>`
            }
            ${loadError && html`<div class="chat-day">${loadError}</div>`}
            ${(messages ?? EMPTY).map((message) => {
              const day = dayLabel(new Date(message.createdAt));
              const separator =
                day !== previousDay && html`<div class="chat-day" key=${`day-${day}`}>${day}</div>`;
              previousDay = day;
              return html`${separator}<${Message}
                  key=${message.id}
                  message=${message}
                  author=${
                    byId.get(message.authorId) ??
                    (message.authorId === LOCAL_USER_ID ? { kind: 'human' } : null)
                  }
                  roleNote=${roleOf(message.authorId)}
                  target=${message.id === target}
                />`;
            })}
          </div>
        </div>
        <${Composer}
          key=${meeting.id}
          meetingId=${meeting.id}
          running=${running}
          onStop=${() => actions.attempt(() => actions.interrupt(meeting.id))}
          projectId=${meeting.projectId}
          onSend=${(text, input) => actions.postMessage(meeting.id, text, input)}
        />
      </div>
      ${secretary && html`<${SecretaryPanel} mainMeetingId=${meeting.id} onClose=${() => setSecretary(false)} />`}
    </div>
    ${summary && project && html`<${ProjectSummary} project=${project} onClose=${() => setSummary(false)} />`}
  </main>`;
}
