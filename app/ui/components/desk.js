// The editing desk window (docs/architecture/EDITING_DESK.md §7; gallery group
// 「编辑台」): document tabs in the title bar, a ribbon, files and outline on the
// left, the page in the middle, comments and the bound chat on the right, and a
// status bar. U2 edits a project's docx, Markdown and TeX in a desk session;
// Ctrl+S writes the project file.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { textBlockStart } from '../desk-assist.js';
import {
  initialDeskTarget,
  listenForDeskFocus,
  listenForDeskTargets,
  takeDeskFocus,
} from '../desk-window.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Illustration, LogoMark } from '../illustrations.js';
import { writeBack } from '../desk-session.js';
import { useQuestion } from './dialog.js';
import { useDeskAssist } from './desk-assist.js';
import { DeskChat } from './desk-chat.js';
import { DeskDocument, deskChats, externalQuestion } from './desk-document.js';
import { DeskNav, FileType, deskKind, latestVersion } from './desk-nav.js';
import { useDeskNotes } from './desk-notes.js';
import { FilePreview } from './file-preview.js';
import { SecretaryPanel } from './secretary-panel.js';
import { Splitter } from './splitter.js';
import { VersionCompare } from './version-compare.js';
import { VersionTree } from './version-tree.js';

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

/** A tag with the reason instead of a tip on each disabled button. @param {{ tip: string }} props */
const ReadOnly = ({ tip }) =>
  html`<span class="ss-tag" data-tip=${tip}> <${Lucide} name="eye" small />${t('只读')} </span>`;

/** Why a tab cannot be edited. @param {any} tab */
function readOnlyReason(tab) {
  if (tab.kind === 'version') return t('历史版本只读；要修改，请打开项目文件夹里的文稿');
  if (tab.format === 'pdf') return t('PDF 正文只读，可以划选加批注和索引');
  return '';
}

/** @param {number} number */
const confirmQuestion = (number) => ({
  title: t('写回项目文件？'),
  text: t(
    '项目文件现在是 v{n} 的内容，不是这次打开时的版本。写回会用编辑台里的内容替换它，v{n} 仍留在版本里。',
    { n: number },
  ),
  options: [{ value: 'write', label: t('写回'), primary: true }],
});

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

/** "TeX Live 2025" or "MiKTeX 25.12" from an engine's version line. @param {any} engine */
const texName = (engine) =>
  /TeX Live \d{4}|MiKTeX [\d.]+\d/u.exec(engine.version)?.[0] ??
  { miktex: 'MiKTeX', texlive: 'TeX Live' }[engine.distribution] ??
  'TeX';

/**
 * 编译 PDF, with the PDF/page switch once a PDF exists. Without TeX the button
 * is off and a tag says how to get it.
 * @param {{ edit: any, editing: any, engines: any[] | null, onCompile: () => void }} props
 */
function CompileButtons({ edit, editing, engines, onCompile }) {
  const tex = edit?.tex;
  const missing = engines != null && !engines.length;
  return html`${
      missing &&
      html`<span
        class="ss-tag"
        data-tip=${t('没找到 TeX。装好 MiKTeX 或 TeX Live 后，到「设置 → 编辑台」点「重新检查」。不装也能编辑和看渲染。')}
        ><${Lucide} name="info" small />${t('未装 TeX')}</span
      >`
    }
    ${
      tex?.pdf &&
      html`<${IconButton}
        icon="file-text"
        label=${tex.showing ? t('回到实时渲染') : t('看编译的 PDF')}
        pressed=${tex.showing}
        onClick=${() => editing.current?.togglePdf()}
      />`
    }
    <button
      type="button"
      class="ss-btn ss-btn--sm"
      disabled=${!tex || !engines?.length || tex.compiling}
      data-tip=${
        engines?.length
          ? t('先写回项目文件，再用本机的 {name} 编译，结果在渲染栏预览', {
              name: texName(engines[0]),
            })
          : undefined
      }
      onClick=${onCompile}
    >
      ${tex?.compiling ? html`<span class="ss-spin"></span>${t('正在编译…')}` : html`<${Lucide} name="file-output" />${t('编译 PDF')}`}
    </button>`;
}

