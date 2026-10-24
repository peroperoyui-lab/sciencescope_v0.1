// Settings → 全局助手 (design system PageSettingsAssistant): the role and its
// desktop window, which opens at launch as configured and can be shown or
// hidden now.
import { hideAssistantWindow, isNative, openAssistantWindow } from '../assistant-window.js';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { BuiltInRole } from './settings-secretary.js';
import { Head, Row, Section, Seg, useSetting } from './settings-kit.js';

export function AssistantPage() {
  const actions = useActions();
  const [startup, write] = useSetting((settings) => settings.assistant?.startup ?? 'closed');
  const native = isNative();
  return html`<div class="ss-settings__inner" data-settings="assistant">
    <${Head} title=${t('全局助手')} desc=${t('跨项目查阅和整理，可以独立成一个小窗口。')} />
    <${BuiltInRole} id="agent_assistant" />
    <${Section} title=${t('窗口')} attrs=${{ 'data-assistant-window-settings': '' }}>
      <${Row}
        label=${t('启动 ScienceScope 时')}
        desc=${native ? t('下次启动生效') : t('只在桌面版里有效')}
      >
        <${Seg}
          label=${t('启动时')}
          value=${startup}
          options=${[
            ['closed', t('不打开')],
            ['orb', t('只显示浮球')],
            ['expanded', t('浮球和对话')],
          ]}
          onChange=${(next) => write({ assistant: { startup: next } })}
        />
      <//>
      ${
        native &&
        html`<${Row} label=${t('现在')} desc=${t('隐藏只关窗口，不清记录，也不停止正在做的事')}>
          <button
            type="button"
            class="ss-btn ss-btn--sm"
            onClick=${() => actions.attempt(() => openAssistantWindow(true))}
          >
            <${Lucide} name="eye" />${t('显示浮球')}
          </button>
          <button
            type="button"
            class="ss-btn ss-btn--sm"
            onClick=${() => actions.attempt(() => openAssistantWindow())}
          >
            <${Lucide} name="message-square" />${t('打开助手对话')}
          </button>
          <button
            type="button"
            class="ss-btn ss-btn--ghost ss-btn--sm"
            onClick=${() => actions.attempt(hideAssistantWindow)}
          >
            <${Lucide} name="eye-off" />${t('隐藏')}
          </button>
        <//>`
      }
    <//>
  </div>`;
}
