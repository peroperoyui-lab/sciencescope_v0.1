// 项目资料 (design system PageProjectFolder) and the workbench's 项目文件夹
// card: the bound folder, or else the project's own one, as a tree whose files
// carry a dot for how they are indexed. The page shows the selected file's
// facts and the start of its text beside the tree. ScienceScope writes nothing
// of its own into the folder; new folders, imports, renaming and moving to the
// recycle bin happen when the user asks.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Illustration } from '../illustrations.js';
import { navigate } from '../route.js';
import { Dialog, FieldDialog, useQuestion } from './dialog.js';

const parentOf = (relative) => relative.split('/').slice(0, -1).join('/');
const join = (folder, name) => (folder ? `${folder}/${name}` : name);

// The kinds the global knowledge base shows from every project (records.js).
const LITERATURE = ['paper', 'preprint', 'thesis', 'report', 'chapter', 'book'];

/** Each index status: the dot, its words, and the tip when nothing more is known. */
const STATES = {
  parsed: { dot: 'ss-dot ss-dot--ok', text: '已解析' },
  parsing: { spin: true, text: '解析中' },
  'name-only': {
    dot: 'ss-dot ss-dot--ring',
    text: '仅索引文件名',
    tip: '这种格式不解析内容，按文件名和位置索引',
  },
  failed: { dot: 'ss-dot ss-dot--danger', text: '解析失败', tip: '仍能按文件名找到。' },
  unindexed: { dot: 'ss-dot', text: '还没有索引', tip: '扫描到这里后会建索引。' },
};

/** @type {[RegExp, string][]} */
const ICONS = [
  [/\.(pdf|docx?|md|txt|tex|rtf|odt|html?)$/i, 'file-text'],
  [/\.(py|r|rmd|qmd|ipynb|js|ts|sh|do|sas|sps|m|jl|sql)$/i, 'file-code'],
  [/\.(dta|sav|csv|tsv|parquet|feather|rds|rdata|sqlite|db|json)$/i, 'database'],
  [/\.(xlsx?|ods)$/i, 'table-2'],
  [/\.(png|jpe?g|gif|svg|webp|tiff?|bmp)$/i, 'image'],
];
/** @param {string} name */
const fileIcon = (name) => ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? 'file';

/** @param {number} bytes */
function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** @param {{ index?: { status: string, error?: string | null } }} entry */
function stateOf(entry) {
  const status = entry.index?.status ?? 'unindexed';
  const state = STATES[status] ?? STATES.unindexed;
  return { status, ...state, tip: entry.index?.error || state.tip };
}

/** @param {{ entry: any }} props */
function StateDot({ entry }) {
  const state = stateOf(entry);
  return html`<span
    class="ss-folder-tree__state"
    data-state=${state.status}
    data-tip=${state.tip ? `${t(state.text)} · ${t(state.tip)}` : t(state.text)}
    aria-label=${t(state.text)}
    role="img"
  >
    ${state.spin ? html`<span class="ss-spin"></span>` : html`<span class=${state.dot}></span>`}
  </span>`;
}

/**
 * The folder's listings, loaded as folders open and reloaded when files change.
 * @param {string} projectId @param {number} version
 */
function useListings(projectId, version) {
  const actions = useActions();
  const [listings, setListings] = useState(/** @type {Record<string, any[]>} */ ({}));
  const [root, setRoot] = useState('');
  const [open, setOpen] = useState(/** @type {Record<string, boolean>} */ ({}));
  const load = (folder) =>
    actions
      .projectFiles(projectId, folder)
      .then((listing) => {
        if (!folder) setRoot(listing.root);
        setListings((current) => ({ ...current, [folder]: listing.entries }));
      })
      .catch((error) => actions.toast(error.message));
  useEffect(() => {
    setListings({});
    setOpen({});
  }, [projectId]);
  useEffect(() => {
    for (const folder of ['', ...Object.keys(open).filter((key) => open[key])]) void load(folder);
  }, [projectId, version]);
  const toggle = (folder, value = !open[folder]) => {
    setOpen((current) => ({ ...current, [folder]: value }));
    if (value) void load(folder);
  };
  /** The visible rows, depth first. */
  const rows = [];
  const walk = (folder, depth) => {
    for (const entry of listings[folder] ?? []) {
      rows.push({ entry, depth });
      if (entry.kind === 'folder' && open[entry.path]) walk(entry.path, depth + 1);
    }
  };
  walk('', 0);
  return { root, rows, open, toggle, loaded: Boolean(listings['']), listings };
}

