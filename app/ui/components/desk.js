// The editing desk window (docs/architecture/EDITING_DESK.md §7; gallery group
// 「编辑台」): document tabs in the title bar, a ribbon, files and outline on the
// left, the page in the middle, comments and the bound chat on the right, and a
// status bar. U1 is the frame: documents open read-only until the editor (U2).
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { initialDeskTarget, listenForDeskTargets } from '../desk-window.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { LogoMark } from '../illustrations.js';
import { DeskDocument } from './desk-document.js';
import { DeskNav, FileType, deskKind, latestVersion } from './desk-nav.js';
import { Splitter } from './splitter.js';

const TABS_KEY = 'sciencescope.desk.tabs';
const NAV = { min: 180, max: 360, default: 232 };
const PANEL = { min: 280, max: 560, default: 336 };

/** Open tabs come back when the desk is opened again; storage may be unavailable. */
function readTabs() {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? '{}');
    return { tabs: Array.isArray(saved.tabs) ? saved.tabs : [], active: saved.active ?? null };
  } catch {
    return { tabs: [], active: null };
  }
}

function writeTabs(tabs, active) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active }));
  } catch {
    // Tabs are a convenience; the desk works without them.
  }
}

/** @param {{ projectId: string, path?: string | null, versionId?: string, name?: string, group?: string }} target */
function tabFor(target) {
  if (target.versionId)
    return {
      key: `v:${target.versionId}`,
      kind: 'version',
      id: target.versionId,
      projectId: target.projectId,
      name: target.name ?? '',
      label: target.group ?? target.name ?? '',
      type: 'group',
      format: deskKind(target.name ?? ''),
    };
  const name = String(target.path).split('/').pop() ?? '';
  return {
    key: `p:${target.projectId}:${target.path}`,
    kind: 'project',
    projectId: target.projectId,
    path: target.path,
    name,
    label: name,
    type: deskKind(name),
    format: deskKind(name),
  };
}

function nativeWindow() {
  return globalThis.__TAURI__?.window?.getCurrentWindow?.() ?? null;
}

/** @param {{ icon: string, label: string, onClick?: () => void, disabled?: boolean, pressed?: boolean, kbd?: string }} props */
function IconButton({ icon, label, onClick, disabled = false, pressed, kbd }) {
  return html`<button
    type="button"
    class="ss-icon-btn"
    aria-label=${label}
    data-tip=${label}
    data-kbd=${kbd}
    aria-pressed=${pressed == null ? undefined : String(pressed)}
    disabled=${disabled}
    onClick=${onClick}
  >
    <${Lucide} name=${icon} />
  </button>`;
}

/** @param {{ icon: string, text: string, onClick?: () => void, disabled?: boolean, pressed?: boolean, tip?: string }} props */
function RibbonButton({ icon, text, onClick, disabled = false, pressed, tip }) {
  return html`<button
    type="button"
    class="ss-btn ss-btn--ghost ss-btn--sm"
    aria-pressed=${pressed == null ? undefined : String(pressed)}
    data-tip=${tip}
    disabled=${disabled}
    onClick=${onClick}
  >
    <${Lucide} name=${icon} />${text}
  </button>`;
}

const Sep = () => html`<span class="ss-ribbon__sep"></span>`;

/** Read-only for now: a tag with the reason instead of a tip on each disabled button. */
const ReadOnly = () =>
  html`<span class="ss-tag" data-tip=${t('编辑、批注和保存正在接入，现在只能阅读')}>
    <${Lucide} name="eye" small />${t('只读预览')}
  </span>`;

/** @param {{ views: string[], view: string, onView: (view: string) => void, enabled?: string[] }} props */
function ViewSwitch({ views, view, onView, enabled = views }) {
  const names = { rendered: t('渲染'), source: t('源码'), split: t('并排') };
  return html`<div class="ss-seg ss-seg--sm" role="group" aria-label=${t('视图')}>
    ${views.map(
      (name) =>
        html`<button
          key=${name}
          type="button"
          aria-pressed=${String(view === name)}
          disabled=${!enabled.includes(name)}
          data-tip=${enabled.includes(name) ? undefined : t('渲染视图稍后接入')}
          onClick=${() => onView(name)}
        >
          ${names[name]}
        </button>`,
    )}
  </div>`;
}

