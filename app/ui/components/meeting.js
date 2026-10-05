// A meeting in the old interface's markup: the record (answers stream in
// live, tool calls show as activity cards with their preamble) and the
// composer. Everything shown comes from the store; the event stream keeps it
// current.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { LOCAL_USER_ID } from '../actions.js';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';
import { Composer } from './composer.js';
import { MainHead } from './mainhead.js';
import { FieldForm } from './overlays.js';

const EMPTY = [];

const STATUS_NOTES = {
  max_tokens: '回答达到模型的单次输出上限，后面的内容没有写出。',
  failed: '这次发言失败了。',
  cancelled: '已停止。',
};

const pad = (n) => String(n).padStart(2, '0');
/** "2026 / 09 / 17" @param {Date} date */
const dayLabel = (date) =>
  `${date.getFullYear()} / ${pad(date.getMonth() + 1)} / ${pad(date.getDate())}`;
/** "10:28" @param {Date} date */
const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** @param {any} value */
function pretty(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** One tool call as an activity card (`details.tool`). @param {{ call: any }} props */
function ToolCard({ call }) {
  return html`<details class=${`tool ${call.status}`}>
    <summary>
      ${
        call.status === 'running'
          ? html`<span class="ss-thinking"><i></i></span>`
          : html`<${Icon} name=${call.status === 'failed' ? 'close' : 'check'} />`
      }
      <span class="grow">${call.preamble || call.name}</span>
      <small>${call.name}</small>
      <${Icon} name="down" />
    </summary>
    <pre>${pretty(call.args)}</pre>
    ${call.result != null && html`<pre>${pretty(call.result)}</pre>`}
  </details>`;
}

/** @param {{ message: any }} props */
function MessageActions({ message }) {
  const actions = useActions();
  const [copied, setCopied] = useState(false);
  return html`<div class="msg-actions">
    <button
      title=${t('复制消息')}
      data-copied=${copied || undefined}
      onClick=${async () => {
        await navigator.clipboard?.writeText(message.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <${Icon} name=${copied ? 'check' : 'copy'} /><span>${copied ? t('已复制') : t('复制')}</span>
    </button>
    <button
      title=${t('从此消息开始独立分支')}
      onClick=${() => actions.attempt(() => actions.forkMeeting(message.meetingId, message.id))}
    >
      <${Icon} name="branch" /><span>${t('从此分支')}</span>
    </button>
  </div>`;
}

/** @param {{ message: any, author: any, roleNote: string }} props */
function Message({ message, author, roleNote }) {
  const draft = useAppState((state) => state.drafts[message.id]);
  const calls = useAppState((state) =>
    message.turnId ? (state.toolCalls[message.turnId] ?? EMPTY) : EMPTY,
  );
  const streaming = message.status === 'streaming';
  const text = streaming ? (draft ?? message.text) : message.text;
  const profileName = useAppState((state) => state.settings?.profile?.name);
  const human = author?.kind === 'human';
  // The local user is shown with the profile name, as in the user bar.
  const name =
    message.authorId === LOCAL_USER_ID
      ? profileName || t('用户')
      : author?.name || message.authorId;
  const created = new Date(message.createdAt);
  const time = html`<time title=${message.createdAt}>${clock(created)}</time>`;
  const note = STATUS_NOTES[message.status];

  if (human) {
    return html`<article class="message user" data-message-id=${message.id}>
      <div class="messagehead">${name} ${time}</div>
      <div class="messagebody"><div class="message-text">${message.text}</div></div>
      <${MessageActions} message=${message} />
    </article>`;
  }
  return html`<article
    class="message"
    data-message-id=${message.id}
    data-streaming=${streaming || undefined}
  >
    <div class="messagehead">
      <span class="avatar">${name.slice(0, 1).toUpperCase()}</span>${name}
      ${roleNote && html`<small>${roleNote}</small>`} ${time}
    </div>
    <div class="messagebody">
      ${calls.map((call) => html`<${ToolCard} key=${call.id} call=${call} />`)}
      <div
        class="message-text rendered-markdown"
        dangerouslySetInnerHTML=${{ __html: text ? renderMarkdown(text) : '' }}
      ></div>
      ${note && html`<div class="model-output-status">${t(note)}</div>`}
    </div>
    ${!streaming && html`<${MessageActions} message=${message} />`}
  </article>`;
}

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

/** @param {{ meetingId: string }} props */
export function MeetingView({ meetingId }) {
  const actions = useActions();
  const meeting = useAppState((state) => state.meetings.find((m) => m.id === meetingId));
  const project = useAppState((state) => state.projects.find((p) => p.id === meeting?.projectId));
  const participants = useAppState((state) => state.participants);
  const messages = useAppState((state) => state.messages[meetingId]);
  const hasBefore = useAppState((state) => state.hasBefore[meetingId]);
  const drafts = useAppState((state) => state.drafts);
  const running = useAppState((state) =>
    Object.values(state.running).some((turn) => turn.meetingId === meetingId),
  );
  const [loadError, setLoadError] = useState('');
  const { scroller, onScroll } = useStickToBottom([messages, drafts]);

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
  const last = messages?.at(-1);
  const forkAtLast = () => last && actions.attempt(() => actions.forkMeeting(meeting.id, last.id));
  const menuItems = [
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
      check: meeting.pinned,
      run: () =>
        actions.attempt(() => actions.updateMeeting(meeting.id, { pinned: !meeting.pinned })),
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
  return html`<main class="main">
    <${MainHead} crumb=${project?.name ?? t('独立对话')} title=${meeting.title}>
      <button
        class="iconbtn"
        title=${t('工作区菜单')}
        aria-label=${t('工作区菜单')}
        onClick=${(event) => actions.openMenu(event, menuItems, meeting.title)}
      >
        <${Icon} name="more" />
      </button>
    <//>
    <div class="mainbody">
      <div class="chatlayout">
        <div class="chatcol">
          <div
            class="messages"
            tabindex="0"
            aria-label=${t('对话记录')}
            ref=${scroller}
            onScroll=${onScroll}
          >
            ${
              hasBefore &&
              html`<div class="day-separator">
                <button class="linklike" onClick=${() => actions.loadEarlier(meetingId)}>
                  ${t('加载更早的消息')}
                </button>
              </div>`
            }
            ${loadError && html`<div class="inline-empty">${loadError}</div>`}
            ${(messages ?? EMPTY).map((message) => {
              const day = dayLabel(new Date(message.createdAt));
              const separator =
                day !== previousDay &&
                html`<div class="day-separator" key=${`day-${day}`}>${day}</div>`;
              previousDay = day;
              return html`${separator}<${Message}
                  key=${message.id}
                  message=${message}
                  author=${
                    byId.get(message.authorId) ??
                    (message.authorId === LOCAL_USER_ID ? { kind: 'human' } : null)
                  }
                  roleNote=${roleOf(message.authorId)}
                />`;
            })}
          </div>
          <div class="chatbottom">
            <div class="worktools">
              <button class="btn tiny" disabled=${!last || running} onClick=${forkAtLast}>
                ${t('从此分支')}
              </button>
              <span class="spacer"></span>
            </div>
            <${Composer}
              key=${meeting.id}
              running=${running}
              onStop=${() => actions.attempt(() => actions.interrupt(meeting.id))}
              onSend=${(text) => actions.postMessage(meeting.id, text)}
            />
          </div>
        </div>
      </div>
    </div>
  </main>`;
}
