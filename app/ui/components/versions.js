// P13 keeps the old workbench left column, drop zone, grouped version rows
// and full-page table. Only implemented actions are shown at each stage.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { navigate } from '../route.js';
import { MainHead } from './mainhead.js';
import { FieldForm } from './overlays.js';
import { InfoTip } from './info-tip.js';

function ImportForm({ projectId, groups, files: initialFiles }) {
  const actions = useActions();
  const [files, setFiles] = useState(initialFiles);
  const [groupId, setGroupId] = useState('');
  const [name, setName] = useState(initialFiles[0]?.name.replace(/\.[^.]+$/, '') ?? '');
  const [saving, setSaving] = useState(false);
  function move(index, direction) {
    const ordered = [...files];
    [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
    setFiles(ordered);
  }
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await actions.importVersions(projectId, files, groupId || undefined, name);
      actions.closeModal();
    } catch (error) {
      actions.toast(error.message);
    } finally {
      setSaving(false);
    }
  }
  return html`<form onSubmit=${submit}>
    <label class="field"
      ><span class="label">${t('版本组')}</span>
      <select
        aria-label=${t('版本组')}
        value=${groupId}
        onChange=${(event) => setGroupId(event.currentTarget.value)}
      >
        <option value="">${t('新建版本组')}</option>
        ${groups.map((group) => html`<option value=${group.id}>${group.name}</option>`)}
      </select>
    </label>
    ${!groupId && html`<label class="field"><span class="label">${t('版本组名称')}</span><input aria-label=${t('版本组名称')} value=${name} onInput=${(event) => setName(event.currentTarget.value)} /></label>`}
    <div class="sectionline">
      ${t('导入顺序')}
      <${InfoTip} text=${t('按列表顺序编号；同一组的后续文件接着上一版本编号。')} />
    </div>
    <div class="stack">
      ${files.map(
        (file, index) =>
          html`<div class="row" key=${file.name + index}>
            <span class="grow">${file.name}</span>
            <button
              type="button"
              class="btn tiny"
              aria-label=${t('上移 {name}', { name: file.name })}
              disabled=${saving || index === 0}
              onClick=${() => move(index, -1)}
            >
              ${t('上移')}
            </button>
            <button
              type="button"
              class="btn tiny"
              aria-label=${t('下移 {name}', { name: file.name })}
              disabled=${saving || index === files.length - 1}
              onClick=${() => move(index, 1)}
            >
              ${t('下移')}
            </button>
          </div>`,
      )}
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:16px">
      <button type="button" class="btn" disabled=${saving} onClick=${actions.closeModal}>
        ${t('取消')}</button
      ><button class="btn primary" disabled=${saving || (!groupId && !name.trim())}>
        ${saving ? t('正在保存…') : t('导入')}
      </button>
    </div>
  </form>`;
}

const STATUS = { pending: '等待整理', running: '整理中', completed: '已完成', failed: '整理失败' };

/**
 * @param {{project:any,full?:boolean}} props
 */