/**
 * @param {{ tab: any, view: string, onView: (view: string) => void, ribbon: string,
 *   onRibbon: (name: string) => void, collapsed: boolean, onCollapse: () => void,
 *   nav: boolean, onNav: () => void, panel: boolean, onPanel: () => void,
 *   page: any, pdf: any }} props
 */
function Ribbon({
  tab,
  view,
  onView,
  ribbon,
  onRibbon,
  collapsed,
  onCollapse,
  nav,
  onNav,
  panel,
  onPanel,
  page,
  pdf,
}) {
  const actions = useActions();
  const format = tab?.format;
  const tabs =
    format === 'pdf'
      ? [
          ['home', t('阅览')],
          ['view', t('视图')],
        ]
      : [
          ['home', t('开始')],
          ['review', t('审阅')],
          ['view', t('视图')],
        ];
  const current = tabs.some(([name]) => name === ribbon) ? ribbon : 'home';
  const off = true;
  const openOriginal = () =>
    actions.attempt(() =>
      actions.openPreviewOriginal(
        tab.kind === 'version'
          ? { kind: 'version', id: tab.id }
          : { kind: 'project', projectId: tab.projectId, path: tab.path },
      ),
    );
  const views =
    format === 'md'
      ? html`<${ViewSwitch} views=${['rendered', 'source']} view=${view} onView=${onView} />`
      : format === 'tex'
        ? html`<${ViewSwitch}
            views=${['source', 'split', 'rendered']}
            view=${view}
            onView=${onView}
            enabled=${['source']}
          />`
        : null;
  const marks = html`<${RibbonButton}
      icon="message-square-plus"
      text=${t('批注')}
      disabled=${off}
    />
    <${RibbonButton} icon="link-2" text=${t('索引')} disabled=${off} />`;
  let bar;
  if (!tab) bar = html`<span class="ss-muted ss-ribbon__hint">${t('在左栏选一份文稿打开')}</span>`;
  else if (current === 'home' && format === 'pdf')
    bar = html`<${IconButton}
        icon="zoom-out"
        label=${t('缩小')}
        onClick=${() => pdf.current?.zoom(1 / 1.15)}
      />
      <${IconButton} icon="zoom-in" label=${t('放大')} onClick=${() => pdf.current?.zoom(1.15)} />
      <${Sep} />
      <${IconButton}
        icon="chevron-up"
        label=${t('上一页')}
        disabled=${!page.page || page.page <= 1}
        onClick=${() => pdf.current?.focus({ page: page.page - 1 })}
      />
      <span class="ss-ribbon__page">${page.pages ? `${page.page} / ${page.pages}` : '–'}</span>
      <${IconButton}
        icon="chevron-down"
        label=${t('下一页')}
        disabled=${!page.pages || page.page >= page.pages}
        onClick=${() => pdf.current?.focus({ page: page.page + 1 })}
      />
      <${Sep} />
      <${RibbonButton} icon="highlighter" text=${t('标记')} disabled=${off} />
      ${marks}
      <span class="ss-ribbon__spacer"></span>
      <${ReadOnly} />
      <${RibbonButton}
        icon="external-link"
        text=${t('用系统阅读器打开')}
        onClick=${openOriginal}
      />`;
  else if (current === 'home')
    bar = html`<${IconButton} icon="undo-2" label=${t('撤销')} kbd="Ctrl Z" disabled=${off} />
      <${IconButton} icon="redo-2" label=${t('重做')} kbd="Ctrl Y" disabled=${off} />
      <${Sep} />
      ${format === 'tex' && html`${views}<${Sep} />`}
      <button
        type="button"
        class="ss-select ss-select--sm"
        aria-label=${t('段落样式')}
        disabled=${off}
      >
        <span class="ss-select__value">${format === 'tex' ? '\\section' : t('正文')}</span>
        <${Lucide} name="chevron-down" />
      </button>
      <${IconButton} icon="bold" label=${t('加粗')} kbd="Ctrl B" disabled=${off} />
      <${IconButton} icon="italic" label=${t('斜体')} kbd="Ctrl I" disabled=${off} />
      ${
        format === 'docx' &&
        html`<${IconButton} icon="underline" label=${t('下划线')} kbd="Ctrl U" disabled=${off} />
          <${IconButton} icon="superscript" label=${t('上标')} disabled=${off} />
          <${IconButton} icon="subscript" label=${t('下标')} disabled=${off} />`
      }
      ${
        format === 'tex' &&
        html`<${RibbonButton} icon="radical" text=${t('公式')} disabled=${off} />`
      }
      ${
        format !== 'tex' &&
        html`<${Sep} />
          <${IconButton} icon="list" label=${t('项目符号')} disabled=${off} />
          <${IconButton} icon="list-ordered" label=${t('编号')} disabled=${off} />`
      }
      <${Sep} />
      ${marks}
      <span class="ss-ribbon__spacer"></span>
      <${ReadOnly} />
      ${
        format === 'tex' &&
        html`<button type="button" class="ss-btn ss-btn--sm" disabled=${off}>
          <${Lucide} name="file-output" />${t('编译 PDF')}
        </button>`
      }
      <button type="button" class="ss-btn ss-btn--primary ss-btn--sm" disabled=${off}>
        <${Lucide} name="save" />${t('保存')}
      </button>`;
  else if (current === 'review')
    bar = html`${marks}
      <${RibbonButton} icon="text-quote" text=${t('引用到对话')} disabled=${off} />
      <${Sep} />
      <${RibbonButton} icon="git-compare" text=${t('比较')} disabled=${off} />
      <${RibbonButton} icon="git-fork" text=${t('版本树')} disabled=${off} />
      <span class="ss-ribbon__spacer"></span>
      <${RibbonButton}
        icon="panel-right"
        text=${t('批注与索引')}
        pressed=${panel}
        onClick=${onPanel}
      />`;
  else
    bar = html`${views && html`${views}<${Sep} />`}
      <${RibbonButton} icon="panel-left" text=${t('文件与大纲')} pressed=${nav} onClick=${onNav} />
      <${RibbonButton} icon="panel-right" text=${t('侧栏')} pressed=${panel} onClick=${onPanel} />
      <span class="ss-ribbon__spacer"></span>
      <${RibbonButton}
        icon="external-link"
        text=${t('用系统程序打开')}
        tip=${t('用电脑上的默认程序打开这份文稿')}
        onClick=${openOriginal}
      />`;
  return html`<div class="ss-ribbon">
    <div class="ss-ribbon__tabs">
      <nav class="ss-tabs" role="tablist" aria-label=${t('功能区')}>
        ${tabs.map(
          ([name, text]) =>
            html`<button
              key=${name}
              class="ss-tab"
              role="tab"
              type="button"
              aria-selected=${String(name === current)}
              onClick=${() => onRibbon(name)}
            >
              ${text}
            </button>`,
        )}
      </nav>
      <span class="ss-ribbon__spacer"></span>
      <${IconButton}
        icon=${collapsed ? 'chevron-down' : 'chevron-up'}
        label=${collapsed ? t('展开功能区') : t('收起功能区')}
        kbd="Ctrl F1"
        onClick=${onCollapse}
      />
    </div>
    ${!collapsed && html`<div class="ss-ribbon__bar" role="toolbar">${bar}</div>`}
  </div>`;
}

