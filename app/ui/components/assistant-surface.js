// The conversation inside the secretary and global assistant panels: the same
// messages, activity timeline, approval cards and status line as a meeting,
// and a compact composer. Both use meeting messages, drafts and the durable
// outbox; the draft lives in the store, so closing a panel keeps it, and the
// host continues a running turn.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Message } from './chat-message.js';
import { ExecutionMode } from './execution-mode.js';
import { Outbox } from './outbox.js';
import { InputAdd, InputAttachments, useResearchInput } from './research-input.js';

const EMPTY = [];
const USER = { kind: 'human' };

/**
 * @param {{ meeting: any, scope: 'secretary' | 'global', ownerId: string,
 *   label: string, icon: string, role?: string, transcriptLabel: string, inputLabel: string,
 *   placeholder: string, sendLabel: string, stopLabel: string,
 *   model: (running: boolean) => any, children?: any, error?: string, onClose: () => void }} props
 * @returns {import('preact').VNode}
 */
export function AssistantSurface({
  meeting,
  scope,
  ownerId,
  label,
  icon,
  role = '',
  transcriptLabel,
  inputLabel,
  placeholder,
  sendLabel,
  stopLabel,
  model,
  children,
  error = '',
  onClose,
}) {
  const actions = useActions();
  const meetingId = meeting?.id;
  const researchInput = useResearchInput(meetingId, meeting?.projectId ?? null);
  const messages = useAppState((state) => state.messages[meetingId] ?? EMPTY);
  const streamed = useAppState((state) => state.drafts);
  const hasBefore = useAppState((state) => state.hasBefore[meetingId]);
  const text = useAppState((state) => state.secretaryDrafts[meetingId] ?? '');
  const sendKey = useAppState((state) => state.settings?.composer?.sendKey ?? 'enter');
  const running = useAppState((state) =>
    Object.values(state.running).some(
      (turn) =>
        turn.meetingId === meetingId &&
        state.messages[meetingId]?.some((message) => message.turnId === turn.id),
    ),
  );
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef(/** @type {HTMLElement | null} */ (null));
  const input = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const follow = useRef(true);
  const author = { kind: 'ai', name: t(label), icon };
  useLayoutEffect(() => {
    if (follow.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, streamed, children]);
  // The input grows with its text up to the stylesheet's max-height.
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);
  useEffect(() => {
    const close = (event) => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
      // When both panels are open, Escape closes the one being used.
      if (
        event.key === 'Escape' &&
        event.target.closest?.(`.assistant-surface[data-scope="${scope}"]`)
      ) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [scope, onClose]);

  async function send() {
    if (!meetingId || !text.trim() || sending) return;
    setSending(true);
    setSendError('');
    try {
      const snapshot = researchInput.value;
      await actions.postMessage(meetingId, text.trim(), snapshot);
      actions.secretaryDraft(meetingId, '', text);
      follow.current = true;
    } catch (failure) {
      setSendError(failure.message);
    } finally {
      setSending(false);
    }
  }

  const approval = meeting?.policy.approval ?? 'ask';
  const problem = error || sendError;
  // While an answer runs the button stops it; typed text is queued instead.
  const stops = running && !text.trim();
  return html`<section class="assistant-surface" data-scope=${scope} data-owner=${ownerId}>
    <div
      class="ss-content"
      ref=${scroller}
      aria-label=${t(transcriptLabel)}
      tabindex="0"
      onScroll=${(event) => {
        const box = event.currentTarget;
        follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      }}
    >
      <div class="ss-thread ss-thread--panel">
        ${
          hasBefore &&
          html`<div class="chat-day">
            <button
              type="button"
              class="ss-btn ss-btn--ghost ss-btn--sm"
              onClick=${() => actions.attempt(() => actions.loadEarlier(meetingId))}
            >
              ${t('加载更早的消息')}
            </button>
          </div>`
        }
        ${
          !meetingId &&
          !problem &&
          html`<div class="ss-status" role="status">
            <span class="ss-spin"></span><span>${t('正在读取…')}</span>
          </div>`
        }
        ${messages.map(
          (message) =>
            html`<${Message}
              key=${message.id}
              message=${message}
              author=${message.authorId === 'person_user' ? USER : author}
              roleNote=${role}
              target=${false}
              compact
            />`,
        )}
        ${children}
      </div>
    </div>
    ${
      problem &&
      html`<div class="ss-status ss-status--fail assistant-error" role="alert">
        <${Lucide} name="circle-alert" /><span>${problem}</span>
      </div>`
    }
    <div class="ss-composer-wrap">
      <div
        class="ss-composer"
        data-composer=${scope}
        onDrop=${researchInput.onDrop}
        onDragOver=${researchInput.onDragOver}
        onPaste=${researchInput.onPaste}
      >
        ${meetingId && html`<${InputAttachments} owner=${meetingId} projectId=${meeting.projectId} value=${researchInput.value} />`}
        ${meetingId && html`<${Outbox} meetingId=${meetingId} />`}
        <textarea
          ref=${input}
          class="ss-composer__input"
          rows="1"
          data-assistant-input
          aria-label=${t(inputLabel)}
          placeholder=${t(placeholder)}
          value=${text}
          disabled=${!meetingId}
          onInput=${(event) => actions.secretaryDraft(meetingId, event.currentTarget.value)}
          onKeyDown=${(event) => {
            if (
              event.isComposing ||
              event.keyCode === 229 ||
              event.key !== 'Enter' ||
              event.shiftKey
            )
              return;
            if ((sendKey === 'ctrl-enter') !== (event.ctrlKey || event.metaKey)) return;
            event.preventDefault();
            send();
          }}
        ></textarea>
        <div class="ss-composer__bar">
          ${meetingId && html`<${InputAdd} owner=${meetingId} projectId=${meeting.projectId} value=${researchInput.value} />`}
          ${
            meeting &&
            html`<${ExecutionMode}
              mode=${approval === 'ask' ? 'approval' : 'direct'}
              goals=${false}
              locked=${running}
              onChange=${(mode) => {
                const next = mode === 'approval' ? 'ask' : 'auto';
                if (next !== approval)
                  actions.attempt(() =>
                    actions.updateMeeting(meeting.id, {
                      policy: { ...meeting.policy, approval: next },
                    }),
                  );
              }}
            />`
          }
          <span class="ss-composer__spacer"></span>
          ${model(running || sending)}
          ${
            stops
              ? html`<button
                  type="button"
                  class="ss-send"
                  data-state="running"
                  data-assistant-action="stop"
                  aria-label=${t(stopLabel)}
                  data-tip=${t('停止')}
                  onClick=${() => actions.attempt(() => actions.interrupt(meetingId))}
                >
                  <span class="ss-send__stop"></span>
                </button>`
              : html`<button
                  type="button"
                  class="ss-send"
                  data-assistant-action="send"
                  aria-label=${t(sendLabel)}
                  data-tip=${running ? t('发送（排队，当前回答结束后发出）') : t('发送')}
                  data-kbd=${sendKey === 'ctrl-enter' ? 'Ctrl Enter' : 'Enter'}
                  disabled=${!meetingId || !text.trim() || sending}
                  onClick=${send}
                >
                  <${Lucide} name="arrow-up" />
                </button>`
          }
        </div>
      </div>
    </div>
  </section>`;
}
