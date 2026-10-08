// The approved right-side secretary surface uses an attached meeting.
// Main stays mounted while this panel opens/closes; secretary input lives in
// the store so closing the panel during a turn never discards a typed draft.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { InfoTip } from './info-tip.js';
import { AssistantSurface } from './assistant-surface.js';
import { SecretaryModel } from './secretary-model.js';
import { SecretaryProposal } from './secretary-proposal.js';

const HELP = '发送前自动跟进主对话的新消息与工作站状态；回复失败或被停止时不推进位置。';

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
  const [error, setError] = useState('');
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
        const width = Math.max(
          300,
          Math.min(innerWidth * 0.6, drag.current.width + drag.current.start - event.clientX),
        );
        event.currentTarget.closest('.chatlayout').style.setProperty('--panel-width', width + 'px');
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
    <${AssistantSurface}
      meeting=${meeting}
      scope="secretary"
      ownerId=${mainMeetingId}
      label="任务秘书"
      transcriptLabel="任务秘书对话记录"
      inputLabel="任务秘书输入"
      placeholder="先问清楚，再决定下一步…"
      sendLabel="发送给任务秘书"
      stopLabel="停止秘书回复"
      error=${error}
      onClose=${onClose}
      modelControls=${(running) => meeting && html`<${SecretaryModel} meeting=${meeting} mainMeetingId=${mainMeetingId} running=${running} />`}
    >
      <div class="assistant-follow-up">
        <span data-follow-up
          >${snapshot ? t('已跟进到主对话第 {seq} 条 · 纪要第 {revision} 版', { seq: snapshot.cursor?.throughSeq ?? 0, revision: snapshot.cursor?.minutesRevisionNumber ?? 0 }) : ''}</span
        ><${InfoTip} text=${t(HELP)} />
      </div>
      <div class="assistant-proposals">
        ${(snapshot?.proposals ?? []).map((proposal) => html`<${SecretaryProposal} key=${proposal.id} proposal=${proposal} mainMeetingId=${mainMeetingId} />`)}
      </div>
    <//>
  </aside>`;
}