/** @param {{ tabs: any[], active: string | null, onSelect: (key: string) => void, onClose: (key: string) => void, onAdd: () => void, title: string }} props */
function Titlebar({ tabs, active, onSelect, onClose, onAdd, title }) {
  const win = nativeWindow();
  return html`<header class="ss-titlebar" data-tauri-drag-region>
    <span class="ss-titlebar__brand" data-tauri-drag-region
      ><${LogoMark} className="ss-logo" />${t('编辑台')}</span
    >
    <nav class="ss-doctabs" role="tablist" aria-label=${t('打开的文稿')}>
      ${tabs.map(
        (tab) =>
          html`<div
            key=${tab.key}
            class="ss-doctab"
            role="tab"
            tabindex="0"
            aria-selected=${String(tab.key === active)}
            title=${tab.kind === 'project' ? tab.path : tab.label}
            onClick=${() => onSelect(tab.key)}
            onKeyDown=${(event) => event.key === 'Enter' && onSelect(tab.key)}
            onAuxClick=${(event) => event.button === 1 && onClose(tab.key)}
          >
            <${FileType} kind=${tab.type ?? 'group'} />
            <span class="ss-truncate">${tab.label}</span>
            <button
              type="button"
              class="ss-icon-btn"
              aria-label=${t('关闭 {name}', { name: tab.label })}
              onClick=${(event) => {
                event.stopPropagation();
                onClose(tab.key);
              }}
            >
              <${Lucide} name="x" />
            </button>
          </div>`,
      )}
    </nav>
    <${IconButton} icon="plus" label=${t('打开文稿')} onClick=${onAdd} />
    <span class="ss-titlebar__spacer" data-tauri-drag-region></span>
    <span class="ss-titlebar__title" data-tauri-drag-region>${title}</span>
    ${
      win &&
      html`<button
          class="ss-winctl"
          type="button"
          aria-label=${t('最小化')}
          onClick=${() => win.minimize()}
        >
          <${Lucide} name="minus" />
        </button>
        <button
          class="ss-winctl"
          type="button"
          aria-label=${t('最大化')}
          onClick=${() => win.toggleMaximize()}
        >
          <${Lucide} name="square" />
        </button>
        <button
          class="ss-winctl ss-winctl--close"
          type="button"
          aria-label=${t('关闭编辑台')}
          onClick=${() => win.close()}
        >
          <${Lucide} name="x" />
        </button>`
    }
  </header>`;
}

