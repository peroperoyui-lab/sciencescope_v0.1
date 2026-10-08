// The global assistant is a meeting outside projects, shown beside the current
// page. Hiding this view retains its draft and leaves host execution running.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { AssistantModel } from './assistant-model.js';
import { AssistantSurface } from './assistant-surface.js';

/**
 * @param {{ onClose: () => void }} props
 * @returns {import('preact').VNode}
 */
export function AssistantPanel({ onClose }) {
  const actions = useActions();
  const saved = useAppState((state) => state.assistantMeeting);
  const meeting =
    useAppState((state) => state.meetings.find((entry) => entry.id === saved?.id)) ?? saved;
  const settings = useAppState((state) => state.settings);
  const definition = useAppState((state) => state.participantDefinitions.agent_assistant);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    actions
      .assistantSnapshot(true)
      .then(async (next) => {
        await actions.openMeeting(next.id);
        if (current) setError('');
      })
      .catch((failure) => current && setError(failure.message));
    return () => {
      current = false;
    };
  }, []);
  const own = meeting?.policy.model;
  const current = own ?? definition?.definition.model ?? settings?.models?.default;
  return html`<aside
    class="rightpanel assistant-rightpanel global-assistant-panel"
    aria-label=${t('全局助手')}
  >
    <div class="panelhead between">
      <strong>${t('全局助手')}</strong>
      <button class="iconbtn" aria-label=${t('关闭助手')} title=${t('关闭助手')} onClick=${onClose}>
        <${Icon} name="close" />
      </button>
    </div>
    <${AssistantSurface}
      meeting=${meeting}
      scope="global"
      ownerId="global"
      label="全局助手"
      transcriptLabel="全局助手对话记录"
      inputLabel="全局助手输入"
      placeholder="哪些项目还有待办？也可以指定项目查阅。"
      sendLabel="发送给全局助手"
      stopLabel="停止助手回复"
      error=${error}
      onClose=${onClose}
      modelControls=${(running) =>
        meeting &&
        html`<${AssistantModel}
          current=${current}
          own=${own}
          providers=${settings?.providers ?? []}
          running=${running}
          modelLabel="助手模型"
          effortLabel="助手思考强度"
          inheritLabel="使用全局助手默认模型"
          onUpdate=${(model) => actions.attempt(() => actions.updateMeeting(meeting.id, { policy: { ...meeting.policy, model } }))}
        />`}
    />
  </aside>`;
}
