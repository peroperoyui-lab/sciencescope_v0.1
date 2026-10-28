// Window chrome (TitleBar, StatusLine): the title bar with its menus and window
// controls, and the status bar with the connection to the local service.
import { useEffect } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { currentLanguage, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate, useRoute } from '../route.js';
import { FieldForm } from './overlays.js';
import { LogoMark } from '../illustrations.js';

/**
 * The Tauri window, when running inside the native shell (`withGlobalTauri`).
 * In a plain browser there are no window controls to show.
 */
function nativeWindow() {
  return globalThis.__TAURI__?.window?.getCurrentWindow?.() ?? null;
}

/** @param {{ projectName?: string, projectId?: string | null, meetingId?: string | null }} props */
export function Topbar({ projectName, projectId, meetingId = null }) {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const win = nativeWindow();
  const language = currentLanguage();
  const route = useRoute();
  const onTop = Boolean(settings?.appearance?.alwaysOnTop);
  // 窗口置顶 is a setting, so it survives a restart.
  useEffect(() => {
    if (settings) void win?.setAlwaysOnTop?.(onTop)?.catch?.(() => {});
  }, [onTop, Boolean(settings)]);
  const groups = [
    [
      {
        text: t('新对话'),
        icon: 'square-pen',
        key: settings?.shortcuts?.newChat,
        run: () =>
          projectId ? navigate({ view: 'new', id: projectId }) : actions.newIndependent(),
      },
      {
        text: t('独立快速对话'),
        icon: 'message-square',
        key: settings?.shortcuts?.independentChat,
        run: actions.newIndependent,
      },
      {
        text: t('新建项目'),
        icon: 'folder-plus',
        run: () => navigate({ view: 'project-new' }),
      },
      ...(meetingId || projectId ? [{ sep: true }] : []),
      ...(meetingId
        ? [
            {
              text: t('导出当前对话（Markdown）'),
              icon: 'download',
              run: () =>
                actions.attempt(() => actions.download(`/api/meetings/${meetingId}/export`)),
            },
          ]
        : []),
      ...(projectId
        ? [
            {
              text: t('导出项目快照'),
              icon: 'package',
              run: () =>
                actions.attempt(() => actions.download(`/api/projects/${projectId}/export`)),
            },
          ]
        : []),
    ],
    [
      {
        text: t('查找当前对话'),
        icon: 'search',
        key: 'Ctrl+F',
        // Only a chat page has a find bar.
        disabled: route.view !== 'meeting',
        run: () => dispatchEvent(new Event('sciencescope:find')),
      },
      {
        text: t('搜索与命令'),
        icon: 'search',
        key: settings?.shortcuts?.search,
        run: actions.openPalette,
      },
      { sep: true },
      {
        text: t('复制选中文字'),
        icon: 'copy',
        key: 'Ctrl+C',
        run: () => navigator.clipboard?.writeText(String(getSelection() ?? '')),
      },
    ],
    [
      {
        text: t('全部对话'),
        icon: 'layout-list',
        key: settings?.shortcuts?.browse,
        run: () => navigate({ view: 'all' }),
      },
      ...(projectId
        ? [
            {
              text: t('工作站'),
              icon: 'box',
              run: () => navigate({ view: 'workbench', id: projectId }),
            },
          ]
        : []),
      { sep: true },
      {
        text: t('全局助手'),
        icon: 'sparkle',
        run: () => actions.showAssistant(true),
      },
      ...(win
        ? [
            {
              text: t('窗口置顶'),
              icon: 'pin',
              check: onTop,
              run: () => actions.updateSettings({ appearance: { alwaysOnTop: !onTop } }),
            },
          ]
        : []),
      {
        text: t('显示滚动条'),
        check: Boolean(settings?.appearance?.scrollbars),
        run: () =>
          actions.updateSettings({
            appearance: { scrollbars: !settings?.appearance?.scrollbars },
          }),
      },
      {
        text: t('简洁执行记录'),
        check: settings?.appearance?.transcript === 'compact',
        run: () =>
          actions.updateSettings({
            appearance: {
              transcript: settings?.appearance?.transcript === 'compact' ? 'full' : 'compact',
            },
          }),
      },
      { sep: true },
      {
        text: '中文',
        check: language === 'zh',
        run: () => actions.updateSettings({ appearance: { language: 'zh' } }),
      },
      {
        text: 'English',
        check: language === 'en',
        run: () => actions.updateSettings({ appearance: { language: 'en' } }),
      },
    ],
    [
      {
        text: t('键盘快捷键'),
        icon: 'keyboard',
        run: () => navigate({ view: 'settings', id: 'shortcuts' }),
      },
      {
        text: t('关于 ScienceScope'),
        icon: 'info',
        run: () => navigate({ view: 'settings', id: 'about' }),
      },
    ],
  ];
  const titles = [t('文件'), t('编辑'), t('视图'), t('帮助')];

  return html`<header class="ss-titlebar" data-tauri-drag-region>
    <button
      type="button"
      class="ss-titlebar__brand"
      aria-label=${t('新对话')}
      onClick=${() => navigate({ view: 'home' })}
    >
      <${LogoMark} className="ss-logo" />ScienceScope
    </button>
    ${titles.map(
      (title, index) =>
        html`<button
          key=${title}
          type="button"
          class="ss-titlebar__menu"
          aria-haspopup="menu"
          onClick=${(event) => actions.openMenu(event, groups[index], title)}
        >
          ${title}
        </button>`,
    )}
    <span class="ss-titlebar__spacer" data-tauri-drag-region></span>
    <span class="ss-titlebar__title" data-tauri-drag-region>${projectName || 'ScienceScope'}</span>
    ${
      win &&
      html`<button
          type="button"
          class="ss-winctl ss-winctl--pin"
          aria-label=${t('窗口置顶')}
          aria-pressed=${String(onTop)}
          data-tip=${onTop ? t('取消窗口置顶') : t('窗口置顶')}
          onClick=${() => actions.updateSettings({ appearance: { alwaysOnTop: !onTop } })}
        >
          <${Lucide} name="pin" />
        </button>
        <button
          type="button"
          class="ss-winctl"
          aria-label=${t('最小化')}
          onClick=${() => win.minimize()}
        >
          <${Lucide} name="minus" />
        </button>
        <button
          type="button"
          class="ss-winctl"
          aria-label=${t('最大化')}
          onClick=${() => win.toggleMaximize()}
        >
          <${Lucide} name="square" />
        </button>
        <button
          type="button"
          class="ss-winctl ss-winctl--close"
          aria-label=${t('关闭主窗口')}
          onClick=${() => win.close()}
        >
          <${Lucide} name="x" />
        </button>`
    }
  </header>`;
}

export function Footbar() {
  const connected = useAppState((state) => state.connected);
  const [tone, text] =
    connected === null
      ? ['warn', t('正在连接本机服务…')]
      : connected
        ? ['ok', t('本机运行时已连接')]
        : ['danger', t('与本机服务的连接已断开，正在重连…')];
  return html`<footer class="ss-statusbar" data-runtime=${connected ? 'ready' : 'offline'}>
    <span class="ss-statusbar__item" role="status">
      <span class=${`ss-dot ss-dot--${tone}`}></span>${text}
    </span>
    <span class="ss-statusbar__spacer"></span>
  </footer>`;
}

/** Edit the local user's display name (settings.profile.name). */
export function ProfileForm() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  return html`<${FieldForm}
    label=${t('显示名称')}
    value=${settings?.profile?.name ?? ''}
    submitText=${t('保存')}
    onSubmit=${(name) => actions.updateSettings({ profile: { name } })}
  />`;
}