/** @param {{ tab: any, group: any, info: any }} props */
function Statusbar({ tab, group, info }) {
  const version =
    tab?.kind === 'version'
      ? group?.versions.find((entry) => entry.id === tab.id)
      : latestVersion(group?.versions);
  const versionText = version
    ? [`v${version.number}`, version.branch || t('主线'), version.tier].filter(Boolean).join(' · ')
    : t('还没有版本');
  return html`<footer class="ss-statusbar">
    ${
      tab &&
      html`<span class="ss-statusbar__item"
          ><${FileType} kind=${tab.type ?? 'group'} />${tab.label}</span
        >
        <span class="ss-statusbar__item">${versionText}</span>
        <span class="ss-statusbar__item"><span class="ss-dot"></span>${t('只读，未修改')}</span>
        ${
          info.words != null &&
          html`<span class="ss-statusbar__item"
            >${t('{n} 字', { n: info.words.toLocaleString() })}</span
          >`
        }
        ${
          info.pages != null &&
          html`<span class="ss-statusbar__item">${t('共 {n} 页', { n: info.pages })}</span>`
        }`
    }
    <span class="ss-statusbar__spacer"></span>
    <button
      class="ss-statusbar__btn"
      type="button"
      disabled
      data-tip=${t('这份文稿的版本分叉树（稍后接入）')}
    >
      <${Lucide} name="git-fork" />${t('版本树')}
    </button>
  </footer>`;
}

/** @param {{ tab: string, onTab: (tab: string) => void, onClose: () => void, width: number, onWidth: (width: number) => void }} props */
function DeskPanel({ tab, onTab, onClose, width, onWidth }) {
  const tabs = [
    ['notes', t('批注与索引')],
    ['chat', t('对话')],
  ];
  return html`<aside class="ss-panel ss-desk-panel" style=${{ width: `${width}px` }}>
    <${Splitter}
      side="start"
      width=${width}
      min=${PANEL.min}
      max=${PANEL.max}
      defaultWidth=${PANEL.default}
      onCommit=${onWidth}
    />
    <div class="ss-panel__head">
      <nav class="ss-tabs" role="tablist" aria-label=${t('侧栏')}>
        ${tabs.map(
          ([name, text]) =>
            html`<button
              key=${name}
              class="ss-tab"
              role="tab"
              type="button"
              aria-selected=${String(name === tab)}
              onClick=${() => onTab(name)}
            >
              ${text}
            </button>`,
        )}
      </nav>
      <span class="ss-titlebar__spacer"></span>
      <${IconButton} icon="x" label=${t('关闭侧栏')} onClick=${onClose} />
    </div>
    <div class="ss-panel__body">
      <div class="ss-empty">
        <div class="ss-empty__icon">
          <${Lucide} name=${tab === 'notes' ? 'message-square' : 'message-square-plus'} />
        </div>
        <div class="ss-empty__title">
          ${tab === 'notes' ? t('还没有批注和索引') : t('还没有绑定对话')}
        </div>
        <div class="ss-empty__text">
          ${
            tab === 'notes'
              ? t('划选文字后可以添加批注或索引，专家加的也会列在这里。')
              : t('从对话进入编辑台时，这里显示那段对话，可以接着和专家讨论这份文稿。')
          }
        </div>
      </div>
    </div>
  </aside>`;
}

