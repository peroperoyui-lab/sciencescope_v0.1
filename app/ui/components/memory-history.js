import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { renderMarkdown } from '../markdown.js';

/**
 * @param {{ itemId:string }} props
 * @returns {import('preact').VNode}
 */
export function MemoryHistory({ itemId }) {
  const actions = useActions();
  const version = useAppState((state) => state.researchVersion);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    actions
      .memoryHistory(itemId)
      .then(setHistory)
      .catch((failure) => setError(failure.message));
  }, [itemId, version]);
  return html`<div class="ss-revisions" data-memory-history>
    ${error && html`<p class="ss-field__error" role="alert">${error}</p>`}
    ${history.map(
      (entry) =>
        html`<article class="ss-item-card" key=${entry.id}>
          <span class="ss-item-card__meta"
            >${formatTime(entry.createdAt)} ·
            ${entry.actorId === 'agent_secretary' ? t('任务秘书') : t('用户')}</span
          >
          <div
            class="ss-prose"
            dangerouslySetInnerHTML=${{ __html: renderMarkdown(entry.after?.body ?? '') }}
          ></div>
          <div class="ss-item-card__actions">
            <button
              type="button"
              class="ss-btn ss-btn--ghost ss-btn--sm"
              disabled=${entry.undoneBy}
              onClick=${() => actions.attempt(() => actions.undo(entry.id))}
            >
              ${entry.undoneBy ? t('已撤销') : t('撤销')}
            </button>
          </div>
        </article>`,
    )}
  </div>`;
}
