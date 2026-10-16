// One message in a conversation (design system Message): the user's own
// messages as bubbles on the right; Main, experts and other AI participants
// with an avatar, name and model, their activity timeline, the answer, its
// files, one status line and actions that appear on hover.
import { useState } from 'preact/hooks';
import { LOCAL_USER_ID } from '../actions.js';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { routeHref } from '../route.js';
import { CitedMarkdown } from './cited-markdown.js';
import { Deliverables } from './deliverables.js';
import { ExpertState, ReviewAdoption } from './discussion-message.js';
import { InputReceipt, showInputContext } from './research-input.js';
import { StatusLine } from './status-line.js';
import { ActivityTimeline } from './timeline.js';

const EMPTY = [];
const pad = (n) => String(n).padStart(2, '0');
/** "10:28" @param {Date} date */
const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** @param {{ message: any, answer: boolean }} props */
function MessageFoot({ message, answer }) {
  const actions = useActions();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard?.writeText(message.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const menu = (event) =>
    actions.openMenu(
      event,
      [
        { text: t('引用到输入框'), icon: 'quote', run: () => actions.quote(message) },
        {
          text: t('从这里分支'),
          icon: 'git-branch',
          run: () => actions.attempt(() => actions.forkMeeting(message.meetingId, message.id)),
        },
        {
          text: t('本次上下文'),
          icon: 'info',
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
    );
  const created = new Date(message.createdAt);
  return html`<div class="ss-msg__foot">
    <button
      type="button"
      class="ss-icon-btn ss-icon-btn--sm"
      aria-label=${t('复制消息')}
      data-tip=${copied ? t('已复制') : t('复制')}
      onClick=${copy}
    >
      <${Lucide} name=${copied ? 'check' : 'copy'} />
    </button>
    ${
      answer &&
      html`<button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('重新回答')}
        data-tip=${t('重新回答')}
        onClick=${() => actions.attempt(() => actions.retry(message.id))}
      >
        <${Lucide} name="rotate-cw" />
      </button>`
    }
    <button
      type="button"
      class="ss-icon-btn ss-icon-btn--sm"
      aria-label=${t('消息菜单')}
      data-tip=${t('更多')}
      onClick=${menu}
    >
      <${Lucide} name="ellipsis" />
    </button>
    <time title=${message.createdAt}>${clock(created)}</time>
  </div>`;
}

/** @param {{ message: any, author: any, roleNote: string, target: boolean }} props */
export function Message({ message, author, roleNote, target }) {
  const draft = useAppState((state) => state.drafts[message.id]);
  const calls = useAppState((state) =>
    message.turnId ? (state.toolCalls[message.turnId] ?? EMPTY) : EMPTY,
  );
  const turn = useAppState((state) => (message.turnId ? state.turns[message.turnId] : undefined));
  const profileName = useAppState((state) => state.settings?.profile?.name);
  const fullAuthor = useAppState((state) => state.participantDefinitions?.[message.authorId]);
  const defaultModel = useAppState((state) => state.settings?.models?.default?.model);
  const streaming = message.status === 'streaming';
  const text = streaming ? (draft ?? message.text) : message.text;
  // A failed turn with no answer stores its reason as the text; the status
  // line shows it instead of the body.
  const reason =
    message.status === 'failed' && text.startsWith('这次发言失败了') ? text : undefined;
  if (author?.kind === 'human') {
    return html`<article
      class="ss-msg ss-msg--user"
      data-message-id=${message.id}
      data-target=${target || undefined}
      data-user
    >
      <div class="ss-msg__bubble message-text">${message.text}</div>
      <${InputReceipt} message=${message} />
      <${MessageFoot} message=${message} answer=${false} />
    </article>`;
  }
  const expert = Boolean(message.refs?.discussion || fullAuthor?.definition?.panel);
  const review = message.refs?.discussion?.kind === 'review';
  const name =
    message.authorId === LOCAL_USER_ID
      ? profileName || t('用户')
      : author?.name || message.authorId;
  // The role line names the duty, or the model the participant answers with.
  const role =
    roleNote ||
    fullAuthor?.definition?.role ||
    fullAuthor?.definition?.model?.model ||
    defaultModel;
  return html`<article
    class="ss-msg"
    data-message-id=${message.id}
    data-target=${target || undefined}
    data-streaming=${streaming || undefined}
    data-expert=${expert || undefined}
    data-review=${review || undefined}
  >
    <div class="ss-msg__head">
      <span class="ss-avatar">${name.slice(0, 1).toUpperCase()}</span>
      <span class="ss-msg__name">${name}</span>
      ${role && html`<span class="ss-msg__role">${role}</span>`}
      ${review && html`<span class="ss-tag">${t('审核')}</span>`}
      ${expert && html`<${ExpertState} message=${message} calls=${calls} />`}
    </div>
    <${ActivityTimeline} calls=${calls} running=${streaming} turn=${turn} />
    ${text && !reason && html`<div class="ss-msg__body"><${CitedMarkdown} message=${message} text=${text} /></div>`}
    <${Deliverables} files=${message.deliverables} />
    <${StatusLine} message=${message} calls=${calls} text=${text} reason=${reason} />
    ${review && html`<${ReviewAdoption} message=${message} />`}
    ${!streaming && html`<${MessageFoot} message=${message} answer=${true} />`}
  </article>`;
}
