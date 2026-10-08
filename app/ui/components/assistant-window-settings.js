import { useLayoutEffect, useState } from 'preact/hooks';
import { hideAssistantWindow, isNative, openAssistantWindow } from '../assistant-window.js';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { InfoTip } from './info-tip.js';

/** @returns {import('preact').VNode} */
export function AssistantWindowSettings() {
  const actions = useActions();
  const saved = useAppState((state) => state.settings?.assistant?.startup ?? 'closed');
  const [startup, setStartup] = useState(saved);
  const [feedback, setFeedback] = useState('');
  useLayoutEffect(() => setStartup(saved), [saved]);
  const native = isNative();
  return html`<section data-assistant-window-settings>
    <h2>${t('桌面浮球与启动')}</h2>
    <form
      onSubmit=${async (event) => {
        event.preventDefault();
        const result = await actions.attempt(async () => {
          await actions.updateSettings({ assistant: { startup } });
          return true;
        });
        if (result) setFeedback(t('已保存，下次启动客户端生效。'));
      }}
    >
      <div class="field">
        <label for="assistant-startup"
          >${t('启动客户端时')}<${InfoTip} text=${t('下次启动生效；关闭客户端仍会完全退出。')}
        /></label>
        <select
          id="assistant-startup"
          name="startup"
          value=${startup}
          onChange=${(event) => setStartup(event.currentTarget.value)}
        >
          <option value="closed">${t('不打开助手')}</option>
          <option value="orb">${t('只显示浮球')}</option>
          <option value="expanded">${t('显示浮球与助手对话')}</option>
        </select>
      </div>
      <div class="saverow"><button class="btn" type="submit">${t('保存启动设置')}</button></div>
    </form>
    ${
      native &&
      html`<div class="saverow">
        <button class="btn" onClick=${() => actions.attempt(() => openAssistantWindow(true))}>
          ${t('显示浮球')}
        </button>
        <button class="btn" onClick=${() => actions.attempt(() => openAssistantWindow())}>
          ${t('打开助手对话')}
        </button>
        <button class="btn" onClick=${() => actions.attempt(hideAssistantWindow)}>
          ${t('隐藏浮球与对话')}
        </button>
        <${InfoTip}
          text=${t('隐藏只影响窗口，不清除历史，也不停止正在运行的任务；停止请使用助手输入框的中断按钮。')}
        />
      </div>`
    }
    <p role="status">${feedback}</p>
  </section>`;
}
