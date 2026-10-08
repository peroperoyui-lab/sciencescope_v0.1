// Secretary and global assistant transcripts share the approved message markup.
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { renderMarkdown } from '../markdown.js';
import { Deliverables } from './deliverables.js';
import { ToolCard } from './meeting-tool.js';
import { InputReceipt } from './research-input.js';

const EMPTY = [];

/**
 * @param {{ message: any, label: string }} props
 * @returns {import('preact').VNode}
 */
export function AssistantMessage({ message, label }) {
  const actions = useActions();
  const draft = useAppState((state) => state.drafts[message.id]);
  const calls = useAppState((state) => state.toolCalls[message.turnId] ?? EMPTY);
  const name = useAppState((state) => state.settings?.profile?.name);
  const isUser = message.authorId === 'person_user';
  const text = message.status === 'streaming' ? (draft ?? message.text) : message.text;
  const note = {
    failed: '这次发言失败了。',
    cancelled: '已停止。',
    max_tokens: '回答达到模型的单次输出上限，后面的内容没有写出。',
  }[message.status];
  return html`<article
    class=${`assistant-message ${isUser ? 'user' : ''}`}
    data-assistant-message=${message.id}
  >
    <small>${isUser ? name || t('用户') : t(label)}</small>
    <div class="turn-activity-host">
      ${calls.map((call) => html`<${ToolCard} key=${call.id} call=${call} />`)}
    </div>
    <div
      class="message-text rendered-markdown"
      dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}
    ></div>
    <${Deliverables} files=${message.deliverables} />
    <${InputReceipt} message=${message} />
    ${
      note &&
      html`<div class="model-output-status" role="status">
        <span>${t(note)}</span>
        <button
          class="btn tiny"
          onClick=${() =>
            actions.attempt(() =>
              message.status === 'max_tokens'
                ? actions.continueAnswer(message.id)
                : actions.retry(message.id),
            )}
        >
          ${message.status === 'max_tokens' ? t('继续') : t('重试')}
        </button>
      </div>`
    }
  </article>`;
}