/**
 * @param {{ label: string, rows: {entry:any, depth:number}[], open: Record<string, boolean>,
 *   toggle: (folder: string, value?: boolean) => void, selected?: string | null,
 *   onSelect?: (entry: any) => void, onOpen: (entry: any) => void,
 *   onMenu: (event: MouseEvent, entry: any) => void,
 *   onKey?: (event: KeyboardEvent, entry: any) => void }} props
 */
function FileTree({ label, rows, open, toggle, selected, onSelect, onOpen, onMenu, onKey }) {
  const tree = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [focus, setFocus] = useState(/** @type {string | null} */ (null));
  const current = selected ?? focus;
  const focusRow = (path) => {
    setFocus(path);
    /** @type {HTMLElement | null | undefined} */ (
      tree.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)
    )?.focus();
  };
  const choose = (entry) => (onSelect ? onSelect(entry) : setFocus(entry.path));
  /** @param {KeyboardEvent} event @param {any} entry @param {number} index */
  const keys = (event, entry, index) => {
    const move = (to) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (!row) return;
      choose(row.entry);
      focusRow(row.entry.path);
    };
    const folder = entry.kind === 'folder';
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'ArrowRight' && folder) {
      if (!open[entry.path]) toggle(entry.path, true);
      else move(index + 1);
    } else if (event.key === 'ArrowLeft') {
      if (folder && open[entry.path]) toggle(entry.path, false);
      else if (parentOf(entry.path))
        move(rows.findIndex((row) => row.entry.path === parentOf(entry.path)));
      else return;
    } else if (event.key === 'Enter') {
      if (folder) toggle(entry.path);
      else onOpen(entry);
    } else {
      onKey?.(event, entry);
      return;
    }
    event.preventDefault();
  };
  return html`<div class="ss-tree ss-folder-tree" role="tree" aria-label=${label} ref=${tree}>
    ${rows.map(({ entry, depth }, index) => {
      const folder = entry.kind === 'folder';
      const isCurrent = current ? current === entry.path : index === 0;
      return html`<div
        key=${entry.path}
        class="ss-tree-row ss-tree-row--nested"
        role="treeitem"
        style=${{ '--depth': depth }}
        tabindex=${isCurrent ? '0' : '-1'}
        data-path=${entry.path}
        aria-level=${depth + 1}
        aria-expanded=${folder ? String(Boolean(open[entry.path])) : undefined}
        aria-selected=${onSelect ? String(selected === entry.path) : undefined}
        onClick=${() => {
          choose(entry);
          if (folder) toggle(entry.path);
          else if (!onSelect) onOpen(entry);
        }}
        onDblClick=${() => !folder && onSelect && onOpen(entry)}
        onContextMenu=${(event) => {
          choose(entry);
          onMenu(event, entry);
        }}
        onKeyDown=${(event) => keys(event, entry, index)}
      >
        <span class="ss-tree-row__twisty" aria-hidden="true">
          ${folder && html`<${Lucide} name="chevron-down" />`}
        </span>
        <${Lucide}
          name=${folder ? (open[entry.path] ? 'folder-open' : 'folder') : fileIcon(entry.name)}
        />
        <span class="ss-tree-row__label" title=${entry.path}>${entry.name}</span>
        ${!folder && html`<${StateDot} entry=${entry} />`}
      </div>`;
    })}
  </div>`;
}

