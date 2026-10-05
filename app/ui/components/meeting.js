// A meeting: its record (messages streaming in live, tool cards on answers)
// and the composer. Everything shown comes from the store; the event stream
// keeps it current.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { LOCAL_USER_ID } from '../actions.js';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { routeHref } from '../route.js';
import { Avatar } from './common.js';

const EMPTY = [];

const STATUS_LABELS = {
  max_tokens: '回答达到模型的单次输出上限，后面的内容没有写出。',
  failed: '这次发言失败了。',
  cancelled: '已被打断。',
};

/** @param {any} value */
function pretty(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** @param {{ call: any }} props */
function ToolCard({ call }) {
  const icon = call.status === 'running' ? null : call.status === 'failed' ? 'alert' : 'check';
  return html`<details class=${`tool ${call.status}`}>
    <summary>
      ${icon ? html`<${Icon} name=${icon} />` : html`<span class="spinner"></span>`}
      <span class="grow ellipsis">${call.preamble || call.name}</span>
      <span class="tag">${call.name}</span>
    </summary>
    <div class="tool-body">
      ${call.preamble && html`<p>${call.preamble}</p>`}
      <div class="label">${t('参数')}</div>
      <pre>${pretty(call.args)}</pre>
      ${
        call.result != null &&
        html`<div class="label">${t('结果')}</div>
          <pre>${pretty(call.result)}</pre>`
      }
    </div>
  </details>`;
}

/** @param {{ text: string }} props */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return html`<button
    class="msgaction"
    onClick=${async () => {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }}
  >
    <${Icon} name=${copied ? 'check' : 'copy'} />${copied ? t('已复制') : t('复制')}
  </button>`;
}

/** @param {{ message: any, author: any, roleNote: string }} props */
function Message({ message, author, roleNote }) {
  const actions = useActions();
  const draft = useAppState((state) => state.drafts[message.id]);
  const calls = useAppState((state) =>
    message.turnId ? (state.toolCalls[message.turnId] ?? EMPTY) : EMPTY,
  );
  const streaming = message.status === 'streaming';
  const text = streaming ? (draft ?? message.text) : message.text;
  const human = author?.kind === 'human';
  const name = author?.name || (human ? t('我') : message.authorId);
  const notice = STATUS_LABELS[message.status];

  return html`<article class=${`message ${human ? 'user' : 'ai'} ${message.status}`}>
    <header class="messagehead">
      ${!human && html`<${Avatar} name=${name} />`}
      <span class="author">${name}</span>
      ${roleNote && html`<span class="role">${roleNote}</span>`}
      <time>${formatTime(message.createdAt)}</time>
    </header>
    <div class="messagebody">
      ${calls.map((call) => html`<${ToolCard} key=${call.id} call=${call} />`)}
      ${
        text
          ? html`<div
              class="markdown"
              dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}
            />`
          : streaming && html`<div class="thinking">${t('正在思考…')}</div>`
      }
      ${streaming && text && html`<span class="cursor"></span>`}
      ${notice && html`<div class=${`notice ${message.status}`}>${t(notice)}</div>`}
    </div>
    ${
      !streaming &&
      html`<footer class="msgactions">
        <${CopyButton} text=${message.text} />
        <button
          class="msgaction"
          onClick=${() => actions.forkMeeting(message.meetingId, message.id)}
        >
          <${Icon} name="branch" />${t('从此分支')}
        </button>
      </footer>`
    }
  </article>`;
}

/**
 * @param {{ meeting: any, members: any[], running: boolean }} props
 */
function Composer({ meeting, members, running }) {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const box = useRef(null);
  const model = settings?.models?.default;
  const sendKey = settings?.composer?.sendKey ?? 'enter';

  async function send() {
    const value = text.trim();
    if (!value) return;
    setError('');
    try {
      await actions.postMessage(meeting.id, value);
      setText('');
    } catch (failure) {
      setError(failure.message);
    }
  }

  function mention(member) {
    setText(
      (current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${member.name} `,
    );
    box.current?.focus();
  }

  return html`<div class="chatbottom">
    <div class="worktools">
      ${members
        .filter((member) => member.kind === 'ai')
        .map(
          (member) =>
            html`<button
              class="chip"
              title=${t('提及 {name}', { name: member.name })}
              onClick=${() => mention(member)}
            >
              @${member.name}
            </button>`,
        )}
    </div>
    <div class="composer">
      <textarea
        ref=${box}
        value=${text}
        placeholder=${t('输入问题或下一步工作…')}
        onInput=${(event) => setText(event.currentTarget.value)}
        onKeyDown=${(event) => {
          if (event.key !== 'Enter' || event.isComposing || event.shiftKey) return;
          const wantsModifier = sendKey === 'ctrl-enter';
          if (wantsModifier === (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            send();
          }
        }}
      ></textarea>
      <div class="composerbar">
        ${error && html`<span class="error">${error}</span>`}
        <span class="spacer"></span>
        <span class=${model ? 'model' : 'model warn'}>
          ${model ? `${model.provider} · ${model.model}` : t('未设置默认模型')}
        </span>
        ${
          running
            ? html`<button
                class="sendbtn stop"
                aria-label=${t('打断')}
                title=${t('打断')}
                onClick=${() => actions.interrupt(meeting.id)}
              >
                <${Icon} name="stop" />
              </button>`
            : html`<button
                class="sendbtn"
                aria-label=${t('发送')}
                title=${t('发送')}
                disabled=${!text.trim()}
                onClick=${send}
              >
                <${Icon} name="send" />
              </button>`
        }
      </div>
    </div>
  </div>`;
}

/** Keep the view at the bottom while new text arrives, unless the user scrolled up. */
function useStickToBottom(dependency) {
  const scroller = useRef(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && atBottom.current) element.scrollTop = element.scrollHeight;
  }, [dependency]);
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
    return html`<div class="empty">${loadError || t('找不到这个会议。')}</div>`;
  }
  const byId = new Map(participants.map((p) => [p.id, p]));
  const members = meeting.members.map((member) => ({
    ...byId.get(member.participantId),
    id: member.participantId,
    roleNote: member.roleNote,
  }));
  const roleOf = (id) => meeting.members.find((m) => m.participantId === id)?.roleNote ?? '';

  return html`<section class="main">
    <header class="mainhead">
      <div class="grow">
        <div class="crumb">
          ${
            project
              ? html`<a href=${routeHref({ view: 'workbench', id: project.id })}
                  >${project.name}</a
                >`
              : t('独立会议')
          }
          <span> / </span>
          ${members.map((member) => member.name ?? member.id).join('、')}
        </div>
        <strong class="head-title">${meeting.title}</strong>
      </div>
      ${
        project &&
        html`<a
          class="iconbtn"
          href=${routeHref({ view: 'workbench', id: project.id })}
          title=${t('工作站')}
          aria-label=${t('工作站')}
        >
          <${Icon} name="box" />
        </a>`
      }
    </header>
    <div class="messages" ref=${scroller} onScroll=${onScroll}>
      ${
        hasBefore &&
        html`<button class="btn tiny loadmore" onClick=${() => actions.loadEarlier(meetingId)}>
          ${t('加载更早的消息')}
        </button>`
      }
      ${loadError && html`<div class="notice failed">${loadError}</div>`}
      ${messages && messages.length === 0 && html`<div class="empty">${t('还没有消息。')}</div>`}
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
          />`,
      )}
    </div>
    <${Composer} meeting=${meeting} members=${members} running=${running} />
  </section>`;
}