/**
 * @param {{ tab: any, view: string, onView: (view: string) => void, ribbon: string,
 *   onRibbon: (name: string) => void, collapsed: boolean, onCollapse: () => void,
 *   nav: boolean, onNav: () => void, panel: boolean, onPanel: () => void,
 *   page: any, pdf: any, edit: any, editing: any, onSave: () => void,
 *   compare: string, comparing: boolean, onCompare: () => void,
 *   onNote: (type: 'comment' | 'index') => void, onQuote: () => void, onVersions: () => void,
 *   texEngines: any[] | null, onCompile: () => void }} props
 * `compare` is why 比较 is off, or '' when it can start; `onNote` starts a comment or index;
 * `texEngines` is the TeX found on this computer (null while looking).
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
  edit,
  editing,
  onSave,
  compare,
  comparing,
  onCompare,
  onNote,
  onQuote,
  onVersions,
  texEngines,
  onCompile,
}) {
  const actions = useActions();
  const format = tab?.format;
  const texEdit = edit?.format === 'tex';
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
  const docx = edit?.format === 'docx';
  const reason = tab ? readOnlyReason(tab) : '';
  const run = (name) => () => editing.current?.command(name);
  // In TeX and Markdown source, bold and italic put markup around the selection.
  const TEX_MARKS = { b: ['\\textbf{', '}'], i: ['\\emph{', '}'] };
  const MD_MARKS = { b: ['**', '**'], i: ['*', '*'] };
  const mdSource = edit?.format === 'md' && view === 'source';
  const mdPage = edit?.format === 'md' && view === 'rendered';
  const wrapping = texEdit ? TEX_MARKS : mdSource ? MD_MARKS : null;
  /** @param {string} name @param {string} icon @param {string} label @param {string} [kbd] */
  const markButton = (name, icon, label, kbd) => {
    // The ribbon can draw the next tab's buttons before its editor reports.
    const markup = wrapping?.[name];
    return html`<${IconButton}
      icon=${icon}
      label=${markup ? `${label}（${markup.join('…')}）` : label}
      kbd=${markup ? undefined : kbd}
      disabled=${!docx && !markup && !mdPage}
      pressed=${docx || mdPage ? edit.marks.includes(name) : undefined}
      onClick=${markup ? () => editing.current?.wrap(...markup) : run(name)}
    />`;
  };
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
          />`
        : null;
  const noteless = !edit;
  const marks = html`<${RibbonButton}
      icon="message-square-plus"
      text=${t('批注')}
      tip=${t('给选中的文字加批注')}
      disabled=${noteless}
      onClick=${() => onNote('comment')}
    />
    <${RibbonButton}
      icon="link-2"
      text=${t('索引')}
      tip=${t('把选中的文字连到数据、脚本、资料或消息')}
      disabled=${noteless}
      onClick=${() => onNote('index')}
    />`;
  const quoteButton = html`<${RibbonButton}
    icon="text-quote"
    text=${t('引用到对话')}
    tip=${t('把选中的文字引用到编辑台的对话里')}
    disabled=${noteless}
    onClick=${onQuote}
  />`;
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
      ${marks}${quoteButton}
      <span class="ss-ribbon__spacer"></span>
      <${ReadOnly} tip=${reason} />
      <${RibbonButton}
        icon="external-link"
        text=${t('用系统阅读器打开')}
        onClick=${openOriginal}
      />`;
  else if (current === 'home')
    bar = html`<${IconButton}
        icon="undo-2"
        label=${t('撤销')}
        kbd="Ctrl Z"
        disabled=${!edit?.undo}
        onClick=${run('undo')}
      />
      <${IconButton}
        icon="redo-2"
        label=${t('重做')}
        kbd="Ctrl Y"
        disabled=${!edit?.redo}
        onClick=${run('redo')}
      />
      <${Sep} />
      ${views && html`${views}<${Sep} />`}
      <button
        type="button"
        class="ss-select ss-select--sm"
        aria-label=${t('段落样式')}
        disabled=${off}
      >
        <span class="ss-select__value">${format === 'tex' ? '\\section' : t('正文')}</span>
        <${Lucide} name="chevron-down" />
      </button>
      ${markButton('b', 'bold', t('加粗'), 'Ctrl B')}
      ${markButton('i', 'italic', t('斜体'), 'Ctrl I')}
      ${
        format === 'docx' &&
        html`${markButton('u', 'underline', t('下划线'), 'Ctrl U')}
        ${markButton('sup', 'superscript', t('上标'))} ${markButton('sub', 'subscript', t('下标'))}`
      }
      ${
        (format === 'tex' || format === 'md') &&
        html`<${RibbonButton}
          icon="radical"
          text=${t('公式')}
          tip=${t('在光标处插入公式；点渲染里的公式可以改它')}
          disabled=${!edit}
          onClick=${(event) =>
            editing.current?.newFormula(event.currentTarget.getBoundingClientRect())}
        />`
      }
      ${
        format === 'tex' &&
        html`<${RibbonButton}
          icon="quote"
          text=${t('引用')}
          tip=${t('插入 {cite}，在括号里写文献的键', { cite: '\\cite{}' })}
          disabled=${!texEdit}
          onClick=${() => editing.current?.wrap('\\cite{', '}')}
        />`
      }
      ${
        format !== 'tex' &&
        html`<${Sep} />
          <${IconButton}
            icon="list"
            label=${t('项目符号')}
            disabled=${!mdPage}
            onClick=${run('ul')}
          />
          <${IconButton}
            icon="list-ordered"
            label=${t('编号')}
            disabled=${!mdPage}
            onClick=${run('ol')}
          />`
      }
      <${Sep} />
      ${marks}
      <span class="ss-ribbon__spacer"></span>
      ${!edit && reason && html`<${ReadOnly} tip=${reason} />`}
      ${format === 'tex' && html`<${CompileButtons} edit=${edit} editing=${editing} engines=${texEngines} onCompile=${onCompile} />`}
      <button
        type="button"
        class="ss-btn ss-btn--primary ss-btn--sm"
        disabled=${!edit}
        data-tip=${edit ? t('写回项目文件夹里的文稿') : undefined}
        data-kbd=${edit ? 'Ctrl S' : undefined}
        onClick=${onSave}
      >
        <${Lucide} name="save" />${t('保存')}
      </button>`;
  else if (current === 'review')
    bar = html`${marks}${quoteButton}
      <${Sep} />
      <${RibbonButton}
        icon="git-compare"
        text=${t('比较')}
        tip=${compare || t('并排比较这份文稿的两个版本')}
        disabled=${!!compare}
        pressed=${comparing}
        onClick=${onCompare}
      />
      <${RibbonButton}
        icon="git-fork"
        text=${t('版本树')}
        tip=${t('这份文稿的版本分叉树')}
        disabled=${!tab}
        onClick=${onVersions}
      />
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

/** @param {{ status: any }} props */
function SaveState({ status }) {
  const [dot, text] =
    status?.state === 'error'
      ? ['danger', t('同步失败：{message}', { message: status.message })]
      : status?.state === 'syncing'
        ? ['live', t('正在同步…')]
        : status?.state === 'unsaved'
          ? ['warn', t('有修改未写回')]
          : status
            ? ['ok', t('已写回项目文件')]
            : ['', t('只读')];
  return html`<span class="ss-statusbar__item" data-save=${status?.state ?? 'read-only'}
    ><span class=${`ss-dot${dot ? ` ss-dot--${dot}` : ''}`}></span>${text}</span
  >`;
}

/**
 * @param {{ tab: any, group: any, info: any, edit: any, comparing: boolean, view: string,
 *   currentId: string | null, onVersions: () => void, chat: any, onChat: () => void }} props
 * `currentId` is the version the tab shows (an older one after 从这一版开始编辑);
 * `chat` is the bound chat, shown on the right.
 */
function Statusbar({
  tab,
  group,
  info,
  edit,
  comparing,
  view,
  currentId,
  onVersions,
  chat,
  onChat,
}) {
  const version =
    group?.versions.find((entry) => entry.id === currentId) ?? latestVersion(group?.versions);
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
        ${
          comparing
            ? html`<span class="ss-statusbar__item">${t('正在比较两个版本')}</span>`
            : html`<${SaveState} status=${edit?.status} />`
        }
        ${
          info.words != null &&
          html`<span class="ss-statusbar__item"
            >${t('{n} 字', { n: info.words.toLocaleString() })}</span
          >`
        }
        ${
          info.pages != null &&
          html`<span class="ss-statusbar__item">${t('共 {n} 页', { n: info.pages })}</span>`
        }
        ${
          edit &&
          edit.format !== 'docx' &&
          info.cursor &&
          html`<span class="ss-statusbar__item"
            >${t('第 {line} 行，第 {column} 列', info.cursor)}</span
          >`
        }
        ${
          edit?.tex &&
          view !== 'source' &&
          html`<span class="ss-statusbar__item"
            >${
              edit.tex.showing
                ? t('预览：编译的 PDF（{engine}，{s} 秒）', {
                    engine: edit.tex.result?.engine ?? '',
                    s: ((edit.tex.result?.durationMs ?? 0) / 1000).toFixed(1),
                  })
                : t('渲染：内置，不需要装 TeX')
            }</span
          >`
        }`
    }
    <span class="ss-statusbar__spacer"></span>
    <button
      class="ss-statusbar__btn"
      type="button"
      disabled=${!tab}
      data-tip=${t('这份文稿的版本分叉树')}
      onClick=${onVersions}
    >
      <${Lucide} name="git-fork" />${t('版本树')}
    </button>
    ${
      chat &&
      html`<button
        class="ss-statusbar__btn"
        type="button"
        data-tip=${t('编辑台绑定的对话')}
        onClick=${onChat}
      >
        <${Lucide} name="message-square" /><span class="ss-truncate">${chat.title}</span>
      </button>`
    }
  </footer>`;
}

/**
 * @param {{ tab: string, onTab: (tab: string) => void, onClose: () => void, width: number,
 *   onWidth: (width: number) => void, notes: any, count: number, versions: any, chat: any }} props
 * `notes` is the 「批注与索引」 tab's content, `count` its number of items, `chat`
 * the 「对话」 tab's; the version tree (`versions`) takes the whole panel with its own head.
 */
function DeskPanel({ tab, onTab, onClose, width, onWidth, notes, count, versions, chat }) {
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
    ${
      tab === 'versions'
        ? versions
        : html`<div class="ss-panel__head">
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
                      ${text}${name === 'notes' && count > 0 && html`<span class="ss-tab__count">${count}</span>`}
                    </button>`,
                )}
              </nav>
              <span class="ss-titlebar__spacer"></span>
              <${IconButton} icon="x" label=${t('关闭侧栏')} onClick=${onClose} />
            </div>
            ${tab === 'notes' ? notes : chat}`
    }
  </aside>`;
}

export function DeskWindow() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const projects = useAppState((state) => state.projects);
  const versionsVersion = useAppState((state) => state.versionsVersion);
  const bindings = useAppState((state) => state.deskBindings);
  const meetings = useAppState((state) => state.meetings);
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
  const [edit, setEdit] = useState(/** @type {any} */ (null));
  // The side-by-side comparison of one tab's versions, {key, left, right}.
  const [comparison, setComparison] = useState(/** @type {any} */ (null));
  const [question, ask] = useQuestion();
  const pdf = useRef(null);
  const editing = useRef(/** @type {any} */ (null));
  const sessions = useRef(/** @type {Record<string, string>} */ ({}));
  const canvas = useRef(/** @type {HTMLElement | null} */ (null));
  const tab = tabs.find((entry) => entry.key === active) ?? null;
  const notes = useDeskNotes({
    tab,
    editing,
    onOpen: () => {
      setPanel(true);
      setPanelTab('notes');
    },
  });
  const assist = useDeskAssist({
    tab,
    editing,
    canvas,
    notes,
    // 引用到对话 lands in the 对话 tab's input.
    onQuoted: () => {
      setPanel(true);
      setPanelTab('chat');
    },
  });
  // A sentence a chat mark points at, shown once its document is open.
  const [focus, setFocus] = useState(/** @type {any} */ (null));
  const [ready, setReady] = useState(0);
  // Markdown opens as its page (U6b); TeX side by side.
  const view =
    (tab && views[tab.key]) ??
    (tab?.format === 'tex' ? 'split' : tab?.format === 'md' ? 'rendered' : 'source');
  // The TeX found on this computer, looked up when a TeX file is first open.
  const [texEngines, setTexEngines] = useState(/** @type {any[] | null} */ (null));
  const panels = settings?.appearance?.panels ?? {};

  const open = (target) => {
    if (!target?.projectId || (!target.path && !target.versionId)) return;
    if (target.path && !deskKind(target.path)) {
      actions.toast(t('编辑台只打开 docx、tex、md 和 pdf 文稿。'));
      return;
    }
    const next = tabFor(target);
    // A TeX file needs the width for source and page; the side panel opens again with a note.
    if (next.format === 'tex' && !tabs.some((entry) => entry.key === next.key)) setPanel(false);
    setTabs((current) =>
      current.some((entry) => entry.key === next.key) ? current : [...current, next],
    );
    setActive(next.key);
    setProjectId(target.projectId);
  };
  // Ctrl+S: send what is typed, then write the project file, asking first
  // when the file is at another version or was changed outside.
  const save = async () => {
    const current = editing.current;
    if (!current || !tab) return;
    try {
      let result = await current.session.save();
      if (result.confirm) {
        if ((await ask(confirmQuestion(result.confirm.versionNumber))) !== 'write') return;
        result = await current.session.save(true);
      }
      if (!result.external) return;
      const choice = await ask(externalQuestion(tab.name));
      if (choice === 'mine') {
        const version = await current.session.saveVersion();
        actions.toast(t('已另存为 v{n}，项目文件保持外部版本', { n: version.number }));
      } else if (choice === 'external') {
        const closed = await current.session.close();
        if (closed.version) actions.toast(t('你的修改已留作 v{n}', { n: closed.version.number }));
        current.reopen();
      }
    } catch (failure) {
      actions.toast(failure.message);
    }
  };
  /** Close a tab's session; unsaved text is written back or kept as a version. */
  const finish = async (key) => {
    const sessionId = sessions.current[key];
    if (!sessionId) return true;
    const entry = tabs.find((item) => item.key === key);
    try {
      if (key === active) await editing.current?.session.flush();
      const { session } = await actions.deskSession(sessionId);
      // A PDF's comments live in the app; there is nothing to write back.
      if (entry?.format !== 'pdf' && session.seq !== session.savedSeq) {
        const choice = await ask({
          title: t('写回 {name}？', { name: entry?.label ?? '' }),
          text: t('编辑台里有没写回项目文件的修改。不写回的话，修改会留作一个版本。'),
          options: [
            { value: 'keep', label: t('不写回') },
            { value: 'write', label: t('写回并关闭'), primary: true },
          ],
        });
        if (!choice) return false;
        if (choice === 'write') {
          let result = await writeBack(actions, sessionId);
          if (result.confirm) {
            if ((await ask(confirmQuestion(result.confirm.versionNumber))) !== 'write')
              return false;
            result = await writeBack(actions, sessionId, true);
          }
          if (result.external) actions.toast(t('项目文件在外面被改过，没有写回。'));
        }
      }
      const closed = await actions.closeDesk(sessionId);
      if (closed.version) actions.toast(t('这次的修改已留作 v{n}', { n: closed.version.number }));
    } catch (failure) {
      if (failure.code !== 'DESK_SESSION_CLOSED' && failure.status !== 404) {
        actions.toast(failure.message);
        return false;
      }
    }
    delete sessions.current[key];
    return true;
  };
  const close = async (key) => {
    if (!(await finish(key))) return;
    setTabs((current) => {
      const index = current.findIndex((entry) => entry.key === key);
      const rest = current.filter((entry) => entry.key !== key);
      setActive((selected) =>
        selected === key ? (rest[Math.min(index, rest.length - 1)]?.key ?? null) : selected,
      );
      return rest;
    });
  };

  /** @param {any} found where the cited sentence is now (POST /api/desk/focus) */
  const goTo = (found) => {
    setFocus(found);
    open({ projectId: found.projectId, path: found.path });
  };
  useEffect(() => {
    const initial = initialDeskTarget();
    const waiting = takeDeskFocus();
    if (waiting) goTo(waiting);
    else if (initial.projectId && (initial.path || initial.versionId)) open(initial);
    else if (initial.projectId) setProjectId(initial.projectId);
    const stopFocus = listenForDeskFocus(goTo);
    const stopTargets = listenForDeskTargets((target) => {
      const next = takeDeskFocus();
      if (next) goTo(next);
      else if (target.path || target.versionId) open(target);
      else if (target.projectId) setProjectId(target.projectId);
    });
    return () => {
      stopFocus();
      stopTargets();
    };
  }, []);
  // Scroll to the cited sentence once its document's editor is up.
  useEffect(() => {
    const current = editing.current;
    if (!focus || !current?.session || tab?.kind !== 'project' || tab.path !== focus.path) return;
    setFocus(null);
    if (focus.status === 'missing') {
      actions.toast(t('引用的这句已经找不到了，可能被改掉或删掉了。'));
      return;
    }
    if (focus.status === 'moved') actions.toast(t('引用的这句改过，已定位到最接近的位置。'));
    if (tab.format === 'docx') current.reveal(focus.blockId, focus.from, focus.to);
    else
      actions
        .deskSession(current.session.id)
        .then(({ blocks }) => {
          const index = blocks.findIndex((block) => block.id === focus.blockId);
          const start = index < 0 ? null : textBlockStart(current.text(), tab.format, index);
          if (start != null) current.reveal(start + (focus.from ?? 0), start + (focus.to ?? 0));
        })
        .catch(() => {});
  }, [focus, ready, tab?.key]);
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
      if (event.key.toLowerCase() === 's' && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault();
        saveRef.current();
      }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (tab?.format !== 'tex' || texEngines) return;
    actions
      .texEngines()
      .then((found) => setTexEngines(found.engines ?? []))
      .catch(() => setTexEngines([]));
  }, [tab?.format]);
  // TeX compiles the project file, so what is typed is written back first.
  const compile = async () => {
    await save();
    const current = editing.current;
    if (!current?.compile) return;
    if (current.session.unsaved) {
      actions.toast(t('没有写回项目文件，所以没有编译。'));
      return;
    }
    await current.compile();
  };

  // The outline marks the last heading above the top of the visible page.
  const onScroll = () => {
    assist.onScroll();
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
  const comparing = !!tab && comparison?.key === tab.key;
  const compareBlocked = !tab
    ? t('先打开一份文稿')
    : !['docx', 'md', 'tex'].includes(tab.format)
      ? t('这种文稿不能并排比较')
      : (group?.versions.length ?? 0) < 2
        ? t('这份文稿至少要有两个版本才能比较')
        : '';
  /** Start with the open version (or the latest) against the one before it. */
  const toggleCompare = () => {
    if (comparing) return setComparison(null);
    const versions = group.versions;
    const right = versions.find((entry) => entry.id === tab.id) ?? versions[0];
    const older = versions.filter((entry) => entry.number < right.number);
    const left = versions.find((entry) => entry.id === right.parentId) ?? older[0] ?? versions[1];
    setComparison({ key: tab.key, left: left.id, right: right.id });
  };
  // The version the active tab shows: a version tab's own, or the edited session's base.
  const [base, setBase] = useState(/** @type {string | null} */ (null));
  const [opened, setOpened] = useState(0);
  // The chat the edited session is bound to, as {projectId, meetingId}.
  const [sessionChat, setSessionChat] = useState(/** @type {any} */ (null));
  useEffect(() => {
    setBase(null);
    const sessionId = tab ? sessions.current[tab.key] : null;
    if (!sessionId || tab?.kind !== 'project') return;
    let alive = true;
    actions
      .deskSession(sessionId)
      .then(({ session }) => {
        if (!alive) return;
        setBase(session.baseVersionId);
        if (session.meetingId)
          setSessionChat({ projectId: tab.projectId, meetingId: session.meetingId });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tab?.key, opened, versionsVersion]);
  // The bound chat: the project's latest entry (from any window), else the session's.
  const chatProject = tab?.projectId ?? projectId;
  const boundId =
    (chatProject && bindings[chatProject]) ??
    (sessionChat?.projectId === chatProject ? sessionChat.meetingId : null);
  const bound = meetings.find((entry) => entry.id === boundId) ?? null;
  // Documents opened later join the same chat.
  useEffect(() => {
    if (chatProject && boundId) deskChats.set(chatProject, boundId);
  }, [chatProject, boundId]);
  const currentId =
    tab?.kind === 'version' ? tab.id : (base ?? latestVersion(group?.versions)?.id ?? null);
  const showVersions = () => {
    setPanel(true);
    setPanelTab((current) => (current === 'versions' ? 'notes' : 'versions'));
  };
  const editFrom = !group?.sourcePath
    ? t('这个版本组没有对应的项目文件')
    : tab?.format === 'pdf'
      ? t('PDF 只读')
      : '';
  /** Close the file's session, then open it again from `version`; the new version branches from it. */
  const startFrom = async (version) => {
    const target = { projectId: tab.projectId, path: group.sourcePath };
    const key = tabFor(target).key;
    if (!(await finish(key))) return;
    setTabs((current) => {
      const found = current.find((entry) => entry.key === key);
      const next = { ...(found ?? tabFor(target)), from: version.id };
      next.restart = (found?.restart ?? 0) + 1;
      return found
        ? current.map((entry) => (entry.key === key ? next : entry))
        : [...current, next];
    });
    setActive(key);
    setComparison(null);
  };
  const openVersion = (node) => {
    const version = group?.versions.find((entry) => entry.id === node.id);
    open({
      projectId: tab.projectId,
      versionId: node.id,
      name: version?.name ?? tab.name,
      group: group?.name,
    });
  };
  const versionTree =
    tab && group
      ? html`<${VersionTree}
          key=${group.id}
          group=${group}
          name=${tab.label ?? tab.name}
          currentId=${currentId}
          editing=${tab.kind === 'project' && !!edit && tab.format !== 'pdf'}
          canCompare=${!compareBlocked}
          canEdit=${editFrom}
          onClose=${() => setPanelTab('notes')}
          onWiden=${() => savePanel('deskPanel')(PANEL.max)}
          onOpen=${openVersion}
          onEdit=${startFrom}
          onCompare=${(left, right) => setComparison({ key: tab.key, left, right })}
          ask=${ask}
        />`
      : html`<div class="ss-panel__head">
            <span class="ss-panel__title">${t('版本树')}</span>
            <span class="ss-titlebar__spacer"></span>
            <${IconButton}
              icon="x"
              label=${t('关闭版本树')}
              onClick=${() => setPanelTab('notes')}
            />
          </div>
          <div class="ss-panel__body">
            <div class="ss-empty">
              <${Illustration} name="versions" />
              <div class="ss-empty__title">${t('这份文稿还没有版本')}</div>
              <div class="ss-empty__text">
                ${t('保存为版本、关闭编辑或在外面改过文件后，这里会长出版本树。')}
              </div>
            </div>
          </div>`;
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
      edit=${edit}
      editing=${editing}
      onSave=${save}
      compare=${compareBlocked}
      comparing=${comparing}
      onCompare=${toggleCompare}
      onNote=${notes.add}
      onQuote=${assist.quote}
      onVersions=${showVersions}
      texEngines=${texEngines}
      onCompile=${compile}
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
      ${
        comparing
          ? html`<${VersionCompare}
              tag="main"
              versions=${group?.versions ?? []}
              left=${comparison.left}
              right=${comparison.right}
              onPick=${(left, right) => setComparison({ ...comparison, left, right })}
              onExit=${() => setComparison(null)}
            />`
          : html`<div class="ss-desk-stage">
              <button
                type="button"
                class="ss-desk-orb"
                aria-label=${t('任务秘书')}
                aria-disabled=${boundId ? undefined : 'true'}
                aria-pressed=${String(panel && panelTab === 'secretary')}
                data-tip=${boundId ? t('这个对话的秘书') : t('绑定对话后才有秘书')}
                onClick=${() => {
                  if (!boundId) return;
                  const showing = panel && panelTab === 'secretary';
                  setPanel(true);
                  setPanelTab(showing ? 'chat' : 'secretary');
                }}
              >
                <${Lucide} name="clipboard-list" />
              </button>
              <main
                class="ss-desk-canvas"
                ref=${canvas}
                onScroll=${onScroll}
                onContextMenu=${assist.onContextMenu}
              >
                ${
                  tab
                    ? html`<${DeskDocument}
                        key=${`${tab.key}#${tab.restart ?? 0}`}
                        tab=${tab}
                        view=${view}
                        jump=${jump}
                        pdf=${pdf}
                        editing=${editing}
                        onEdit=${setEdit}
                        ask=${ask}
                        onSession=${(id) => {
                          if (!id) return;
                          sessions.current[tab.key] = id;
                          setOpened((count) => count + 1);
                          // Opened from an older version once; reopening later starts from the file.
                          if (tab.from)
                            setTabs((current) =>
                              current.map((entry) =>
                                entry.key === tab.key ? { ...entry, from: undefined } : entry,
                              ),
                            );
                        }}
                        onSelection=${() => {
                          assist.onSelection();
                          notes.onSelection();
                        }}
                        onRemoved=${notes.onRemoved}
                        onReady=${() => setReady((value) => value + 1)}
                        onView=${(next) => setViews((known) => ({ ...known, [tab.key]: next }))}
                        onInfo=${(next) => setInfo((known) => ({ ...known, ...next }))}
                      />`
                    : html`<div class="ss-empty ss-desk-canvas__state">
                        <${Illustration} name="desk" />
                        <div class="ss-empty__title">${t('还没有打开文稿')}</div>
                        <div class="ss-empty__text">
                          ${t('在左栏选一份 docx、tex、md 或 pdf 打开，可以同时开几份，在顶部切换。')}
                        </div>
                      </div>`
                }
                ${assist.layer}
              </main>
            </div>`
      }
      ${
        panel &&
        !comparing &&
        panelTab === 'secretary' &&
        boundId &&
        html`<${SecretaryPanel}
          key=${boundId}
          mainMeetingId=${boundId}
          onBack=${() => setPanelTab('chat')}
          backLabel="回到对话"
          withChatName
          onClose=${() => {
            setPanel(false);
            setPanelTab('chat');
          }}
        />`
      }
      ${
        panel &&
        !comparing &&
        !(panelTab === 'secretary' && boundId) &&
        html`<${DeskPanel}
          tab=${panelTab}
          onTab=${setPanelTab}
          onClose=${() => setPanel(false)}
          width=${panelWidth}
          onWidth=${savePanel('deskPanel')}
          notes=${notes.panel}
          count=${notes.count}
          versions=${versionTree}
          chat=${html`<${DeskChat}
            meetingId=${boundId}
            projectId=${chatProject}
            onBound=${(id) => chatProject && deskChats.set(chatProject, id)}
          />`}
        />`
      }
      ${notes.layer}<${FilePreview} />
    </div>
    <${Statusbar}
      tab=${tab}
      group=${group}
      info=${info}
      edit=${edit}
      comparing=${comparing}
      view=${view}
      currentId=${currentId}
      onVersions=${showVersions}
      chat=${bound}
      onChat=${() => {
        setPanel(true);
        setPanelTab('chat');
      }}
    />
    ${question}
  </div>`;
}
