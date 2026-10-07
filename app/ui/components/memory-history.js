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
  return html`<div class="rb-dialog" data-memory-history>
    <p role="alert">${error}</p>
    ${history.map(
      (entry) =>
        html`<article class="card" key=${entry.id}>
          <small
            >${formatTime(entry.createdAt)} ·
            ${entry.actorId === 'agent_secretary' ? t('任务秘书') : t('用户')}</small
          >
          <div
            class="rendered-markdown"
            dangerouslySetInnerHTML=${{ __html: renderMarkdown(entry.after?.body ?? '') }}
          ></div>
          <button
            class="btn tiny"
            disabled=${entry.undoneBy}
            onClick=${() => actions.attempt(() => actions.undo(entry.id))}
          >
            ${entry.undoneBy ? t('已撤销') : t('撤销')}
          </button>
        </article>`,
    )}
  </div>`;
}
