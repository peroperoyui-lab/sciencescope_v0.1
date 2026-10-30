// The desk's 「来源」 tab (design system PageDeskSources): every source the
// open document uses, from its indexes and from the answers in the bound chat,
// grouped by kind. Each source opens to the sentences or answers that use it,
// with 定位 back to the text or 打开对话. A read-only summary: indexes are
// managed in 「批注与索引」, chat sources come with the answers.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { collectSources } from '../desk-sources.js';

const EMPTY = [];

// Groups in the order shown; the keys are what `groupOf` returns.
const GROUPS = [
  ['files', '项目文件'],
  ['library', '资料库'],
  ['items', '知识库条目'],
  ['messages', '对话消息'],
];

/**
 * @param {{ indexes: any[], meetingId: string | null, authorName: (item: any) => string,
 *   onLocate: (item: any) => void, onOpen: (reference: any) => void,
 *   onChat: (messageId: string) => void }} props
 * `onLocate` brings an index's words into view; `onOpen` previews a source;
 * `onChat` shows the bound chat at that answer.
 */
export function DeskSources({ indexes, meetingId, authorName, onLocate, onOpen, onChat }) {
  const actions = useActions();
  const messages = useAppState((state) => (meetingId ? state.messages[meetingId] : null));
  const toolCalls = useAppState((state) => state.toolCalls);
  const participants = useAppState((state) => state.participants);
  const meetings = useAppState((state) => state.meetings);
  const [from, setFrom] = useState('all');
  const [open, setOpen] = useState(/** @type {Record<string, boolean>} */ ({}));

  // The chat tab may not have loaded the bound chat yet.
  useEffect(() => {
    if (meetingId && !messages) actions.attempt(() => actions.openMeeting(meetingId));
  }, [meetingId]);

  const all = collectSources(indexes, messages ?? EMPTY, toolCalls);
  const shown = all.filter((entry) =>
    from === 'index' ? entry.index : from === 'chat' ? entry.chat : true,
  );
  const chatTitle = meetings.find((meeting) => meeting.id === meetingId)?.title ?? '';
  const speaker = (message) =>
    participants.find((participant) => participant.id === message.authorId)?.name ??
    message.authorId;

  /** @param {any} use */
  const useRow = (use) => {
    if (use.kind === 'index') {
      const lost = use.item.status === 'lost';
      return html`<div class="ss-desk-src__use" key=${`i:${use.item.id}`}>
        <div class="ss-desk-src__from">
          <${Lucide} name="link-2" small />
          <span class="ss-truncate">${t('索引')} · ${authorName(use.item)}</span>
          ${
            lost
              ? html`<span class="ss-tag ss-tag--warn">${t('需重新定位')}</span>`
              : html`<button
                  type="button"
                  class="ss-btn ss-btn--ghost ss-btn--sm"
                  onClick=${() => onLocate(use.item)}
                >
                  ${t('定位')}
                </button>`
          }
        </div>
        <p class="ss-desk-card__quote" title=${use.item.quote?.exact}>${use.item.quote?.exact}</p>
      </div>`;
    }
    return html`<div class="ss-desk-src__use" key=${`m:${use.message.id}`}>
      <div class="ss-desk-src__from">
        <${Lucide} name="message-square" small />
        <span class="ss-truncate"
          >${t('对话')} · ${speaker(use.message)} ·
          ${chatTitle ? `${chatTitle} · ` : ''}${formatTime(use.message.createdAt)}</span
        >
        <button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          onClick=${() => onChat(use.message.id)}
        >
          ${t('打开对话')}
        </button>
      </div>
      ${use.quote && html`<p class="ss-desk-card__quote" title=${use.quote}>${use.quote}</p>`}
    </div>`;
  };

  /** @param {any} entry */
  const sourceRow = (entry) => {
    const pages = [...entry.pages].sort((a, b) => a - b);
    const count = entry.uses.length;
    const sub = [
      pages.length ? t('第 {n} 页', { n: pages.join('、') }) : '',
      t('用在 {n} 处', { n: count }),
    ]
      .filter(Boolean)
      .join(' · ');
    return html`<details
      key=${entry.key}
      class="ss-desk-src"
      data-source=${entry.key}
      open=${!!open[entry.key]}
      onToggle=${(event) => {
        const next = event.currentTarget.open;
        if (next !== !!open[entry.key]) setOpen((known) => ({ ...known, [entry.key]: next }));
      }}
    >
      <summary class="ss-list-row">
        <${Lucide} name=${entry.icon} class="ss-list-row__icon" />
        <span class="ss-list-row__main">
          <span class="ss-list-row__title" title=${entry.title}>${entry.title}</span>
          <span class="ss-list-row__sub">${sub}</span>
        </span>
        <span class="ss-list-row__meta">
          ${entry.index && html`<span class="ss-tag">${t('索引')}</span>`}
          ${entry.chat && html`<span class="ss-tag">${t('对话')}</span>`}
        </span>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('在预览里打开')}
          data-tip=${t('在预览里打开')}
          onClick=${(event) => {
            event.preventDefault();
            onOpen(entry.reference);
          }}
        >
          <${Lucide} name="external-link" />
        </button>
      </summary>
      <div class="ss-desk-src__uses">${entry.uses.map(useRow)}</div>
    </details>`;
  };

  const bar = html`<div class="ss-toolbar ss-desk-src-bar">
    <div class="ss-seg ss-seg--sm" role="group" aria-label=${t('来源从哪来')}>
      ${[
        ['all', t('全部')],
        ['index', t('文中索引')],
        ['chat', t('对话引用')],
      ].map(
        ([key, text]) =>
          html`<button
            type="button"
            key=${key}
            aria-pressed=${String(from === key)}
            onClick=${() => setFrom(key)}
          >
            ${text}
          </button>`,
      )}
    </div>
    <span class="ss-titlebar__spacer"></span>
    <span class="ss-muted ss-desk-src-bar__count">${t('{n} 份资料', { n: shown.length })}</span>
  </div>`;

  if (!all.length)
    return html`<div class="ss-panel__body">
      <div class="ss-empty">
        <div class="ss-empty__icon"><${Lucide} name="book-marked" /></div>
        <div class="ss-empty__title">${t('还没有来源')}</div>
        <div class="ss-empty__text">
          ${t('给句子添加索引，或在绑定的对话里让专家查资料后，会列在这里。')}
        </div>
      </div>
    </div>`;

  return html`${bar}
    <div class="ss-panel__body ss-desk-sources">
      ${GROUPS.map(([group, title]) => {
        const rows = shown
          .filter((entry) => entry.group === group)
          .sort((a, b) => b.uses.length - a.uses.length);
        return (
          rows.length > 0 &&
          html`<div class="ss-desk-src-group" key=${group}>
            <div class="ss-desk-src-group__title">${t(title)} · ${rows.length}</div>
            ${rows.map(sourceRow)}
          </div>`
        );
      })}
      ${
        !shown.length &&
        html`<p class="ss-muted ss-desk-sources__none">
          ${from === 'index' ? t('文中还没有索引。') : t('绑定的对话里还没有用到资料。')}
        </p>`
      }
      <p class="ss-prov">
        ${t('列出这份文稿用到的资料：文中的索引，加上绑定对话里专家回答时用到的资料。点资料在预览里打开，点「定位」回到正文那句。')}
      </p>
    </div>`;
}