/**
 * File operations shared by the page and the workbench card: the menus, the
 * rename / new-folder dialogs and the recycle-bin question. `reveal` opens
 * the folder a new folder was made in.
 * @param {any} project @param {(folder: string) => void} [reveal]
 */
function useFileActions(project, reveal) {
  const actions = useActions();
  const [question, ask] = useQuestion();
  const [field, setField] = useState(/** @type {any} */ (null));
  const fileOp = (body) => actions.attempt(() => actions.fileOp(project.id, body));
  const rename = (entry) =>
    setField({
      title: t('重命名'),
      label: t('名称'),
      value: entry.name,
      submitText: t('保存'),
      onSave: (name) =>
        fileOp({ op: 'rename', path: entry.path, to: join(parentOf(entry.path), name) }),
    });
  const newFolder = (parent = '') =>
    setField({
      title: t('新建文件夹'),
      label: t('名称'),
      value: '',
      submitText: t('创建'),
      onSave: async (name) => {
        if ((await fileOp({ op: 'mkdir', path: join(parent, name) })) && parent) reveal?.(parent);
      },
    });
  const recycle = async (entry) => {
    const choice = await ask({
      title: t('移到回收站？'),
      text: t('「{name}」会移到系统回收站，需要时可以从回收站恢复。', { name: entry.name }),
      options: [{ value: 'recycle', label: t('移到回收站'), primary: true }],
    });
    if (choice === 'recycle') await fileOp({ op: 'recycle', path: entry.path });
  };
  const open = (entry) => fileOp({ op: 'open', path: entry.path });
  /**
   * @param {any} entry @param {{ kind?: string } | null} [source]
   * @param {{ importInto?: (folder: string) => void }} [options]
   */
  const menuItems = (entry, source = null, { importInto } = {}) => {
    if (entry.kind === 'folder')
      return [
        { text: t('在资源管理器中打开'), icon: 'folder-open', run: () => open(entry) },
        { sep: true },
        { text: t('新建文件夹'), icon: 'folder-plus', run: () => newFolder(entry.path) },
        ...(importInto
          ? [{ text: t('导入到此文件夹'), icon: 'import', run: () => importInto(entry.path) }]
          : []),
        { sep: true },
        { text: t('重命名'), icon: 'pencil', key: 'F2', run: () => rename(entry) },
        { text: t('移到回收站'), icon: 'trash-2', danger: true, run: () => recycle(entry) },
      ];
    const id = entry.index?.sourceId;
    // Without the source's kind yet (a menu from the tree), offer both and let
    // the knowledge page say what it has.
    const literature = source ? LITERATURE.includes(source.kind ?? '') : true;
    return [
      { text: t('用默认程序打开'), icon: 'external-link', run: () => open(entry) },
      {
        text: t('在资源管理器中显示'),
        icon: 'folder-open',
        run: () => fileOp({ op: 'open', path: parentOf(entry.path) }),
      },
      {
        text: t('在知识库图中查看'),
        icon: 'waypoints',
        disabled: !id || !literature,
        run: () => actions.openKnowledgeSource({ id, title: entry.name, graph: true }),
      },
      { sep: true },
      {
        text: t('重新解析'),
        icon: 'refresh-cw',
        disabled: !id,
        run: () =>
          actions.attempt(async () => {
            await actions.reparseResearchSource(id);
            actions.toast(t('已开始重新解析。'));
          }),
      },
      {
        text: t('整理卡片'),
        icon: 'sparkle',
        disabled: !id || !literature,
        run: () =>
          actions.attempt(async () => {
            await actions.requestCards([id]);
            actions.toast(t('已加入卡片整理队列。'));
          }),
      },
      { sep: true },
      { text: t('重命名'), icon: 'pencil', key: 'F2', run: () => rename(entry) },
      { text: t('移到回收站'), icon: 'trash-2', danger: true, run: () => recycle(entry) },
    ];
  };
  /** F2 and Delete on a row. @param {KeyboardEvent} event @param {any} entry */
  const onKey = (event, entry) => {
    if (event.key === 'F2') rename(entry);
    else if (event.key === 'Delete') void recycle(entry);
    else return;
    event.preventDefault();
  };
  const dialogs = html`${field && html`<${FieldDialog} ...${field} onClose=${() => setField(null)} />`}
  ${question}`;
  return { open, newFolder, menuItems, onKey, dialogs };
}

