// A proposed instruction for Main, drafted by the secretary. Edits stay local
// until the user fills the Main draft or dismisses it; keeping each keyed
// card mounted preserves the text during streaming events.
import { useEffect, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

const STATUS = {
  pending: { text: '待审阅', tone: 'ss-tag--warn' },
  filled: { text: '已填入草稿', tone: 'ss-tag--ok' },
  dismissed: { text: '已忽略', tone: '' },
};

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
  const pending = proposal.status === 'pending';
  const [open, setOpen] = useState(pending);
  // A saved text change (including undo) replaces the server version; ordinary
  // streaming snapshots with the same text leave the user's local edits intact.
  useEffect(() => setText(proposal.text), [proposal.text]);
  useEffect(() => setOpen(pending), [pending]);
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
  const status = STATUS[proposal.status] ?? STATUS.dismissed;
  return html`<section
    class="ss-proposal"
    data-proposal=${proposal.id}
    data-status=${proposal.status}
    aria-label=${t('秘书提案')}
  >
    <button
      type="button"
      class="ss-proposal__head"
      aria-expanded=${open}
      onClick=${() => setOpen(!open)}
    >
      <${Lucide} name="square-pen" /><span class="ss-proposal__title">${t('秘书提案')}</span
      ><span class=${`ss-tag ${status.tone}`}>${t(status.text)}</span
      ><${Lucide} name="chevron-down" class="ss-proposal__chev" />
    </button>
    ${
      open &&
      html`<div class="ss-proposal__body">
          ${
            pending
              ? html`<textarea
                  class="ss-textarea"
                  rows="3"
                  aria-label=${t('编辑秘书提案')}
                  value=${text}
                  onInput=${(event) => setText(event.currentTarget.value)}
                ></textarea>`
              : html`<p class="ss-proposal__text">${proposal.text}</p>`
          }
          ${error && html`<div class="ss-proposal__error" role="alert">${error}</div>`}
        </div>
        ${
          historyOpen &&
          html`<div class="ss-proposal__history" aria-label=${t('最近修改记录')}>
            ${history.length === 0 && html`<span class="ss-proposal__empty">${t('还没有修改')}</span>`}
            ${history.map(
              (entry) =>
                html`<div class="ss-proposal__change" key=${entry.id}>
                  <time>${formatTime(entry.createdAt)}</time>
                  <button
                    type="button"
                    class="ss-btn ss-btn--ghost ss-btn--sm"
                    disabled=${busy || entry.undoneBy}
                    onClick=${() =>
                      actions.attempt(async () => {
                        await actions.undoSecretaryProposal(entry.id);
                        await actions.secretarySnapshot(mainMeetingId);
                        setHistory(await actions.secretaryProposalHistory(proposal.id));
                      })}
                  >
                    ${entry.undoneBy ? t('已撤销') : t('撤销')}
                  </button>
                </div>`,
            )}
          </div>`
        }
        <div class="ss-proposal__foot">
          <button
            type="button"
            class="ss-btn ss-btn--ghost ss-btn--sm"
            aria-expanded=${historyOpen}
            onClick=${() => setHistoryOpen(!historyOpen)}
          >
            <${Lucide} name="history" /><span>${t('最近修改记录')}</span>
          </button>
          <span class="ss-composer__spacer"></span>
          ${
            pending &&
            html`<button
                type="button"
                class="ss-btn ss-btn--sm"
                data-assistant-action="dismiss-proposal"
                disabled=${busy}
                onClick=${() => resolve('dismissed')}
              >
                ${t('忽略')}
              </button>
              <button
                type="button"
                class="ss-btn ss-btn--primary ss-btn--sm"
                data-assistant-action="apply-proposal"
                disabled=${busy || !text.trim()}
                onClick=${() => resolve('filled')}
              >
                ${t('填入主对话草稿')}
              </button>`
          }
        </div>`
    }
  </section>`;
}
