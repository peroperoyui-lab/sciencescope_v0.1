// The approved right-side secretary surface uses an attached meeting.
// Main stays mounted while this panel opens/closes; secretary input lives in
// the store so closing the panel during a turn never discards a typed draft.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { InfoTip } from './info-tip.js';
import { Deliverables } from './deliverables.js';
import { ToolCard } from './meeting-tool.js';
import { SecretaryModel } from './secretary-model.js';
import { SecretaryProposal } from './secretary-proposal.js';

const HELP = '发送前自动跟进主对话的新消息与工作站状态；回复失败或被停止时不推进位置。';
const EMPTY = [];

/**
 * @param {{ message: any }} props
 * @returns {import('preact').VNode}
 */
function SecretaryMessage({ message }) {
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
    <small>${isUser ? name || t('用户') : t('任务秘书')}</small>
    <div class="turn-activity-host">
      ${calls.map((call) => html`<${ToolCard} key=${call.id} call=${call} />`)}
    </div>
    <div
      class="message-text rendered-markdown"
      dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}
    ></div>
    <${Deliverables} files=${message.deliverables} />
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

/**
 * @param {{ mainMeetingId: string, onClose: () => void }} props
 * @returns {import('preact').VNode}
 */
export function SecretaryPanel({ mainMeetingId, onClose }) {
  const actions = useActions();
  const snapshot = useAppState((state) => state.secretary[mainMeetingId]);
  const version = useAppState((state) => state.secretaryVersion);
  const allTurns = useAppState((state) => state.turns);
  const meeting =
    useAppState((state) => state.meetings.find((entry) => entry.id === snapshot?.meeting?.id)) ??
    snapshot?.meeting;
  const meetingId = meeting?.id;
  const messages = useAppState((state) => state.messages[meetingId] ?? EMPTY);
  const streamed = useAppState((state) => state.drafts);
  const hasBefore = useAppState((state) => state.hasBefore[meetingId]);
  const text = useAppState((state) => state.secretaryDrafts[meetingId] ?? '');
  const running = useAppState((state) =>
    Object.values(state.running).some(
      (turn) =>
        turn.meetingId === meetingId &&
        state.messages[meetingId]?.some((message) => message.turnId === turn.id),
    ),
  );
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef(null);
  const input = useRef(null);
  const follow = useRef(true);
  const drag = useRef(null);

  useEffect(() => {
    let current = true;
    actions
      .secretarySnapshot(mainMeetingId, true)
      .then(async (next) => {
        await actions.openMeeting(next.meeting.id);
        if (current) setError('');
      })
      .catch((failure) => current && setError(failure.message));
    return () => {
      current = false;
    };
  }, [mainMeetingId]);
  useEffect(() => {
    if (!snapshot) return;
    let current = true;
    actions
      .secretarySnapshot(mainMeetingId)
      .catch((failure) => current && setError(failure.message));
    return () => {
      current = false;
    };
  }, [version, allTurns]);
  useLayoutEffect(() => {
    if (follow.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, streamed]);
  useEffect(() => {
    const close = (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);

  async function send() {
    const value = text.trim();
    if (!meetingId || !value || sending || running) return;
    setSending(true);
    setError('');
    try {
      await actions.postMessage(meetingId, value);
      actions.secretaryDraft(meetingId, '', text);
      follow.current = true;
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSending(false);
    }
  }

  return html`<aside class="rightpanel assistant-rightpanel" aria-label=${t('会议秘书')}>
    <div
      class="panel-resizer"
      data-v-resize
      onPointerDown=${(event) => {
        drag.current = {
          start: event.clientX,
          width: event.currentTarget.parentElement.clientWidth,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove=${(event) => {
        if (!drag.current) return;
        const layout = event.currentTarget.closest('.chatlayout');
        const width = Math.max(
          300,
          Math.min(innerWidth * 0.6, drag.current.width + drag.current.start - event.clientX),
        );
        layout.style.setProperty('--panel-width', width + 'px');
      }}
      onPointerUp=${() => {
        drag.current = null;
      }}
    ></div>
    <div class="panelhead between">
      <strong>${t('任务秘书')}</strong>
      <button class="iconbtn" aria-label=${t('关闭秘书')} title=${t('关闭秘书')} onClick=${onClose}>
        <${Icon} name="close" />
      </button>
    </div>
    <section class="assistant-surface" data-scope="secretary" data-owner=${mainMeetingId}>
      <div
        class="assistant-messages"
        ref=${scroller}
        aria-label=${t('任务秘书对话记录')}
        tabindex="0"
        onScroll=${(event) => {
          const box = event.currentTarget;
          follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        }}
      >
        ${messages.map((message) => html`<${SecretaryMessage} key=${message.id} message=${message} />`)}
      </div>
      <div class="assistant-feedback" role="status">
        ${error || (running || sending ? t('正在回复…') : meetingId ? t('已保存到本机') : t('正在读取…'))}
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
          ${t('最新')}</button
        ><span class="grow"></span>
      </div>
      <div class="assistant-follow-up">
        <span data-follow-up>
          ${
            snapshot
              ? t('已跟进到主对话第 {seq} 条 · 纪要第 {revision} 版', {
                  seq: snapshot.cursor?.throughSeq ?? 0,
                  revision: snapshot.cursor?.minutesRevisionNumber ?? 0,
                })
              : ''
          }</span
        ><${InfoTip} text=${t(HELP)} />
      </div>
      <div class="assistant-proposals">
        ${(snapshot?.proposals ?? []).map(
          (proposal) =>
            html`<${SecretaryProposal}
              key=${proposal.id}
              proposal=${proposal}
              mainMeetingId=${mainMeetingId}
            />`,
        )}
      </div>
      <div class="composer assistant-composer">
        <textarea
          ref=${input}
          data-assistant-input
          aria-label=${t('任务秘书输入')}
          placeholder=${t('先问清楚，再决定下一步…')}
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
            event.preventDefault();
            send();
          }}
        ></textarea>
        <div class="composerbar">
          <span class="spacer"></span>
          ${meeting && html`<${SecretaryModel} meeting=${meeting} mainMeetingId=${mainMeetingId} running=${running || sending} />`}
          ${
            running
              ? html`<button
                  class="sendbtn"
                  data-assistant-action="stop"
                  aria-label=${t('停止秘书回复')}
                  onClick=${() => actions.attempt(() => actions.interrupt(meetingId))}
                >
                  ■
                </button>`
              : html`<button
                  class="sendbtn"
                  data-assistant-action="send"
                  aria-label=${t('发送给任务秘书')}
                  disabled=${!meetingId || !text.trim() || sending}
                  onClick=${send}
                >
                  <${Icon} name="arrow" />
                </button>`
          }
        </div>
      </div>
    </section>
  </aside>`;
}