/** Change future meetings' folder without moving files or existing meetings. */
function BindDialog({ project, root, onClose }) {
  const actions = useActions();
  const [folder, setFolder] = useState(project.folder ?? '');
  const pick = globalThis.__TAURI__?.dialog?.open;
  const save = (value) =>
    actions.attempt(async () => {
      await actions.updateProject(project.id, { folder: value });
      onClose();
    });
  return html`<${Dialog}
    title=${t('项目文件夹位置')}
    onClose=${onClose}
    onSubmit=${() => folder.trim() && save(folder.trim())}
    foot=${html`<button type="button" class="ss-btn" onClick=${() => save(null)}>
        ${t('使用项目自带文件夹')}
      </button>
      <span class="ss-spacer"></span>
      <button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${!folder.trim()}>
        ${t('绑定')}
      </button>`}
  >
    <div class="ss-stack">
      <p class="ss-muted ss-mono ss-folder__root">${root}</p>
      <label class="ss-field">
        <span class="ss-field__label">${t('文件夹路径')}</span>
        <span class="ss-input">
          <input value=${folder} onInput=${(event) => setFolder(event.currentTarget.value)} />
          ${
            pick &&
            html`<button
              type="button"
              class="ss-icon-btn ss-icon-btn--sm"
              aria-label=${t('选择已有文件夹')}
              data-tip=${t('选择已有文件夹')}
              onClick=${() =>
                actions.attempt(async () => {
                  const chosen = await pick({ directory: true, multiple: false });
                  if (typeof chosen === 'string') setFolder(chosen);
                })}
            >
              <${Lucide} name="folder-open" />
            </button>`
          }
        </span>
        <span class="ss-field__hint">
          ${t('更换位置不会移动已有文件；已有会议继续使用原工作目录，新会议使用新位置。')}
        </span>
      </label>
    </div>
  <//>`;
}

/** Read files the user picked and copy them into `folder`. */
async function importFiles(actions, projectId, files, folder) {
  for (const file of files) {
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.readAsDataURL(file);
    });
    await actions.attempt(() =>
      actions.fileOp(projectId, { op: 'add', path: join(folder, file.name), base64 }),
    );
  }
}

/** The name row of the details: icon, name and actions. */
function DetailHead({ icon, name, children }) {
  return html`<div class="ss-folder-detail__head">
    <${Lucide} name=${icon} />
    <span class="ss-folder-detail__name ss-truncate" title=${name}>${name}</span>
    ${children}
  </div>`;
}

/**
 * The selected file: name and actions, its facts, and the start of its text.
 * @param {{ project: any, entry: any, version: number, files: ReturnType<typeof useFileActions>,
 *   listings: Record<string, any[]> }} props
 */
