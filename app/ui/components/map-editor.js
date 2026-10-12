// 研究导图编辑窗口 in the prototype's markup (`.editor`): the canvas, an
// inspector for the selected node (text, branches, progress, order), undo /
// redo scoped to this open editing session, and Markdown / JSON export.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { useSnapshotCapture } from '../resource-snapshots.js';
import { openResourceHistory } from './resource-history.js';
import { navigate } from '../route.js';
import { MapCanvas } from './map-canvas.js';
import { MapLinks } from './map-links.js';
import { mapTransferText } from '../map-transfer.js';

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

/** @param {{ projectId: string, focusNodeId?:string }} props */
export function MapEditor({ projectId, focusNodeId }) {
  const actions = useActions();
  const project = useAppState((state) => state.projects.find((p) => p.id === projectId));
  const version = useAppState((state) => state.workspaceVersion);
  const [map, setMap] = useState(/** @type {any} */ (null));
  const [selected, setSelected] = useState(/** @type {string | null} */ (focusNodeId ?? null));
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const undoIds = useRef(/** @type {string[]} */ ([]));
  const redoIds = useRef(/** @type {string[]} */ ([]));
  const [, refreshHistory] = useState(0);
  const draftRef = useRef({ dirty: false, text: '', id: null });
  const edits = useRef(Promise.resolve());
  useSnapshotCapture([['map', projectId]], () => commit());
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

  const updateHistory = () => refreshHistory((count) => count + 1);
  const edit = (op, args) => {
    const pending = edits.current.then(async () => {
      const result = await actions.attempt(() => actions.editResource('map', projectId, op, args));
      if (result?.value) setMap(result.value);
      if (result?.revisionId) {
        undoIds.current.push(result.revisionId);
        redoIds.current = [];
        updateHistory();
      }
      return result;
    });
    edits.current = pending.then(() => {});
    return pending;
  };
  const commit = () => {
    if (!draftRef.current.dirty || !draftRef.current.id) return edits.current;
    const current = draftRef.current;
    draftRef.current = { ...current, dirty: false };
    setDirty(false);
    return edit('updateNode', { id: current.id, changes: { text: current.text } });
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
  const addFloating = async () => {
    await commit();
    const count = nodes.filter((candidate) => candidate.floating).length;
    const result = await edit('addNode', {
      node: {
        parent: null,
        floating: true,
        text: t('新的研究节点'),
        x: 420 + count * 40,
        y: 120 + count * 100,
      },
    });
    if (result) setSelected(result.value.nodes.at(-1).id);
  };
  const connect = async () => {
    await commit();
    const current = await actions.attempt(() => actions.readResource('map', projectId));
    if (current)
      actions.openModal(
        t('节点连线'),
        html`<${MapLinks}
          map=${current.value ?? { nodes: [], edges: [] }}
          selected=${selected}
          edit=${edit}
        />`,
      );
  };
  const appendText = async (id, transfer) => {
    const text = await actions.attempt(() => mapTransferText(transfer));
    if (!text) return;
    await commit();
    const current = await actions.attempt(() => actions.readResource('map', projectId));
    const target = current?.value?.nodes.find((candidate) => candidate.id === id);
    if (!target) return;
    const result = await edit('updateNode', {
      id,
      changes: { text: target.text ? `${target.text}\n\n${text}` : text },
    });
    if (result) setSelected(id);
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
    const last = undoIds.current.at(-1);
    if (!last) return;
    const result = await actions.attempt(() => actions.undo(last));
    if (result) {
      undoIds.current.pop();
      redoIds.current.push(result.revisionId);
      updateHistory();
    }
  };
  const redoLast = async () => {
    const last = redoIds.current.at(-1);
    if (!last) return;
    const result = await actions.attempt(() => actions.undo(last));
    if (result) {
      redoIds.current.pop();
      undoIds.current.push(result.revisionId);
      updateHistory();
    }
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
        <button class="btn tiny" onClick=${addFloating}>${t('游离节点')}</button>
        <button class="btn tiny" disabled=${nodes.length < 2} onClick=${connect}>
          ${t('连线')}
        </button>
        <button
          class="iconbtn"
          title=${t('撤销')}
          aria-label=${t('撤销')}
          disabled=${!undoIds.current.length && !dirty}
          onClick=${undo}
        >
          <${Icon} name="undo" />
        </button>
        <button
          class="iconbtn"
          title=${t('重做')}
          aria-label=${t('重做')}
          disabled=${!redoIds.current.length}
          onClick=${redoLast}
        >
          <${Icon} name="redo" />
        </button>
        <button class="btn tiny" onClick=${insertMenu}><${Icon} name="plus" /> ${t('插入')}</button>
        <button
          class="btn tiny"
          onClick=${() => openResourceHistory(actions, { resource: 'map', key: projectId })}
        >
          ${t('历史版本')}
        </button>
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
          edges=${map?.edges ?? []}
          editing
          onMoveNode=${async (id, position) => {
            await commit();
            await edit('updateNode', { id, changes: position });
          }}
          onDropText=${appendText}
          onPasteText=${appendText}
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
          <span class="tag"
            >${node?.floating ? t('游离节点') : node?.parent ? t('分支内容') : t('主干节点')}</span
          >
        </div>
        ${
          node
            ? html`<div class="field">
                  <label class="label">${t('节点内容 · Markdown')}</label>
                  <textarea
                    style="min-height:170px"
                    value=${draft}
                    onInput=${(event) => {
                      draftRef.current = {
                        dirty: true,
                        text: event.currentTarget.value,
                        id: node.id,
                      };
                      setDraft(event.currentTarget.value);
                      setDirty(true);
                    }}
                    onDragOver=${(event) => event.preventDefault()}
                    onDrop=${(event) => {
                      event.preventDefault();
                      appendText(node.id, event.dataTransfer);
                    }}
                    onPaste=${(event) => {
                      if (event.clipboardData.files.length) {
                        event.preventDefault();
                        appendText(node.id, event.clipboardData);
                      }
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
      <span>${dirty ? t('有未保存的修改') : t('已保存')}</span>
      <span class="spacer"></span>
      <span>${t('加号新增 / 展开 · 减号收起')}</span>
    </div>
  </div>`;
}
