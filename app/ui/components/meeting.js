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
import { navigate, routeHref } from '../route.js';
import { Composer } from './composer.js';
import { GoalPanel } from './goal-panel.js';
import { CitedMarkdown } from './cited-markdown.js';
import { InputReceipt, showInputContext } from './research-input.js';
import { ExpertState, ReviewAdoption, expertState } from './discussion-message.js';
import { DiscussionStrip } from './discussion-strip.js';
import { MainHead } from './mainhead.js';
import { MinutesDialog } from './minutes-dialog.js';
import { Deliverables } from './deliverables.js';
import { ToolActivity } from './meeting-tool.js';
import { MemoryStatusDialog } from './memory-status.js';
import { SecretaryPanel } from './secretary-panel.js';
import { FieldForm } from './overlays.js';
import { ProjectSummary } from './project-summary.js';

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
    <button
      title=${t('消息菜单')}
      aria-label=${t('消息菜单')}
      onClick=${(event) =>
        actions.openMenu(
          event,
          [
            {
              text: t('复制消息'),
              icon: 'copy',
              run: () => navigator.clipboard?.writeText(message.text),
            },
            { text: t('引用到输入框'), icon: 'chat', run: () => actions.quote(message) },
            {
              text: t('本次上下文'),
              run: () =>
                showInputContext(actions, message.researchInput ?? { materials: [], marks: [] }),
            },
            {
              text: t('复制消息位置'),
              icon: 'link',
              run: () =>
                navigator.clipboard?.writeText(
                  `${location.origin}/${routeHref({ view: 'meeting', id: `${message.meetingId}/${message.id}` })}`,
                ),
            },
          ],
          t('消息'),
        )}
    >
      <${Icon} name="more" />
    </button>
  </div>`;
}

/** What the person can do after an answer that did not finish. @param {{ message: any }} props */
function OutputStatus({ message }) {
  const actions = useActions();
  const note = STATUS_NOTES[message.status];
  if (!note) return null;
  return html`<div class="model-output-status">
    <span>${t(note)}</span>
    ${
      message.status === 'max_tokens'
        ? html`<button
            class="btn tiny"
            onClick=${() => actions.attempt(() => actions.continueAnswer(message.id))}
          >
            ${t('继续')}
          </button>`
        : html`<button
            class="btn tiny"
            onClick=${() => actions.attempt(() => actions.retry(message.id))}
          >
            ${t('重试')}
          </button>`
    }
  </div>`;
}

/** @param {{ message: any, author: any, roleNote: string, target: boolean }} props */
function Message({ message, author, roleNote, target }) {
  const draft = useAppState((state) => state.drafts[message.id]);
  const calls = useAppState((state) =>
    message.turnId ? (state.toolCalls[message.turnId] ?? EMPTY) : EMPTY,
  );
  const streaming = message.status === 'streaming';
  const text = streaming ? (draft ?? message.text) : message.text;
  const profileName = useAppState((state) => state.settings?.profile?.name);
  const fullAuthor = useAppState((state) => state.participantDefinitions?.[message.authorId]);
  const expert = Boolean(message.refs?.discussion || fullAuthor?.definition?.panel);
  const review = message.refs?.discussion?.kind === 'review';
  const state = expertState(message, calls);
  const duty = roleNote || fullAuthor?.definition?.role;
  const human = author?.kind === 'human';
  // The local user is shown with the profile name, as in the user bar.
  const name =
    message.authorId === LOCAL_USER_ID
      ? profileName || t('用户')
      : author?.name || message.authorId;
  const created = new Date(message.createdAt);
  const time = html`<time title=${message.createdAt}>${clock(created)}</time>`;
  if (human) {
    return html`<article
      class=${`message user ${target ? 'msg-target' : ''}`}
      data-message-id=${message.id}
    >
      <div class="messagehead">${name} ${time}</div>
      <div class="messagebody"><div class="message-text">${message.text}</div></div>
      <${InputReceipt} message=${message} />
      <${MessageActions} message=${message} />
    </article>`;
  }
  return html`<article
    class=${`message ${expert ? 'expert-message' : ''} ${review ? 'review-message' : ''} ${target ? 'msg-target' : ''}`}
    data-message-id=${message.id}
    data-streaming=${streaming || undefined}
    data-expert-state=${expert ? state : undefined}
  >
    <div class="messagehead">
      <span class="avatar">${name.slice(0, 1).toUpperCase()}</span>${name}
      ${duty && html`<small>${duty}</small>`}
      ${review && html`<span class="expert-badge">${t('审核')}</span>`}
      ${expert && html`<${ExpertState} message=${message} calls=${calls} />`} ${time}
    </div>
    <div class="messagebody">
      <${ToolActivity} calls=${calls} running=${streaming} />
      <${CitedMarkdown} message=${message} text=${text} />
      <${Deliverables} files=${message.deliverables} />
      <${OutputStatus} message=${message} />
      ${review && html`<${ReviewAdoption} message=${message} />`}
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
  return html`<div class="findbar">
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
        if (event.key === 'Escape') onClose();
        if (event.key === 'Enter' && !event.isComposing) step(event.shiftKey ? -1 : 1);
      }}
    />
    <small>${lower ? (matches.length ? `${current + 1} / ${matches.length}` : '0 / 0') : ''}</small>
    <button
      class="iconbtn"
      title=${t('上一个')}
      aria-label=${t('上一个')}
      onClick=${() => step(-1)}
    >
      <${Icon} name="up" />
    </button>
    <button class="iconbtn" title=${t('下一个')} aria-label=${t('下一个')} onClick=${() => step(1)}>
      <${Icon} name="down" />
    </button>
    <span class="spacer"></span>
    <button class="iconbtn" title=${t('关闭查找')} aria-label=${t('关闭查找')} onClick=${onClose}>
      <${Icon} name="close" />
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
  // Scroll the found (or linked) message into view.
  useEffect(() => {
    if (!target) return;
    scroller.current
      ?.querySelector(`[data-message-id="${target}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [target, messages]);

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
  return html`<main class="main">
    <${MainHead} crumb=${project?.name ?? t('独立对话')} title=${meeting.title}>
      <button
        class="iconbtn"
        title=${t('查找当前对话 · Ctrl F')}
        aria-label=${t('查找当前对话 · Ctrl F')}
        onClick=${() => setFinding(true)}
      >
        <${Icon} name="search" />
      </button>
      ${
        project &&
        html`<button
          class="iconbtn"
          title=${t('项目置顶摘要')}
          aria-label=${t('项目置顶摘要')}
          aria-expanded=${summary}
          onClick=${() => setSummary(!summary)}
        >
          <${Icon} name="summary" />
        </button>`
      }
      <button
        class="iconbtn"
        title=${t('会议秘书')}
        aria-label=${t('会议秘书')}
        aria-expanded=${secretary}
        onClick=${() => setSecretary(!secretary)}
      >
        <${Icon} name="book" />
      </button>
      <button
        class="iconbtn"
        title=${t('工作区菜单')}
        aria-label=${t('工作区菜单')}
        data-workspace-menu
        onClick=${(event) => actions.openMenu(event, menuItems, meeting.title)}
      >
        <${Icon} name="more" />
      </button>
    <//>
    <div class="mainbody">
      <div class=${`chatlayout ${compact ? 'hide-tools' : ''}`}>
        <div class="chatcol">
          <${GoalPanel} meetingId=${meeting.id} />
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
                  target=${message.id === target}
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
              meetingId=${meeting.id}
              running=${running}
              onStop=${() => actions.attempt(() => actions.interrupt(meeting.id))}
              projectId=${meeting.projectId}
              onSend=${(text, input) => actions.postMessage(meeting.id, text, input)}
              onGoal=${(text, input, maxRounds) => actions.startGoal(meeting.id, text, maxRounds, input)}
            />
          </div>
        </div>
        <div class=${`workspace-panel-slot ${secretary ? 'is-open' : ''}`}>
          ${secretary && html`<${SecretaryPanel} mainMeetingId=${meeting.id} onClose=${() => setSecretary(false)} />`}
        </div>
      </div>
    </div>
    ${summary && project && html`<${ProjectSummary} project=${project} onClose=${() => setSummary(false)} />`}
  </main>`;
}
