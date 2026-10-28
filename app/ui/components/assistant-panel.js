// The global assistant is a meeting outside projects, shown beside the current
// page. Hiding this view retains its draft and leaves host execution running.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { routeHref } from '../route.js';
import { hideAssistantWindow, isNative, toggleAssistantWindow } from '../assistant-window.js';
import { AssistantSurface } from './assistant-surface.js';
import { MaterialsPanel } from './materials-panel.js';
import { FilePreview } from './file-preview.js';
import { ModelPicker } from './model-picker.js';
import { SidePanel } from './side-panel.js';

/** Recent projects and the main pages, for the separate assistant window. */
function HomeLinks() {
  const projects = useAppState((state) => state.projects);
  const open = projects
    .filter((project) => !project.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return html`<nav class="side-panel__home" data-assistant-home aria-label=${t('最近项目')}>
    <div class="ss-section-title">${t('最近项目')}</div>
    <div class="ss-list">
      ${open.slice(0, 5).map(
        (project) =>
          html`<a class="ss-list-row" href=${routeHref({ view: 'workbench', id: project.id })}>
            <${Lucide} name="folder" class="ss-list-row__icon" />
            <span class="ss-list-row__main"
              ><span class="ss-list-row__title">${project.name}</span></span
            >
          </a>`,
      )}
    </div>
    <div class="side-panel__links">
      ${open.length > 0 && html`<a class="ss-btn ss-btn--sm" href=${routeHref({ view: 'workbench', id: open[0].id })}>${t('工作站')}</a>`}
      <a class="ss-btn ss-btn--sm" href=${routeHref({ view: 'library' })}>${t('知识库')}</a>
      <a class="ss-btn ss-btn--sm" href=${routeHref({ view: 'project-new' })}>${t('新建项目')}</a>
    </div>
  </nav>`;
}

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
  const inherited = definition?.definition.model ?? settings?.models?.default;
  // The separate window has no title bar of its own: its head moves it.
  const drag = (event) => {
    if (!detached || !isNative() || event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    void globalThis.__TAURI__.window
      .getCurrentWindow()
      .startDragging()
      .catch(() => {});
  };
  return html`<${SidePanel}
    name="assistant"
    title="全局助手"
    closeLabel="关闭助手"
    onClose=${onClose}
    detached=${detached}
    onHeadPointerDown=${drag}
    className=${detached ? 'assistant-window' : 'global-assistant-panel'}
    buttons=${
      detached &&
      isNative() &&
      html`<button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('收起为悬浮球')}
        data-tip=${t('收起为悬浮球')}
        onClick=${() => actions.attempt(toggleAssistantWindow)}
      >
        <${Lucide} name="minimize-2" />
      </button>`
    }
  >
    ${detached && html`<${HomeLinks} />`}
    <${AssistantSurface}
      meeting=${meeting}
      scope="global"
      ownerId="global"
      label="全局助手"
      icon="sparkle"
      transcriptLabel="全局助手对话记录"
      inputLabel="全局助手输入"
      placeholder="哪些项目还有待办？也可以指定项目查阅。"
      sendLabel="发送给全局助手"
      stopLabel="停止助手回复"
      role=${(own ?? inherited)?.model ?? ''}
      error=${error}
      onClose=${onClose}
      model=${(running) =>
        meeting &&
        html`<${ModelPicker}
          own=${own}
          inherited=${inherited}
          inheritLabel="跟随全局助手默认模型"
          label="助手模型"
          disabled=${running}
          onChange=${(model) =>
            actions.attempt(() =>
              actions.updateMeeting(meeting.id, { policy: { ...meeting.policy, model } }),
            )}
        />`}
    />
  <//>`;
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
