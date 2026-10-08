// The global assistant is a meeting outside projects, shown beside the current
// page. Hiding this view retains its draft and leaves host execution running.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { routeHref } from '../route.js';
import { hideAssistantWindow, isNative, toggleAssistantWindow } from '../assistant-window.js';
import { AssistantModel } from './assistant-model.js';
import { AssistantSurface } from './assistant-surface.js';
import { MaterialsPanel } from './materials-panel.js';
import { FilePreview } from './file-preview.js';

/**
 * @param {{ onClose: () => void, detached?: boolean }} props
 * @returns {import('preact').VNode}
 */
export function AssistantPanel({ onClose, detached = false }) {
  const actions = useActions();
  const saved = useAppState((state) => state.assistantMeeting);
  const meeting =
    useAppState((state) => state.meetings.find((entry) => entry.id === saved?.id)) ?? saved;
  const settings = useAppState((state) => state.settings);
  const definition = useAppState((state) => state.participantDefinitions.agent_assistant);
  const projects = useAppState((state) => state.projects);
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
    class=${detached ? 'detached-shell assistant-rightpanel' : 'rightpanel assistant-rightpanel global-assistant-panel'}
    aria-label=${t('全局助手')}
  >
    <div
      class="panelhead between"
      data-tauri-drag-region
      onMouseDown=${(event) => {
        if (!detached || !isNative() || event.button !== 0 || event.target.closest('button'))
          return;
        event.preventDefault();
        void globalThis.__TAURI__.window
          .getCurrentWindow()
          .startDragging()
          .catch(() => {});
      }}
    >
      <strong>${t('全局助手')}</strong>
      <span class="spacer"></span>
      ${
        detached &&
        isNative() &&
        html`<button
          class="iconbtn"
          aria-label=${t('收起为悬浮球')}
          title=${t('收起为悬浮球')}
          onClick=${() => actions.attempt(toggleAssistantWindow)}
        >
          <${Icon} name="users" />
        </button>`
      }
      <button class="iconbtn" aria-label=${t('关闭助手')} title=${t('关闭助手')} onClick=${onClose}>
        <${Icon} name="close" />
      </button>
    </div>
    ${
      detached &&
      html`<div class="assistant-home-links">
        <small>${t('最近项目')}</small>
        ${projects
          .filter((project) => !project.archived)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 5)
          .map(
            (project) =>
              html`<a
                class="assistant-entry"
                href=${routeHref({ view: 'workbench', id: project.id })}
              >
                <${Icon} name="folder" /><span class="grow">${project.name}</span
                ><${Icon} name="right"
              /></a>`,
          )}
        <div class="detached-nav">
          ${projects.some((project) => !project.archived) && html`<a class="btn tiny" href=${routeHref({ view: 'workbench', id: projects.find((project) => !project.archived).id })}>${t('工作站')}</a>`}
          <a class="btn tiny" href=${routeHref({ view: 'library' })}>${t('数据库')}</a>
          <a class="btn tiny" href=${routeHref({ view: 'project-new' })}>${t('新建项目')}</a>
        </div>
      </div>`
    }
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

/** @returns {import('preact').VNode} */
export function AssistantWindow() {
  const actions = useActions();
  const target = useAppState((state) => state.materialsTarget);
  return html`<${FilePreview} /><${AssistantPanel}
      detached
      onClose=${() => actions.attempt(hideAssistantWindow)}
    />${target && html`<${MaterialsPanel} target=${target} />`}`;
}
