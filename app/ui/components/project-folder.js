// 项目文件夹 in the old interface's markup: the workbench's right column and
// the full page (展开文件视图). Lists the bound external folder, or else the
// project's own folder; new folders, renaming, adding files and opening
// files with their default program. Deletion uses the system recycle bin.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon, Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { InfoTip } from './info-tip.js';
import { FieldForm } from './overlays.js';

const parentOf = (relative) => relative.split('/').slice(0, -1).join('/');
const join = (folder, name) => (folder ? `${folder}/${name}` : name);

/** @param {{ projectId: string, folder: string, depth: number, version: number }} props */
function Entries({ projectId, folder, depth, version }) {
  const actions = useActions();
  const [listing, setListing] = useState(/** @type {any} */ (null));
  const [open, setOpen] = useState(/** @type {Record<string, boolean>} */ ({}));
  useEffect(() => {
    actions
      .projectFiles(projectId, folder)
      .then(setListing)
      .catch((error) => actions.toast(error.message));
  }, [projectId, folder, version]);
  if (!listing) return null;

  const fileOp = (body) => actions.attempt(() => actions.fileOp(projectId, body));
  const menu = (event, entry) =>
    actions.openMenu(
      event,
      [
        ...(entry.kind === 'file'
          ? [
              {
                text: t('预览'),
                run: () => actions.openPreview({ kind: 'project', projectId, path: entry.path }),
              },
              {
                text: t('打开'),
                icon: 'file',
                run: () => fileOp({ op: 'open', path: entry.path }),
              },
            ]
          : [
              {
                text: t('在资源管理器打开'),
                icon: 'folder',
                run: () => fileOp({ op: 'open', path: entry.path }),
              },
              {
                text: t('新建文件夹'),
                icon: 'plus',
                run: () => newFolder(actions, projectId, entry.path),
              },
            ]),
        {
          text: t('重命名'),
          icon: 'edit',
          run: () =>
            actions.openModal(
              t('重命名'),
              html`<${FieldForm}
                label=${t('名称')}
                value=${entry.name}
                submitText=${t('保存')}
                onSubmit=${(name) =>
                  actions.fileOp(projectId, {
                    op: 'rename',
                    path: entry.path,
                    to: join(parentOf(entry.path), name),
                  })}
              />`,
            ),
        },
        {
          text: t('移到回收站'),
          icon: 'trash',
          danger: true,
          run: () =>
            actions.openModal(
              t('移到回收站'),
              html`<div>
                <p>${entry.name}</p>
                <p>${t('删除后可以从系统回收站恢复。')}</p>
                <div class="row">
                  <button class="btn" onClick=${actions.closeModal}>${t('取消')}</button>
                  <button
                    class="btn danger"
                    onClick=${async () => {
                      actions.closeModal();
                      await fileOp({ op: 'recycle', path: entry.path });
                    }}
                  >
                    ${t('确认删除')}
                  </button>
                </div>
              </div>`,
            ),
        },
        {
          text: t('复制文件名'),
          icon: 'copy',
          run: () => navigator.clipboard?.writeText(entry.name),
        },
      ],
      entry.name,
    );

  return html`${listing.entries.map(
    (entry) =>
      html`<button
          key=${entry.path}
          class="wb-file-row"
          style=${{ paddingLeft: `${depth * 16 + 4}px` }}
          onClick=${() =>
            entry.kind === 'folder'
              ? setOpen({ ...open, [entry.path]: !open[entry.path] })
              : fileOp({ op: 'open', path: entry.path })}
          onContextMenu=${(event) => menu(event, entry)}
        >
          ${
            entry.kind === 'folder'
              ? html`<${Icon} name="folder" />`
              : html`<span class="wb-file-icon">${entry.name.split('.').pop().slice(0, 4)}</span>`
          }
          <span>${entry.name}</span>
        </button>
        ${
          open[entry.path] &&
          html`<${Entries}
            projectId=${projectId}
            folder=${entry.path}
            depth=${depth + 1}
            version=${version}
          />`
        }`,
  )}
  ${!listing.entries.length && !depth && html`<div class="inline-empty">${t('文件夹是空的')}</div>`}`;
}

function newFolder(actions, projectId, parent = '') {
  actions.openModal(
    t('新建文件夹'),
    html`<${FieldForm}
      label=${t('名称')}
      submitText=${t('创建')}
      onSubmit=${(name) => actions.fileOp(projectId, { op: 'mkdir', path: join(parent, name) })}
    />`,
  );
}

