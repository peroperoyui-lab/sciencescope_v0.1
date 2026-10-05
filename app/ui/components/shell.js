// Window chrome in the old interface's markup: the top bar with its menus and
// window controls, and the status bar.
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { currentLanguage, t } from '../i18n/index.js';
import { navigate } from '../route.js';
import { FieldForm } from './overlays.js';

/**
 * The Tauri window, when running inside the native shell (`withGlobalTauri`).
 * In a plain browser there are no window controls to show.
 */
function nativeWindow() {
  return globalThis.__TAURI__?.window?.getCurrentWindow?.() ?? null;
}

function About() {
  return html`<div>
    <p>ScienceScope · ${t('本地学术研究助手')}</p>
    <p class="muted">${t('发布者 peroperoyui · MIT 许可证')}</p>
  </div>`;
}

/** @param {{ projectName?: string, projectId?: string | null }} props */
export function Topbar({ projectName, projectId }) {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const win = nativeWindow();
  const language = currentLanguage();
  const groups = [
    [
      {
        text: t('新聊天'),
        icon: 'chat',
        key: settings?.shortcuts?.newChat,
        run: () => navigate(projectId ? { view: 'new', id: projectId } : { view: 'home' }),
      },
      {
        text: t('独立快速聊天'),
        icon: 'chat',
        key: settings?.shortcuts?.independentChat,
        run: () => navigate({ view: 'home' }),
      },
      {
        text: t('新建项目'),
        icon: 'folder',
        run: () =>
          actions.openModal(
            t('新建项目'),
            html`<${FieldForm}
              label=${t('项目名称')}
              submitText=${t('创建')}
              onSubmit=${async (name) => {
                const project = await actions.createProject(name);
                navigate({ view: 'workbench', id: project.id });
              }}
            />`,
          ),
      },
    ],
    [
      {
        text: t('查找当前对话'),
        icon: 'search',
        key: 'Ctrl+F',
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
        text: t('浏览全部对话'),
        icon: 'chat',
        key: settings?.shortcuts?.browse,
        run: () => navigate({ view: 'all' }),
      },
      ...(projectId
        ? [
            {
              text: t('工作站'),
              icon: 'cube',
              run: () => navigate({ view: 'workbench', id: projectId }),
            },
          ]
        : []),
      { sep: true },
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
        icon: 'gear',
        run: () => navigate({ view: 'settings', id: 'shortcuts' }),
      },
      {
        text: t('关于 ScienceScope'),
        icon: 'help',
        run: () => actions.openModal(t('关于 ScienceScope'), html`<${About} />`),
      },
    ],
  ];
  const titles = [t('文件'), t('编辑'), t('视图'), t('帮助')];

  return html`<div class="topbar" data-tauri-drag-region>
    <button class="brand" onClick=${() => navigate({ view: 'home' })}>
      <img src="/assets/logo.png" alt="ScienceScope" /><span>ScienceScope</span>
    </button>
    ${titles.map(
      (title, index) =>
        html`<button
          key=${title}
          data-v="top-menu"
          aria-haspopup="menu"
          onClick=${(event) => actions.openMenu(event, groups[index], title)}
        >
          ${title}
        </button>`,
    )}
    <span class="spacer" data-tauri-drag-region></span>
    <span class="muted">${projectName || 'ScienceScope'}</span>
    ${
      win &&
      html`<div class="windowctl">
        <button title=${t('最小化')} onClick=${() => win.minimize()}>−</button>
        <button title=${t('最大化')} onClick=${() => win.toggleMaximize()}>□</button>
        <button title=${t('关闭主窗口')} onClick=${() => win.close()}>×</button>
      </div>`
    }
  </div>`;
}

export function Footbar() {
  const connected = useAppState((state) => state.connected);
  const text =
    connected === null
      ? t('正在连接本机服务…')
      : connected
        ? t('本机运行时已连接')
        : t('与本机服务的连接已断开，正在重连…');
  return html`<footer class="foot" data-runtime=${connected ? 'ready' : 'offline'}>
    <span class="badge-dot"></span>
    <span class="foot-text">${text}</span>
    <span class="spacer"></span>
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
