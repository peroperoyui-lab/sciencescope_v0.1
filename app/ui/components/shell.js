// Window chrome: the top bar (brand, current project, native window
// controls) and the status bar (connection, language).
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { currentLanguage, t } from '../i18n/index.js';
import { routeHref } from '../route.js';

/**
 * The Tauri window, when running inside the native shell (`withGlobalTauri`).
 * In a plain browser there are no window controls to show.
 */
function nativeWindow() {
  return globalThis.__TAURI__?.window?.getCurrentWindow?.() ?? null;
}

/** @param {{ projectName?: string }} props */
export function Topbar({ projectName }) {
  const win = nativeWindow();
  return html`<header class="topbar" data-tauri-drag-region>
    <a class="brand" href=${routeHref({ view: 'home' })}>
      <img src="/assets/logo.png" alt="" />ScienceScope
    </a>
    <span class="spacer" data-tauri-drag-region></span>
    ${projectName && html`<span class="muted">${projectName}</span>`}
    ${
      win &&
      html`<span class="windowctl">
        <button aria-label=${t('最小化')} onClick=${() => win.minimize()}>–</button>
        <button aria-label=${t('最大化')} onClick=${() => win.toggleMaximize()}>□</button>
        <button aria-label=${t('关闭')} onClick=${() => win.close()}>×</button>
      </span>`
    }
  </header>`;
}

export function Footbar() {
  const actions = useActions();
  const connected = useAppState((state) => state.connected);
  const language = currentLanguage();
  return html`<footer class="foot">
    <span class=${`statusdot ${connected ? 'ok' : 'off'}`}></span>
    <span>${connected ? t('本机服务已连接') : t('与本机服务的连接已断开，正在重连…')}</span>
    <span class="spacer"></span>
    <button
      onClick=${() =>
        actions.updateSettings({ appearance: { language: language === 'en' ? 'zh' : 'en' } })}
    >
      ${language === 'en' ? '中文' : 'English'}
    </button>
  </footer>`;
}