export function Versions({ project, full = false }) {
  const actions = useActions();
  const changed = useAppState((state) => state.versionsVersion);
  const [groups, setGroups] = useState([]);
  const input = useRef(null);
  useEffect(() => {
    let current = true;
    actions
      .versionGroups(project.id)
      .then((value) => current && setGroups(value))
      .catch((error) => actions.toast(error.message));
    return () => {
      current = false;
    };
  }, [project.id, changed]);
  const importFiles = (files) => {
    if (files.length)
      actions.openModal(
        t('导入文献版本'),
        html`<${ImportForm} projectId=${project.id} groups=${groups} files=${Array.from(files)} />`,
      );
  };
  const rename = (group) =>
    actions.openModal(
      t('重命名版本组'),
      html`<${FieldForm}
        label=${t('版本组名称')}
        value=${group.name}
        onSubmit=${(name) => actions.renameVersionGroup(group.id, name)}
      />`,
    );
  const remove = (version) =>
    actions.openModal(
      t('移到回收站'),
      html`<div>
        <p>${version.name} · v${version.number}</p>
        <p>${t('原件和说明一起移到系统回收站。')}</p>
        <div class="row">
          <button class="btn" onClick=${actions.closeModal}>${t('取消')}</button
          ><button
            class="btn danger"
            onClick=${() =>
              actions.attempt(async () => {
                await actions.deleteVersion(version.id);
                actions.closeModal();
              })}
          >
            ${t('确认删除')}
          </button>
        </div>
      </div>`,
    );
  const menu = (event, version) =>
    actions.openMenu(
      event,
      [
        {
          text: t('打开原件'),
          icon: 'file',
          run: () => actions.attempt(() => actions.openVersion(version.id)),
        },
        {
          text: t('预览'),
          run: () =>
            actions.openPreview({ kind: 'version', id: version.id, projectId: project.id }),
        },
        {
          text: t('在资源管理器定位'),
          icon: 'folder',
          run: () => actions.attempt(() => actions.openVersion(version.id, true)),
        },
        { text: t('移到回收站'), danger: true, icon: 'trash', run: () => remove(version) },
      ],
      version.name,
    );
  const title = html`<div class="wb-title">
    <span class="grow">${t('文献版本管理')}</span
    ><${InfoTip} text=${t('原件和说明保存在应用数据目录，独立于绑定的项目文件夹。')} /><button
      class=${full ? 'btn tiny' : 'iconbtn'}
      aria-label=${t('添加文件')}
      onClick=${() => input.current?.click()}
    >
      ${full ? t('添加文件') : html`<${Icon} name="plus" />`}</button
    >${!full && html`<button class="iconbtn" aria-label=${t('查看全部')} onClick=${() => navigate({ view: 'versions', id: project.id })}><${Icon} name="expand" /></button>`}
  </div>`;
  const drop = html`<input
      type="file"
      multiple
      hidden
      ref=${input}
      onChange=${(event) => {
        importFiles(event.currentTarget.files);
        event.currentTarget.value = '';
      }}
    />
    <div
      class="dropzone"
      data-drop="version"
      onDragOver=${(event) => event.preventDefault()}
      onDrop=${(event) => {
        event.preventDefault();
        importFiles(event.dataTransfer.files);
      }}
    >
      ${t('拖入文件')}
    </div>`;
  const rows = groups.map(
    (group) =>
      html`<section key=${group.id} data-version-group=${group.id}>
        <div class="sectionline">
          <strong class="grow">${group.name}</strong
          ><button class="iconbtn" aria-label=${t('重命名版本组')} onClick=${() => rename(group)}>
            <${Icon} name="edit" />
          </button>
        </div>
        ${group.versions.map(
          (version) =>
            html`<div class="versionrow" data-version-id=${version.id} key=${version.id}>
              <span class="fileicon">${version.name.split('.').pop()?.toUpperCase()}</span>
              <div class="grow">
                <strong>${version.name} · v${version.number}</strong
                ><small
                  >${new Date(version.createdAt).toLocaleString()} ·
                  ${t(STATUS[version.notesStatus])}</small
                >
              </div>
              <button
                class="iconbtn"
                aria-label=${t('版本菜单')}
                onClick=${(event) => menu(event, version)}
              >
                <${Icon} name="more" />
              </button>
            </div>`,
        )}
      </section>`,
  );
  const body = html`${title}${full && drop}
    <div class="versionlist">
      ${
        full
          ? html`<table class="table">
              <thead>
                <tr>
                  <th>${t('文件 / 文献组')}</th>
                  <th>${t('版本')}</th>
                  <th>${t('导入时间')}</th>
                  <th>${t('秘书说明')}</th>
                  <th>${t('操作')}</th>
                </tr>
              </thead>
              <tbody>
                ${groups.flatMap((group) =>
                  group.versions.map(
                    (version) =>
                      html`<tr key=${version.id} data-version-id=${version.id}>
                        <td>
                          <div class="row">
                            <span class="fileicon"
                              >${version.name.split('.').pop()?.toUpperCase()}</span
                            >
                            <div>
                              <strong>${version.name}</strong><br /><small>${group.name}</small>
                            </div>
                          </div>
                        </td>
                        <td><span class="tag">v${version.number}</span></td>
                        <td>${new Date(version.createdAt).toLocaleString()}</td>
                        <td>${t(STATUS[version.notesStatus])}</td>
                        <td>
                          <button
                            class="btn tiny"
                            onClick=${() => actions.attempt(() => actions.openVersion(version.id))}
                          >
                            ${t('打开原件')}</button
                          ><button
                            class="btn tiny"
                            onClick=${() => actions.openPreview({ kind: 'version', id: version.id, projectId: project.id })}
                          >
                            ${t('预览')}</button
                          ><button
                            class="iconbtn"
                            aria-label=${t('版本菜单')}
                            onClick=${(event) => menu(event, version)}
                          >
                            <${Icon} name="more" />
                          </button>
                        </td>
                      </tr>`,
                  ),
                )}
              </tbody>
            </table>`
          : rows
      }${!groups.some((group) => group.versions.length) && html`<div class="inline-empty">${t('暂无文献版本')}</div>`}
    </div>
    ${!full && drop}`;
  return full
    ? html`<main class="main">
        <${MainHead} crumb=${project.name} title=${t('文献版本管理')} />
        <div class="mainbody"><div class="content">${body}</div></div>
      </main>`
    : html`<div class="wb-left">${body}</div>`;
}
