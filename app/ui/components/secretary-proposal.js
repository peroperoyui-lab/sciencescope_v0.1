// Proposal edits remain local until an explicit fill or dismiss action.
// Keeping each keyed card mounted preserves its text during streaming events.
import { useEffect, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';

/**
 * @param {{ proposal: any, mainMeetingId: string }} props
 * @returns {import('preact').VNode}
 */
export function SecretaryProposal({ proposal, mainMeetingId }) {
  const actions = useActions();
  const [text, setText] = useState(proposal.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  // A saved text change (including undo) replaces the server version; ordinary
  // streaming snapshots with the same text leave the user's local edits intact.
  useEffect(() => setText(proposal.text), [proposal.text]);
  useEffect(() => {
    if (historyOpen)
      actions
        .secretaryProposalHistory(proposal.id)
        .then(setHistory)
        .catch((failure) => setError(failure.message));
  }, [historyOpen, proposal]);
  async function resolve(status) {
    setBusy(true);
    setError('');
    try {
      await actions.resolveSecretaryProposal(proposal.id, { status, text });
      if (status === 'filled') actions.fillMainDraft(mainMeetingId, text);
      await actions.secretarySnapshot(mainMeetingId);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return html`<details
    open=${proposal.status === 'pending'}
    class="assistant-proposal"
    data-proposal=${proposal.id}
  >
    <summary>
      ${proposal.status === 'pending' ? t('秘书提案 · 请审阅') : proposal.status === 'filled' ? t('秘书提案 · 已填入草稿') : t('秘书提案 · 已忽略')}
    </summary>
    ${
      proposal.status === 'pending'
        ? html`
            <textarea
              aria-label=${t('编辑秘书提案')}
              value=${text}
              onInput=${(event) => setText(event.currentTarget.value)}
            ></textarea>
            <button
              class="btn tiny"
              data-assistant-action="apply-proposal"
              disabled=${busy || !text.trim()}
              onClick=${() => resolve('filled')}
            >
              ${t('确认填入主对话草稿')}
            </button>
            <button
              class="btn tiny"
              data-assistant-action="dismiss-proposal"
              disabled=${busy}
              onClick=${() => resolve('dismissed')}
            >
              ${t('忽略')}
            </button>
          `
        : html`<p>${proposal.text}</p>`
    }
    <details onToggle=${(event) => setHistoryOpen(event.currentTarget.open)}>
      <summary>${t('最近修改记录')}</summary>
      ${history.map(
        (entry) =>
          html`<div class="listrow" key=${entry.id}>
            <span class="grow">${formatTime(entry.createdAt)}</span>
            <button
              class="btn tiny"
              disabled=${busy || entry.undoneBy}
              onClick=${() =>
                actions.attempt(async () => {
                  await actions.undoSecretaryProposal(entry.id);
                  await actions.secretarySnapshot(mainMeetingId);
                })}
            >
              ${entry.undoneBy ? t('已撤销') : t('撤销')}
            </button>
          </div>`,
      )}
    </details>
    <p role="status">${error}</p>
  </details>`;
}