/** Change future meetings' folder without moving files or existing meetings. */
function BindForm({ project, root }) {
  const actions = useActions();
  const pick = globalThis.__TAURI__?.dialog?.open;
  const save = async (folder) => {
    await actions.updateProject(project.id, { folder });
    actions.closeModal();
  };
  return html`<div>
    <p class="wb-path">${root}</p>
    <${InfoTip}
      text=${t('更换位置不会移动已有文件；已有会议继续使用原工作目录，新会议使用新位置。')}
    />
    <${FieldForm}
      label=${t('文件夹路径')}
      value=${project.folder ?? ''}
      submitText=${t('绑定')}
      onSubmit=${save}
    />
    <div class="row">
      ${
        pick &&
        html`<button
          class="btn"
          onClick=${() =>
            actions.attempt(async () => {
              const chosen = await pick({ directory: true, multiple: false });
              if (typeof chosen === 'string') await save(chosen);
            })}
        >
          ${t('选择已有文件夹')}
        </button>`
      }
      <button class="btn" onClick=${() => actions.attempt(() => save(null))}>
        ${t('使用项目自带文件夹')}
      </button>
    </div>
  </div>`;
}

/** @param {{ project: any, full?: boolean }} props */
export function ProjectFolder({ project, full = false }) {
  const actions = useActions();
  const workspaceVersion = useAppState((state) => state.workspaceVersion + state.filesVersion);
  const [root, setRoot] = useState('');
  const [refresh, setRefresh] = useState(0);
  const picker = useRef(null);
  const version = refresh + workspaceVersion;
  useEffect(() => {
    actions
      .projectFiles(project.id)
      .then((listing) => setRoot(listing.root))
      .catch(() => {});
  }, [project.id, project.folder]);

  async function addFiles(event) {
    const chosen = [...event.currentTarget.files];
    event.currentTarget.value = '';
    for (const file of chosen) {
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.readAsDataURL(file);
      });
      await actions.attempt(() =>
        actions.fileOp(project.id, { op: 'add', path: file.name, base64 }),
      );
    }
    setRefresh(refresh + 1);
  }

  const tools = html`<div class="row">
    <button
      class="btn tiny"
      onClick=${() => actions.openModal(t('项目文件夹位置'), html`<${BindForm} project=${project} root=${root} />`)}
    >
      ${t('项目文件夹位置')}
    </button>
    <button class="btn tiny" onClick=${() => setRefresh(refresh + 1)}>${t('刷新')}</button>
    ${
      full &&
      html`<button class="btn tiny" onClick=${() => newFolder(actions, project.id)}>
          ${t('新建文件夹')}
        </button>
        <button class="btn tiny" onClick=${() => picker.current?.click()}>${t('添加文件')}</button>
        <input ref=${picker} type="file" multiple hidden onChange=${addFiles} />`
    }
  </div>`;
  const tree = html`${full && html`<div class="wb-path" title=${root}>${root}</div>`}
    ${full && tools}
    <${Entries} key=${root} projectId=${project.id} folder="" depth=${0} version=${version} />`;
  const openRoot = () =>
    actions.attempt(() => actions.fileOp(project.id, { op: 'open', path: '' }));

  if (full) {
    return html`<div class="content">
      <div class="pageintro between">
        <h1 style="margin:0">
          ${t('项目文件夹')}<${InfoTip}
            text=${t('显示绑定的工作目录；未绑定时显示项目自带的文件夹。ScienceScope 不在你的工作目录里存放自己的文件。')}
          />
        </h1>
        <div class="row">
          <button class="btn tiny" onClick=${openRoot}>${t('资源管理器打开')}</button>
        </div>
      </div>
      <div class="card">${tree}</div>
    </div>`;
  }
  return html`<div class="ss-box-card">
    <div class="ss-box-card__head">
      <span>${t('项目文件夹')}</span>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('在资源管理器打开')}
        data-tip=${t('在资源管理器打开')}
        onClick=${openRoot}
      >
        <${Lucide} name="folder-open" />
      </button>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('展开文件视图')}
        data-tip=${t('展开文件视图')}
        onClick=${() => navigate({ view: 'files', id: project.id })}
      >
        <${Lucide} name="maximize-2" />
      </button>
    </div>
    <div class="ss-box-card__body filetree">${tree}</div>
  </div>`;
}
