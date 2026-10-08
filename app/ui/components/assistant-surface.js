// Both assistant identities use meeting messages, drafts and the durable outbox.
// Closing a surface only unmounts its view; the host continues the turn.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { AssistantMessage } from './assistant-message.js';
import { Outbox } from './outbox.js';

const EMPTY = [];

/**
 * @param {{ meeting: any, scope: 'secretary' | 'global', ownerId: string,
 * label: string, transcriptLabel: string, inputLabel: string, placeholder: string,
 * sendLabel: string, stopLabel: string, modelControls: (running: boolean) => any, children?: any,
 * error?: string, onClose: () => void }} props
 * @returns {import('preact').VNode}
 */
export function AssistantSurface({
  meeting,
  scope,
  ownerId,
  label,
  transcriptLabel,
  inputLabel,
  placeholder,
  sendLabel,
  stopLabel,
  modelControls,
  children,
  error = '',
  onClose,
}) {
  const actions = useActions();
  const meetingId = meeting?.id;
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
  const scroller = useRef(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    if (follow.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, streamed]);
  useEffect(() => {
    const close = (event) => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
      // When both surfaces are open, Escape affects the one being used.
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
      await actions.postMessage(meetingId, text.trim());
      actions.secretaryDraft(meetingId, '', text);
      follow.current = true;
    } catch (failure) {
      setSendError(failure.message);
    } finally {
      setSending(false);
    }
  }

  return html`<section class="assistant-surface" data-scope=${scope} data-owner=${ownerId}>
    <div
      class="assistant-messages"
      ref=${scroller}
      aria-label=${t(transcriptLabel)}
      tabindex="0"
      onScroll=${(event) => {
        const box = event.currentTarget;
        follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      }}
    >
      ${messages.map((message) => html`<${AssistantMessage} key=${message.id} message=${message} label=${label} />`)}
    </div>
    <div class="assistant-feedback" role="status">
      ${error || sendError || (running || sending ? t('正在回复…') : meetingId ? t('已保存到本机') : t('正在读取…'))}
    </div>
    <div class="assistant-controls">
      <button
        class="btn tiny"
        data-assistant-action="history"
        disabled=${!hasBefore}
        onClick=${() => actions.attempt(() => actions.loadEarlier(meetingId))}
      >
        ${t('较早记录')}
      </button>
      <button
        class="btn tiny"
        data-assistant-action="latest"
        disabled=${!meetingId}
        onClick=${() =>
          actions.attempt(async () => {
            await actions.openMeeting(meetingId);
            follow.current = true;
            scroller.current.scrollTop = scroller.current.scrollHeight;
          })}
      >
        ${t('最新')}
      </button>
      <span class="grow"></span>
    </div>
    ${children}
    <div class="composer assistant-composer">
      ${meetingId && html`<${Outbox} meetingId=${meetingId} />`}
      <textarea
        data-assistant-input
        aria-label=${t(inputLabel)}
        placeholder=${t(placeholder)}
        value=${text}
        disabled=${!meetingId}
        onInput=${(event) => actions.secretaryDraft(meetingId, event.currentTarget.value)}
        onKeyDown=${(event) => {
          if (event.isComposing || event.keyCode === 229 || event.key !== 'Enter' || event.shiftKey)
            return;
          if ((sendKey === 'ctrl-enter') !== (event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          send();
        }}
      ></textarea>
      <div class="composerbar">
        <span class="spacer"></span>
        ${modelControls(running || sending)}
        ${running && html`<button class="sendbtn" data-assistant-action="stop" aria-label=${t(stopLabel)} onClick=${() => actions.attempt(() => actions.interrupt(meetingId))}>■</button>`}
        <button
          class="sendbtn"
          data-assistant-action="send"
          aria-label=${t(sendLabel)}
          disabled=${!meetingId || !text.trim() || sending}
          onClick=${send}
        >
          <${Icon} name="arrow" />
        </button>
      </div>
    </div>
  </section>`;
}