function FileDetails({ project, entry, version, files, listings }) {
  const actions = useActions();
  const [detail, setDetail] = useState(/** @type {any} */ (null));
  const [relations, setRelations] = useState(/** @type {number | null} */ (null));
  const id = entry.index?.sourceId;
  useEffect(() => {
    setDetail(null);
    setRelations(null);
    if (!id) return;
    let current = true;
    actions
      .researchSource(id, { limit: 6 })
      .then((value) => current && setDetail(value))
      .catch(() => {});
    actions
      .knowledgeEdges(`source:${id}`)
      .then((edges) => current && setRelations((edges?.edges ?? edges ?? []).length))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [id, version]);
  const more = (event, source = null) =>
    actions.openMenu(event, files.menuItems(entry, source), entry.name);
  const moreButton = (source = null) =>
    html`<button
      type="button"
      class="ss-icon-btn"
      aria-label=${t('更多')}
      aria-haspopup="menu"
      onClick=${(event) => more(event, source)}
    >
      <${Lucide} name="ellipsis" />
    </button>`;
  if (entry.kind === 'folder') {
    const children = listings[entry.path];
    const folders = children?.filter((child) => child.kind === 'folder').length ?? 0;
    return html`<div class="ss-folder-detail">
      <${DetailHead} icon="folder" name=${entry.name}>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('在资源管理器中打开')}
          data-tip=${t('在资源管理器中打开')}
          onClick=${() => files.open(entry)}
        >
          <${Lucide} name="external-link" />
        </button>
        ${moreButton()}
      <//>
      <dl class="ss-props">
        <dt>${t('位置')}</dt>
        <dd>${entry.path}</dd>
        ${
          children &&
          html`<dt>${t('内容')}</dt>
            <dd>
              ${t('{folders} 个文件夹，{files} 个文件', {
                folders,
                files: children.length - folders,
              })}
            </dd>`
        }
      </dl>
    </div>`;
  }
  const state = stateOf(entry);
  const source = detail?.source;
  const literature = LITERATURE.includes(source?.kind ?? '');
  const modified = source?.fileMtimeMs ? new Date(source.fileMtimeMs) : null;
  const pad = (value) => String(value).padStart(2, '0');
  const facts = source && [
    literature ? t('在全局知识库') : t('只在项目资料库'),
    relations != null && t('{n} 条关系', { n: relations }),
    t('引用编号 {label}', { label: source.label }),
  ];
  return html`<div class="ss-folder-detail">
    <${DetailHead} icon=${fileIcon(entry.name)} name=${entry.name}>
      <button
        type="button"
        class="ss-btn ss-btn--sm"
        disabled=${!source}
        onClick=${() =>
          actions.openKnowledgeSource({
            id,
            title: entry.name,
            projectId: literature ? null : project.id,
          })}
      >
        <${Lucide} name="waypoints" />${t('在知识库中查看')}
      </button>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('用默认程序打开')}
        data-tip=${t('用默认程序打开')}
        onClick=${() => files.open(entry)}
      >
        <${Lucide} name="external-link" />
      </button>
      ${moreButton(source ?? null)}
    <//>
    <dl class="ss-props">
      <dt>${t('位置')}</dt>
      <dd>${entry.path}</dd>
      ${
        source?.fileSize != null &&
        html`<dt>${t('大小')}</dt>
          <dd>
            ${size(source.fileSize)}${
              modified
                ? ` · ${t('{date} 修改', { date: `${pad(modified.getMonth() + 1)}-${pad(modified.getDate())}` })}`
                : ''
            }
          </dd>`
      }
      <dt>${t('索引')}</dt>
      <dd>
        <span class="ss-kind">
          ${state.spin ? html`<span class="ss-spin"></span>` : html`<span class=${state.dot}></span>`}
          ${t(state.text)}${detail?.total ? ` · ${t('{n} 个文本块', { n: detail.total })}` : ''}
        </span>
      </dd>
      ${
        facts &&
        html`<dt>${t('知识库')}</dt>
          <dd>${facts.filter(Boolean).join(' · ')}</dd>`
      }
    </dl>
    ${
      entry.index?.error &&
      html`<p class="ss-folder-detail__error" role="alert">${entry.index.error}</p>`
    }
    <section class="ss-folder-detail__preview" aria-label=${t('正文预览')}>
      <h3 class="ss-section-title">${t('正文预览')}</h3>
      ${
        detail?.chunks?.length
          ? html`<div class="ss-folder-detail__text t-body">
              ${detail.chunks.map((chunk) => html`<p key=${chunk.id}>${chunk.text}</p>`)}
              ${detail.remaining > 0 && html`<p class="ss-muted">……</p>`}
            </div>`
          : html`<p class="ss-muted">
              ${
                state.status === 'parsing'
                  ? t('正在解析，完成后显示正文。')
                  : state.status === 'parsed'
                    ? t('这个文件没有可显示的文字。')
                    : t(state.tip ?? '')
              }
            </p>`
      }
    </section>
  </div>`;
}

/** @param {{ counts?: any }} props */
function Summary({ counts }) {
  if (!counts) return null;
  const parts = [t('已索引 {n} 个文件', { n: counts.parsed + counts.nameOnly })];
  if (counts.parsing) parts.push(t('正在解析 {n} 个', { n: counts.parsing }));
  if (counts.nameOnly) parts.push(t('{n} 个只索引文件名', { n: counts.nameOnly }));
  if (counts.failed) parts.push(t('{n} 个失败', { n: counts.failed }));
  return html`<div class="ss-folder__summary" role="status">
    ${counts.parsing > 0 && html`<span class="ss-spin"></span>`}
    <span>${parts.join(t('，'))}</span>
  </div>`;
}

/** @param {{ project: any }} props */
export function ProjectFolderPage({ project }) {
  const actions = useActions();
  const filesVersion = useAppState((state) => state.workspaceVersion + state.filesVersion);
  const researchVersion = useAppState((state) => state.researchVersion);
  const [refresh, setRefresh] = useState(0);
  const version = filesVersion + researchVersion + refresh;
  const tree = useListings(project.id, version);
  const files = useFileActions(project, (folder) => tree.toggle(folder, true));
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const [counts, setCounts] = useState(/** @type {any} */ (null));
  const [binding, setBinding] = useState(false);
  const picker = useRef(/** @type {HTMLInputElement | null} */ (null));
  const target = useRef('');
  useEffect(() => {
    let current = true;
    actions
      .projectIndex(project.id)
      .then((status) => current && setCounts(status.counts))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [project.id, version]);
  useEffect(() => setSelected(null), [project.id]);
  const entry = tree.rows.find((row) => row.entry.path === selected)?.entry;
  // 导入 copies into the open folder: the selected folder, or the selected file's.
  const importFolder = entry ? (entry.kind === 'folder' ? entry.path : parentOf(entry.path)) : '';
  const chooseImport = (folder) => {
    target.current = folder;
    picker.current?.click();
  };
  // The request returns when the scan is done; the dots update as it goes.
  const rescan = () => {
    actions.toast(t('已开始重新扫描。'));
    void actions.attempt(async () => {
      await actions.scanProject(project.id);
      setRefresh((value) => value + 1);
    });
  };
  const more = (event) =>
    actions.openMenu(
      event,
      [
        {
          text: t('在资源管理器中打开'),
          icon: 'folder-open',
          run: () => files.open({ path: '' }),
        },
        { text: t('项目文件夹位置…'), icon: 'folder', run: () => setBinding(true) },
      ],
      t('项目资料'),
    );
  const empty = tree.loaded && !tree.rows.length;
  return html`<main class="main ss-main ss-folder-page">
    <div class="ss-header">
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('返回工作站')}
        data-tip=${t('返回工作站')}
        onClick=${() => navigate({ view: 'workbench', id: project.id })}
      >
        <${Lucide} name="arrow-left" />
      </button>
      <div class="ss-header__title">
        <span>${t('项目资料')}</span>
        <button
          type="button"
          class="ss-info"
          aria-label=${t('说明')}
          data-tip=${t(
            '这里就是项目文件夹本身。每个文件都在 ScienceScope 的数据目录里留一份副本并建索引，能解析的解析，不能解析的按文件名和位置找到；项目文件夹里不会多出任何文件。',
          )}
          data-tip-place="bottom-start"
        >
          <${Lucide} name="info" />
        </button>
      </div>
      <span class="ss-muted ss-mono ss-folder__root ss-truncate" title=${tree.root}
        >${tree.root}</span
      >
      <div class="ss-header__actions">
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('重新扫描')}
          data-tip=${t('重新扫描')}
          onClick=${rescan}
        >
          <${Lucide} name="refresh-cw" />
        </button>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('新建文件夹')}
          data-tip=${t('新建文件夹')}
          onClick=${() => files.newFolder(importFolder)}
        >
          <${Lucide} name="folder-plus" />
        </button>
        <button type="button" class="ss-btn" onClick=${() => chooseImport(importFolder)}>
          <${Lucide} name="import" />${t('导入到此文件夹')}
        </button>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('更多')}
          aria-haspopup="menu"
          onClick=${more}
        >
          <${Lucide} name="ellipsis" />
        </button>
      </div>
    </div>
    ${
      empty
        ? html`<div class="ss-content">
            <div class="ss-empty">
              <${Illustration} name="folder" />
              <div class="ss-empty__title">${t('项目文件夹是空的')}</div>
              <div class="ss-empty__text">
                ${t('把资料、数据和代码放进这个文件夹，或从这里导入。')}
              </div>
              <div class="ss-empty__actions">
                <button type="button" class="ss-btn" onClick=${() => chooseImport('')}>
                  <${Lucide} name="import" />${t('导入文件')}
                </button>
              </div>
            </div>
          </div>`
        : html`<div class="ss-folder">
            <div class="ss-folder__tree">
              <${FileTree}
                label=${t('项目文件夹')}
                rows=${tree.rows}
                open=${tree.open}
                toggle=${tree.toggle}
                selected=${selected}
                onSelect=${(row) => setSelected(row.path)}
                onOpen=${files.open}
                onMenu=${(event, row) =>
                  actions.openMenu(
                    event,
                    files.menuItems(row, null, { importInto: chooseImport }),
                    row.name,
                  )}
                onKey=${files.onKey}
              />
              <${Summary} counts=${counts} />
            </div>
            <div class="ss-folder__detail">
              ${
                entry
                  ? html`<${FileDetails}
                      project=${project}
                      entry=${entry}
                      version=${version}
                      files=${files}
                      listings=${tree.listings}
                    />`
                  : html`<p class="ss-muted ss-folder__hint">
                      ${t('选一个文件，看它的索引状态和正文。双击用默认程序打开。')}
                    </p>`
              }
            </div>
          </div>`
    }
    <input
      ref=${picker}
      type="file"
      multiple
      hidden
      onChange=${async (event) => {
        const chosen = [...event.currentTarget.files];
        event.currentTarget.value = '';
        await importFiles(actions, project.id, chosen, target.current);
        setRefresh((value) => value + 1);
      }}
    />
    ${
      binding &&
      html`<${BindDialog}
        project=${project}
        root=${tree.root}
        onClose=${() => setBinding(false)}
      />`
    }
    ${files.dialogs}
  </main>`;
}

/** The workbench's 项目文件夹 card. @param {{ project: any }} props */
export function ProjectFolder({ project }) {
  const actions = useActions();
  const version = useAppState(
    (state) => state.workspaceVersion + state.filesVersion + state.researchVersion,
  );
  const tree = useListings(project.id, version);
  const files = useFileActions(project);
  return html`<div class="ss-box-card ss-folder-card">
    <div class="ss-box-card__head">
      <span>${t('项目文件夹')}</span>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('在资源管理器打开')}
        data-tip=${t('在资源管理器打开')}
        onClick=${() => files.open({ path: '' })}
      >
        <${Lucide} name="folder-open" />
      </button>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('打开项目资料页')}
        data-tip=${t('打开项目资料页')}
        onClick=${() => navigate({ view: 'files', id: project.id })}
      >
        <${Lucide} name="maximize-2" />
      </button>
    </div>
    <div class="ss-box-card__body ss-folder-card__body">
      ${
        tree.loaded && !tree.rows.length
          ? html`<p class="ss-muted ss-folder__hint">${t('文件夹是空的')}</p>`
          : html`<${FileTree}
              label=${t('项目文件夹')}
              rows=${tree.rows}
              open=${tree.open}
              toggle=${tree.toggle}
              onOpen=${files.open}
              onMenu=${(event, row) => actions.openMenu(event, files.menuItems(row), row.name)}
              onKey=${files.onKey}
            />`
      }
    </div>
    ${files.dialogs}
  </div>`;
}
