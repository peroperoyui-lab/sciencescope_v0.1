// 研究导图编辑窗口 in the prototype's markup (`.editor`): the canvas, an
// inspector for the selected node (text, branches, progress, order), undo /
// redo through the workspace revisions, and Markdown / JSON export.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';
import { MapCanvas } from './map-canvas.js';

const STATUSES = ['待开始', '进行中', '已整理', '待核查', '已完成'];

/** The map as a Markdown outline. @param {any[]} nodes */
function outline(nodes) {
  const known = new Set(nodes.map((node) => node.id));
  const lines = [];
  const walk = (node, depth) => {
    const [first, ...rest] = node.text.split('\n');
    lines.push(`${'  '.repeat(depth)}- ${first}${node.status ? ` （${node.status}）` : ''}`);
    for (const line of rest) lines.push(`${'  '.repeat(depth + 1)}${line}`);
    for (const child of nodes.filter((candidate) => candidate.parent === node.id))
      walk(child, depth + 1);
  };
  for (const root of nodes.filter((node) => !node.parent || !known.has(node.parent))) walk(root, 0);
  return `${lines.join('\n')}\n`;
}

function save(name, text, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking at once can cancel the download before it starts.
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

/** @param {{ projectId: string }} props */
export function MapEditor({ projectId }) {
  const actions = useActions();
  const project = useAppState((state) => state.projects.find((p) => p.id === projectId));
  const version = useAppState((state) => state.workspaceVersion);
  const [map, setMap] = useState(/** @type {any} */ (null));
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [redo, setRedo] = useState(/** @type {string[]} */ ([]));
  const nodes = map?.nodes ?? [];
  const node = nodes.find((candidate) => candidate.id === selected) ?? nodes[0];

  useEffect(() => {
    actions
      .readResource('map', projectId)
      .then((file) => setMap(file.value ?? { nodes: [], edges: [] }))
      .catch((error) => actions.toast(error.message));
  }, [projectId, version]);
  useEffect(() => {
    setDraft(node?.text ?? '');
    setDirty(false);
  }, [node?.id, node?.text]);

  const edit = async (op, args) => {
    const result = await actions.attempt(() => actions.editResource('map', projectId, op, args));
    if (result) setRedo([]);
    return result;
  };
  const commit = () => {
    if (!node || !dirty) return undefined;
    setDirty(false);
    return edit('updateNode', { id: node.id, changes: { text: draft } });
  };
  const add = async (parent, after) => {
    await commit();
    const result = await edit('addNode', { node: { parent, text: t('新的内容') } });
    const created = result?.value?.nodes?.at(-1);
    if (!created) return;
    if (after) {
      // Place a new sibling right after the selected node.
      const list = result.value.nodes.filter((n) => n.id !== created.id);
      list.splice(list.findIndex((n) => n.id === after) + 1, 0, created);
      await edit('write', { map: { ...result.value, nodes: list } });
    }
    setSelected(created.id);
  };
  const move = (step) => {
    const siblings = nodes.filter((n) => n.parent === node.parent);
    const position = siblings.findIndex((n) => n.id === node.id);
    const other = siblings[position + step];
    if (!other) return;
    const list = nodes.slice();
    const a = list.findIndex((n) => n.id === node.id);
    const b = list.findIndex((n) => n.id === other.id);
    [list[a], list[b]] = [list[b], list[a]];
    edit('write', { map: { ...map, nodes: list } });
  };
  const undo = async () => {
    await commit();
    const history = await actions.history({ resource: 'map', key: projectId, limit: 50 });
    const target = history.find((revision) => !revision.undoneBy && revision.op !== 'undo');
    if (!target) return actions.toast(t('没有可以撤销的修改。'));
    const result = await actions.attempt(() => actions.undo(target.id));
    if (result) setRedo([...redo, result.revisionId]);
    return undefined;
  };
  const redoLast = async () => {
    const last = redo.at(-1);
    if (!last) return;
    const result = await actions.attempt(() => actions.undo(last));
    if (result) setRedo(redo.slice(0, -1));
  };
  const insertMenu = (event) =>
    actions.openMenu(
      event,
      [
        { text: t('同级元素'), icon: 'plus', run: () => node && add(node.parent ?? null, node.id) },
        { text: t('二级分支'), icon: 'plus', run: () => add(node?.id ?? null) },
      ],
      t('插入'),
    );
  const exportMenu = (event) =>
    actions.openMenu(
      event,
      [
        {
          text: t('Markdown 大纲'),
          icon: 'file',
          run: () => save(`${project?.name ?? 'map'}.md`, outline(nodes), 'text/markdown'),
        },
        {
          text: t('可编辑 JSON'),
          icon: 'file',
          run: () =>
            save(
              `${project?.name ?? 'map'}.json`,
              `${JSON.stringify(map, null, 2)}\n`,
              'application/json',
            ),
        },
      ],
      t('导出'),
    );

  return html`<div class="editor">
    <div class="editortop">
      <button
        class="iconbtn"
        title=${t('返回工作站')}
        aria-label=${t('返回工作站')}
        onClick=${async () => {
          await commit();
          navigate({ view: 'workbench', id: projectId });
        }}
      >
        <${Icon} name="back" />
      </button>
      <div>
        <strong>${t('研究框架与进展')}</strong>
        <div class="crumb">${project?.name ?? ''} / workbench/map.json</div>
      </div>
      <span class="spacer"></span>
      <div class="toolbar-scroll">
        <button class="iconbtn" title=${t('撤销')} aria-label=${t('撤销')} onClick=${undo}>
          <${Icon} name="undo" />
        </button>
        <button
          class="iconbtn"
          title=${t('重做')}
          aria-label=${t('重做')}
          disabled=${!redo.length}
          onClick=${redoLast}
        >
          <${Icon} name="redo" />
        </button>
        <button class="btn tiny" onClick=${insertMenu}><${Icon} name="plus" /> ${t('插入')}</button>
        <button class="btn tiny" onClick=${exportMenu}>${t('导出')}</button>
        <button class="btn primary tiny" disabled=${!dirty} onClick=${commit}>
          ${t('保存并更新预览')}
        </button>
      </div>
    </div>
    <div class="editorbody">
      <div class="editorcanvas">
        <${MapCanvas}
          nodes=${nodes}
          editing
          selected=${node?.id}
          onSelect=${async (id) => {
            await commit();
            setSelected(id);
          }}
          onAddChild=${(parent) => add(parent)}
        />
      </div>
      <aside class="editorinspector">
        <div class="between">
          <h2>${t('内容与分支')}</h2>
          <span class="tag">${node?.parent ? t('分支内容') : t('主干节点')}</span>
        </div>
        ${
          node
            ? html`<div class="field">
                  <label class="label">${t('节点内容 · Markdown')}</label>
                  <textarea
                    style="min-height:170px"
                    value=${draft}
                    onInput=${(event) => {
                      setDraft(event.currentTarget.value);
                      setDirty(true);
                    }}
                    onBlur=${commit}
                    onKeyDown=${(event) => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                        event.preventDefault();
                        add(node.parent ?? null, node.id);
                      }
                    }}
                  ></textarea>
                  <div class="hint">${t('Enter 新建同级 · Shift+Enter 块内换行')}</div>
                </div>
                <div class="row" style="flex-wrap:wrap">
                  <button class="btn tiny" onClick=${() => add(node.parent ?? null, node.id)}>
                    ${t('同级节点')}
                  </button>
                  <button class="btn tiny" onClick=${() => add(node.id)}>${t('二级分支')}</button>
                </div>
                <div class="field">
                  <label class="label">${t('进展')}</label>
                  <select
                    value=${node.status ?? ''}
                    onChange=${(event) =>
                      edit('updateNode', {
                        id: node.id,
                        changes: { status: event.currentTarget.value },
                      })}
                  >
                    <option value="">—</option>
                    ${STATUSES.map((status) => html`<option key=${status} value=${status}>${t(status)}</option>`)}
                  </select>
                </div>
                <div class="row" style="margin-top:18px">
                  <button class="btn tiny" onClick=${() => move(-1)}>${t('上移')}</button>
                  <button class="btn tiny" onClick=${() => move(1)}>${t('下移')}</button>
                  <button class="btn tiny" onClick=${() => edit('removeNode', { id: node.id })}>
                    ${t('删除节点')}
                  </button>
                </div>
                <div class="divider"></div>
                <h3>${t('内容预览')}</h3>
                <div
                  class="mdview"
                  dangerouslySetInnerHTML=${{ __html: renderMarkdown(draft) }}
                ></div>`
            : html`<p class="muted">${t('导图还没有节点。')}</p>
                <button class="btn tiny" onClick=${() => add(null)}>
                  + ${t('添加第一个节点')}
                </button>`
        }
      </aside>
    </div>
    <div class="editorfooter">
      <span class="badge-dot"></span>
      <span>${dirty ? t('有未保存的修改') : t('已保存 · 每次修改都可撤销')}</span>
      <span class="spacer"></span>
      <span>${t('加号新增 / 展开 · 减号收起')}</span>
    </div>
  </div>`;
}
