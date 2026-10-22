// The desk's left pane: the project's documents on top, the open document's
// outline below. Until the desk's own document list exists (D3b) it reads the
// project folder one level at a time and adds version groups kept only in data/.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

const LETTERS = { docx: 'W', tex: 'T', md: 'M', pdf: 'P', group: 'V' };
// ScienceScope's own folders inside a project's built-in folder (see knowledge/project-index.js).
const OWN_FOLDERS = ['workbench', 'notes', 'minutes', 'versions', 'desk'];

/** The desk's kind for a file name, or null when the desk cannot open it. @param {string} name */
export function deskKind(name) {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (extension === 'markdown') return 'md';
  return ['docx', 'tex', 'md', 'pdf'].includes(extension) ? extension : null;
}

/** @param {{ kind: string }} props */
export function FileType({ kind }) {
  return html`<span class=${`ss-ftype ss-ftype--${kind}`} aria-hidden="true"
    >${LETTERS[kind] ?? 'F'}</span
  >`;
}

/** @param {any[]} versions newest first */
export function latestVersion(versions) {
  return versions?.[0] ?? null;
}

/**
 * @param {{ projectId: string, builtIn: boolean, path: string, depth: number, groups: any[],
 *   activeKey: string | null, onOpen: (target: any) => void }} props
 */
function Folder({ projectId, builtIn, path, depth, groups, activeKey, onOpen }) {
  const actions = useActions();
  const [entries, setEntries] = useState(/** @type {any[] | null} */ (null));
  const [open, setOpen] = useState(/** @type {Record<string, boolean>} */ ({}));
  useEffect(() => {
    let current = true;
    setEntries(null);
    actions
      .projectFiles(projectId, path)
      .then((listing) => current && setEntries(listing.entries))
      .catch(() => current && setEntries([]));
    return () => {
      current = false;
    };
  }, [projectId, path]);
  if (!entries)
    return depth === 0
      ? html`<div class="ss-desk-nav__note"><span class="ss-spin"></span>${t('正在读取…')}</div>`
      : null;
  const shown = entries.filter((entry) =>
    entry.kind === 'folder'
      ? !(builtIn && depth === 0 && OWN_FOLDERS.includes(entry.name))
      : deskKind(entry.name),
  );
  if (!shown.length && depth === 0)
    return html`<div class="ss-desk-nav__note">
      ${t('项目文件夹里还没有 docx、tex、md 或 pdf 文稿。')}
    </div>`;
  return shown.map((entry) => {
    const style = { '--lv': depth };
    if (entry.kind === 'folder')
      return html`<div key=${entry.path}>
        <button
          type="button"
          class="ss-desk-file ss-desk-file--folder"
          style=${style}
          aria-expanded=${String(Boolean(open[entry.path]))}
          onClick=${() => setOpen({ ...open, [entry.path]: !open[entry.path] })}
        >
          <${Lucide} name=${open[entry.path] ? 'chevron-down' : 'chevron-right'} small />
          <span class="ss-desk-file__name">${entry.name}</span>
        </button>
        ${
          open[entry.path] &&
          html`<${Folder}
            projectId=${projectId}
            builtIn=${builtIn}
            path=${entry.path}
            depth=${depth + 1}
            groups=${groups}
            activeKey=${activeKey}
            onOpen=${onOpen}
          />`
        }
      </div>`;
    const version = latestVersion(
      groups.find((group) => group.sourcePath === entry.path)?.versions,
    );
    return html`<button
      key=${entry.path}
      type="button"
      class="ss-desk-file"
      style=${style}
      aria-current=${activeKey === `p:${projectId}:${entry.path}` ? 'true' : undefined}
      onClick=${() => onOpen({ projectId, path: entry.path })}
    >
      <${FileType} kind=${deskKind(entry.name)} />
      <span class="ss-desk-file__name">${entry.name}</span>
      <span class="ss-desk-file__end">${version ? `v${version.number}` : ''}</span>
    </button>`;
  });
}

/**
 * @param {{ projectId: string | null, onProject: (id: string) => void, groups: any[],
 *   activeKey: string | null, onOpen: (target: any) => void, outline: any[],
 *   current: number, onHeading: (entry: any) => void }} props
 */
export function DeskNav({
  projectId,
  onProject,
  groups,
  activeKey,
  onOpen,
  outline,
  current,
  onHeading,
}) {
  const actions = useActions();
  const projects = useAppState((state) => state.projects).filter((project) => !project.archived);
  const [reload, setReload] = useState(0);
  const project = projects.find((entry) => entry.id === projectId);
  const internal = groups.filter((group) => !group.sourcePath && group.versions.length);
  const chooseProject = (event) =>
    actions.openMenu(
      event,
      projects.map((entry) => ({
        text: entry.name,
        check: entry.id === projectId,
        run: () => onProject(entry.id),
      })),
      t('项目'),
    );
  return html`<div class="ss-desk-nav__section ss-desk-nav__files">
      <div class="ss-desk-nav__head">
        <span>${t('文件')}</span>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('刷新文件列表')}
          data-tip=${t('刷新文件列表')}
          onClick=${() => setReload(reload + 1)}
        >
          <${Lucide} name="refresh-cw" />
        </button>
      </div>
      <button
        type="button"
        class="ss-select ss-select--sm ss-select--ghost ss-desk-nav__project"
        aria-haspopup="menu"
        data-tip=${t('换一个项目')}
        disabled=${!projects.length}
        onClick=${chooseProject}
      >
        <${Lucide} name="folder" small />
        <span class="ss-select__value">${project?.name ?? t('还没有项目')}</span>
        <${Lucide} name="chevron-down" />
      </button>
      <div class="ss-desk-nav__list">
        ${
          projectId &&
          html`<${Folder}
            key=${`${projectId}:${reload}`}
            projectId=${projectId}
            builtIn=${!project?.folder}
            path=""
            depth=${0}
            groups=${groups}
            activeKey=${activeKey}
            onOpen=${onOpen}
          />`
        }
        ${
          internal.length > 0 &&
          html`<div class="ss-desk-nav__sub">${t('只在 ScienceScope 里')}</div>
            ${internal.map((group) => {
              const version = latestVersion(group.versions);
              return html`<button
                key=${group.id}
                type="button"
                class="ss-desk-file"
                data-tip=${t('这个版本组没有对应的项目文件，只保存在应用数据里')}
                aria-current=${activeKey === `v:${version.id}` ? 'true' : undefined}
                onClick=${() =>
                  onOpen({
                    projectId,
                    versionId: version.id,
                    name: version.name,
                    group: group.name,
                  })}
              >
                <${FileType} kind="group" />
                <span class="ss-desk-file__name">${group.name}</span>
                <span class="ss-desk-file__end">v${version.number}</span>
              </button>`;
            })}`
        }
      </div>
    </div>
    <div class="ss-desk-nav__section ss-desk-nav__outline">
      <div class="ss-desk-nav__head"><span>${t('大纲')}</span></div>
      ${
        outline.length
          ? html`<ul class="ss-outline">
              ${outline.map(
                (entry, index) =>
                  html`<li key=${index}>
                    <button
                      type="button"
                      style=${{ '--lv': entry.level }}
                      title=${entry.text}
                      aria-current=${index === current ? 'true' : undefined}
                      onClick=${() => onHeading({ ...entry, at: Date.now() })}
                    >
                      ${entry.text}
                    </button>
                  </li>`,
              )}
            </ul>`
          : html`<div class="ss-desk-nav__note">
              ${activeKey ? t('这份文稿没有标题。') : t('打开文稿后这里显示它的标题。')}
            </div>`
      }
    </div>`;
}