export function DeskWindow() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const projects = useAppState((state) => state.projects);
  const versionsVersion = useAppState((state) => state.versionsVersion);
  const saved = useRef(readTabs());
  const [tabs, setTabs] = useState(/** @type {any[]} */ (saved.current.tabs));
  const [active, setActive] = useState(/** @type {string | null} */ (saved.current.active));
  const [projectId, setProjectId] = useState(/** @type {string | null} */ (null));
  const [groups, setGroups] = useState(/** @type {Record<string, any[]>} */ ({}));
  const [views, setViews] = useState(/** @type {Record<string, string>} */ ({}));
  const [ribbon, setRibbon] = useState('home');
  const [collapsed, setCollapsed] = useState(false);
  const [nav, setNav] = useState(true);
  const [panel, setPanel] = useState(true);
  const [panelTab, setPanelTab] = useState('notes');
  const [info, setInfo] = useState(/** @type {any} */ ({ outline: [], words: null }));
  const [jump, setJump] = useState(null);
  const [heading, setHeading] = useState(-1);
  const pdf = useRef(null);
  const canvas = useRef(/** @type {HTMLElement | null} */ (null));
  const tab = tabs.find((entry) => entry.key === active) ?? null;
  const view = (tab && views[tab.key]) ?? (tab?.format === 'md' ? 'rendered' : 'source');
  const panels = settings?.appearance?.panels ?? {};

  const open = (target) => {
    if (!target?.projectId || (!target.path && !target.versionId)) return;
    if (target.path && !deskKind(target.path)) {
      actions.toast(t('编辑台只打开 docx、tex、md 和 pdf 文稿。'));
      return;
    }
    const next = tabFor(target);
    setTabs((current) =>
      current.some((entry) => entry.key === next.key) ? current : [...current, next],
    );
    setActive(next.key);
    setProjectId(target.projectId);
  };
  const close = (key) => {
    const index = tabs.findIndex((entry) => entry.key === key);
    const rest = tabs.filter((entry) => entry.key !== key);
    setTabs(rest);
    if (key === active) setActive(rest[Math.min(index, rest.length - 1)]?.key ?? null);
  };

  useEffect(() => {
    const initial = initialDeskTarget();
    if (initial.projectId && initial.path) open(initial);
    else if (initial.projectId) setProjectId(initial.projectId);
    return listenForDeskTargets((target) => {
      if (target.path) open(target);
      else if (target.projectId) setProjectId(target.projectId);
    });
  }, []);
  useEffect(() => writeTabs(tabs, active), [tabs, active]);
  // The file list follows the open document's project, else the latest project.
  useEffect(() => {
    if (projectId && projects.some((entry) => entry.id === projectId)) return;
    const recent = projects
      .filter((entry) => !entry.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    setProjectId(tab?.projectId ?? recent?.id ?? null);
  }, [projects]);
  useEffect(() => {
    let current = true;
    const wanted = [...new Set([projectId, tab?.projectId].filter(Boolean))];
    Promise.all(wanted.map((id) => actions.versionGroups(id).catch(() => [])))
      .then((lists) => {
        if (current)
          setGroups((known) => ({
            ...known,
            ...Object.fromEntries(wanted.map((id, index) => [id, lists[index]])),
          }));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [projectId, tab?.projectId, versionsVersion]);
  useEffect(() => {
    document.title = tab ? `${tab.label} · ${t('编辑台')}` : `ScienceScope · ${t('编辑台')}`;
    setHeading(-1);
  }, [tab?.key]);
  useEffect(() => {
    const key = (event) => {
      if (event.key === 'F1' && event.ctrlKey) {
        event.preventDefault();
        setCollapsed((value) => !value);
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);

  // The outline marks the last heading above the top of the visible page.
  const onScroll = () => {
    const root = canvas.current;
    if (!root || !info.outline.length || info.outline[0].line) return;
    const top = root.getBoundingClientRect().top + 80;
    let index = -1;
    for (const node of root.querySelectorAll('[data-outline]'))
      if (node.getBoundingClientRect().top <= top)
        index = Number(node.getAttribute('data-outline'));
    setHeading(index);
  };

  const tabProject = projects.find((entry) => entry.id === (tab?.projectId ?? projectId));
  const tabGroups = groups[tab?.projectId] ?? [];
  const group =
    tab?.kind === 'version'
      ? tabGroups.find((entry) => entry.versions.some((version) => version.id === tab.id))
      : tabGroups.find((entry) => entry.sourcePath === tab?.path);
  const savePanel = (key) => (width) =>
    actions.updateSettings({ appearance: { panels: { [key]: width } } });
  const navWidth = Math.max(NAV.min, Math.min(NAV.max, panels.deskNav ?? NAV.default));
  const panelWidth = Math.max(PANEL.min, Math.min(PANEL.max, panels.deskPanel ?? PANEL.default));

  return html`<div class="ss-shell ss-desk">
    <${Titlebar}
      tabs=${tabs}
      active=${active}
      onSelect=${setActive}
      onClose=${close}
      onAdd=${() => {
        setNav(true);
        requestAnimationFrame(() =>
          /** @type {HTMLElement | null} */ (
            document.querySelector('.ss-desk-nav__list .ss-desk-file')
          )?.focus(),
        );
      }}
      title=${tabProject?.name ?? ''}
    />
    <${Ribbon}
      tab=${tab}
      view=${view}
      onView=${(next) => setViews({ ...views, [tab.key]: next })}
      ribbon=${ribbon}
      onRibbon=${setRibbon}
      collapsed=${collapsed}
      onCollapse=${() => setCollapsed(!collapsed)}
      nav=${nav}
      onNav=${() => setNav(!nav)}
      panel=${panel}
      onPanel=${() => setPanel(!panel)}
      page=${info}
      pdf=${pdf}
    />
    <div class="ss-shell__body">
      ${
        nav &&
        html`<aside class="ss-desk-nav" style=${{ width: `${navWidth}px` }}>
          <${DeskNav}
            projectId=${projectId}
            onProject=${setProjectId}
            groups=${groups[projectId] ?? []}
            activeKey=${active}
            onOpen=${open}
            outline=${tab ? info.outline : []}
            current=${heading}
            onHeading=${setJump}
          />
          <${Splitter}
            side="end"
            width=${navWidth}
            min=${NAV.min}
            max=${NAV.max}
            defaultWidth=${NAV.default}
            onCommit=${savePanel('deskNav')}
          />
        </aside>`
      }
      <main class="ss-desk-canvas" ref=${canvas} onScroll=${onScroll}>
        ${
          tab
            ? html`<${DeskDocument}
                key=${tab.key}
                tab=${tab}
                view=${view}
                jump=${jump}
                pdf=${pdf}
                onInfo=${(next) => setInfo((known) => ({ ...known, ...next }))}
              />`
            : html`<div class="ss-empty ss-desk-canvas__state">
                <div class="ss-empty__icon"><${Lucide} name="file-pen" /></div>
                <div class="ss-empty__title">${t('还没有打开文稿')}</div>
                <div class="ss-empty__text">
                  ${t('在左栏选一份 docx、tex、md 或 pdf 打开，可以同时开几份，在顶部切换。')}
                </div>
              </div>`
        }
      </main>
      ${
        panel &&
        html`<${DeskPanel}
          tab=${panelTab}
          onTab=${setPanelTab}
          onClose=${() => setPanel(false)}
          width=${panelWidth}
          onWidth=${savePanel('deskPanel')}
        />`
      }
    </div>
    <${Statusbar} tab=${tab} group=${group} info=${info} />
  </div>`;
}
