// The task secretary beside a meeting: an attached meeting of its own, shown
// in a right-side panel. Main stays mounted while the panel opens and closes;
// the secretary's draft lives in the store, so closing the panel during a
// turn never discards it.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { InfoTip } from './info-tip.js';
import { AssistantSurface } from './assistant-surface.js';
import { ModelPicker } from './model-picker.js';
import { SecretaryProposal } from './secretary-proposal.js';
import { SidePanel } from './side-panel.js';

const HELP = '发送前自动跟进主对话的新消息与工作站状态；回复失败或被停止时不推进位置。';
// Asked of the secretary often enough to be one click (design system PageChat).
const QUICK_ASKS = [
  { icon: 'circle-help', text: '还有什么值得继续追问？', tip: '直接发给秘书' },
  {
    icon: 'list-checks',
    text: '把待办加进研究计划',
    tip: '直接发给秘书；写进计划后可在历史版本里撤销',
  },
];

/**
 * @param {{ mainMeetingId: string, onClose: () => void, onBack?: () => void, backLabel?: string, withChatName?: boolean }} props
 * The desk opens it from its side panel, with an arrow back to the chat and the
 * chat's name after the title (`withChatName`).
 * @returns {import('preact').VNode}
 */
export function SecretaryPanel({
  mainMeetingId,
  onClose,
  onBack,
  backLabel,
  withChatName = false,
}) {
  const actions = useActions();
  const snapshot = useAppState((state) => state.secretary[mainMeetingId]);
  const version = useAppState((state) => state.secretaryVersion);
  const allTurns = useAppState((state) => state.turns);
  const meeting =
    useAppState((state) => state.meetings.find((entry) => entry.id === snapshot?.meeting?.id)) ??
    snapshot?.meeting;
  const settings = useAppState((state) => state.settings);
  const definitions = useAppState((state) => state.participantDefinitions);
  const main = useAppState((state) => state.meetings.find((entry) => entry.id === mainMeetingId));
  const [error, setError] = useState('');
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
  // Without its own model the secretary answers with its definition's model,
  // then Main's, then the default.
  const own = meeting?.policy.model;
  const inherited =
    definitions.agent_secretary?.definition.model ??
    main?.policy.model ??
    definitions.agent_main?.definition.model ??
    settings?.models?.default;
  const proposals = snapshot?.proposals ?? [];
  return html`<${SidePanel}
    name="secretary"
    title="任务秘书"
    detail=${withChatName ? (main?.title ?? '') : ''}
    closeLabel="关闭秘书"
    onClose=${onClose}
    onBack=${onBack}
    backLabel=${backLabel}
  >
    ${
      snapshot &&
      html`<div class="side-panel__note" data-follow-up>
        <span
          >${t('已跟进到主对话第 {seq} 条 · 纪要第 {revision} 版', { seq: snapshot.cursor?.throughSeq ?? 0, revision: snapshot.cursor?.minutesRevisionNumber ?? 0 })}</span
        ><${InfoTip} text=${t(HELP)} />
      </div>`
    }
    <${AssistantSurface}
      meeting=${meeting}
      scope="secretary"
      ownerId=${mainMeetingId}
      label="任务秘书"
      icon="clipboard-list"
      transcriptLabel="任务秘书对话记录"
      inputLabel="任务秘书输入"
      placeholder="问秘书，或让它整理纪要…"
      sendLabel="发送给任务秘书"
      stopLabel="停止秘书回复"
      role=${(own ?? inherited)?.model ?? ''}
      error=${error}
      onClose=${onClose}
      quickAsks=${QUICK_ASKS}
      model=${(running) =>
        meeting &&
        html`<${ModelPicker}
          own=${own}
          inherited=${inherited}
          inheritLabel="跟随秘书或主对话模型"
          label="秘书模型"
          disabled=${running}
          onChange=${(model) =>
            actions.attempt(() =>
              actions.updateMeeting(meeting.id, { policy: { ...meeting.policy, model } }),
            )}
        />`}
    >
      ${
        proposals.length > 0 &&
        html`<div class="side-panel__proposals">
          ${proposals.map((proposal) => html`<${SecretaryProposal} key=${proposal.id} proposal=${proposal} mainMeetingId=${mainMeetingId} />`)}
        </div>`
      }
    <//>
  <//>`;
}
