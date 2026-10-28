// The research map page (design system PageMap): the canvas with its bottom
// bar, the same map as an editable Markdown outline or JSON, and a node panel
// on the right (text, progress, branches, links, place). Undo / redo cover
// this open editing session; each visit leaves a history version.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { useSnapshotCapture } from '../resource-snapshots.js';
import { STATUSES, outline, parseOutline } from '../map-outline.js';
import { openResourceHistory } from './resource-history.js';
import { navigate } from '../route.js';
import { Dialog } from './dialog.js';
import { MapCanvas, nodeTitle } from './map-canvas.js';
import { ChoiceMenu } from './popover.js';
import { mapTransferText } from '../map-transfer.js';

const TABS = [
  ['map', '导图'],
  ['outline', 'Markdown 大纲'],
  ['json', 'JSON'],
];

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

/**
 * 连到另一个节点: the other end and whether the link has an arrow.
 * @param {{ from: any, nodes: any[], onAdd: (to: string, directed: boolean) => void, onClose: () => void }} props
 */
function LinkDialog({ from, nodes, onAdd, onClose }) {
  const others = nodes.filter((node) => node.id !== from.id);
  const [to, setTo] = useState(others[0]?.id ?? '');
  const [directed, setDirected] = useState(true);
  const name = (id) => nodeTitle(nodes.find((node) => node.id === id)?.text ?? '');
  return html`<${Dialog}
    title=${t('连到另一个节点')}
    size="sm"
    onClose=${onClose}
    onSubmit=${() => to && onAdd(to, directed)}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${!to}>
        ${t('添加连线')}
      </button>`}
  >
    <div class="ss-stack">
      <div class="ss-field">
        <span class="ss-field__label">${t('从')}</span>
        <span>${nodeTitle(from.text)}</span>
      </div>
      <div class="ss-field">
        <span class="ss-field__label">${t('连到')}</span>
        <${ChoiceMenu}
          label=${t('终点')}
          triggerClass="ss-select"
          placement="bottom-start"
          items=${others.map((node) => ({
            text: nodeTitle(node.text),
            selected: node.id === to,
            run: () => setTo(node.id),
          }))}
        >
          <span class="ss-select__value ss-truncate">${name(to)}</span>
        <//>
      </div>
      <label class="ss-check">
        <input
          type="checkbox"
          checked=${directed}
          onChange=${(event) => setDirected(event.currentTarget.checked)}
        />${t('有向连线（带箭头）')}
      </label>
    </div>
  <//>`;
}

/**
 * The outline or JSON of the map, edited as text and applied with 保存.
 * @param {{ kind: 'outline' | 'json', map: any, onApply: (map: any) => Promise<any> }} props
 */
function TextView({ kind, map, onApply }) {
  const source = kind === 'json' ? `${JSON.stringify(map, null, 2)}\n` : outline(map.nodes);
  const [text, setText] = useState(source);
  const [error, setError] = useState('');
  useEffect(() => {
    setText(source);
    setError('');
  }, [source]);
  const apply = async () => {
    try {
      const next = kind === 'json' ? JSON.parse(text) : parseOutline(text, map);
      if (!Array.isArray(next?.nodes)) throw new Error(t('JSON 里要有 nodes 数组。'));
      setError('');
      await onApply({ nodes: next.nodes, edges: Array.isArray(next.edges) ? next.edges : [] });
    } catch (failure) {
      setError(
        failure instanceof SyntaxError
          ? t('JSON 格式不对：{why}', { why: failure.message })
          : failure.message,
      );
    }
  };
  return html`<div class="ss-map-text">
    <textarea
      class="ss-textarea ss-mono ss-map-text__area"
      aria-label=${kind === 'json' ? t('导图 JSON') : t('导图 Markdown 大纲')}
      spellcheck="false"
      value=${text}
      onInput=${(event) => setText(event.currentTarget.value)}
    ></textarea>
    <div class="ss-map__bar">
      <span class=${error ? 'ss-map-text__error' : ''}>
        ${
          error ||
          (kind === 'json'
            ? t('nodes 是节点（parent 指向父节点），edges 是节点之间的连线。')
            : t('每行一个节点，缩进两格是下一级；（进行中）这样的括号写进展。'))
        }
      </span>
      <span class="ss-titlebar__spacer"></span>
      <button
        type="button"
        class="ss-btn ss-btn--ghost ss-btn--sm"
        disabled=${text === source}
        onClick=${() => setText(source)}
      >
        ${t('放弃修改')}
      </button>
      <button
        type="button"
        class="ss-btn ss-btn--primary ss-btn--sm"
        disabled=${text === source}
        onClick=${apply}
      >
        ${t('保存')}
      </button>
    </div>
  </div>`;
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
  const [tab, setTab] = useState('map');
  const [panel, setPanel] = useState(true);
  const [linking, setLinking] = useState(/** @type {any} */ (null));
  const undoIds = useRef(/** @type {string[]} */ ([]));
  const redoIds = useRef(/** @type {string[]} */ ([]));
  const [, refreshHistory] = useState(0);
  const draftRef = useRef({ dirty: false, text: '', id: null });
  const edits = useRef(Promise.resolve());
  const textarea = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  useSnapshotCapture([['map', projectId]], () => commit());
  const nodes = map?.nodes ?? [];
  const edges = map?.edges ?? [];
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
  const focusText = () =>
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.select();
    });
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
    setPanel(true);
    focusText();
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
    if (result) {
      setSelected(result.value.nodes.at(-1).id);
      setPanel(true);
      focusText();
    }
  };
  const remove = async (target) => {
    await commit();
    await edit('removeNode', { id: target.id });
    setSelected(target.parent ?? null);
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
  const move = (target, step) => {
    const siblings = nodes.filter((n) => n.parent === target.parent);
    const position = siblings.findIndex((n) => n.id === target.id);
    const other = siblings[position + step];
    if (!other) return;
    const list = nodes.slice();
    const a = list.findIndex((n) => n.id === target.id);
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
  const back = async () => {
    await commit();
    navigate({ view: 'workbench', id: projectId });
  };
  useEffect(() => {
    const key = (event) => {
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        void back();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [projectId]);

  const nodeItems = (target) => [
    { text: t('添加子节点'), icon: 'plus', key: 'Tab', run: () => add(target.id) },
    {
      text: t('添加同级'),
      icon: 'plus',
      key: 'Enter',
      run: () => add(target.parent ?? null, target.id),
    },
    {
      text: t('连到另一个节点…'),
      icon: 'spline',
      disabled: nodes.length < 2,
      run: () => setLinking(target),
    },
    {
      text: t('编辑'),
      icon: 'pencil',
      key: 'F2',
      run: () => {
        setSelected(target.id);
        setPanel(true);
        focusText();
      },
    },
    { text: t('上移'), icon: 'chevron-up', run: () => move(target, -1) },
    { text: t('下移'), icon: 'chevron-down', run: () => move(target, 1) },
    { sep: true },
    { text: t('删除'), icon: 'trash-2', key: 'Del', danger: true, run: () => remove(target) },
  ];
  const nodeMenu = async (event, target) => {
    event.preventDefault();
    await commit();
    setSelected(target.id);
    actions.openMenu(event, nodeItems(target), nodeTitle(target.text));
  };
  /** Tab, Enter, F2 and Delete on the selected card. @param {KeyboardEvent} event */
  const onKey = (event) => {
    if (!node || !(/** @type {HTMLElement} */ (event.target).closest('.ss-mnode'))) return;
    const run = {
      Tab: () => add(node.id),
      Enter: () => add(node.parent ?? null, node.id),
      F2: () => {
        setPanel(true);
        focusText();
      },
      Delete: () => remove(node),
    }[event.key];
    if (!run || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    void run();
  };
  const exportMenu = (event) =>
    actions.openMenu(
      event,
      [
        {
          text: t('Markdown 大纲'),
          icon: 'file-text',
          run: () => save(`${project?.name ?? 'map'}.md`, outline(nodes), 'text/markdown'),
        },
        {
          text: t('可编辑 JSON'),
          icon: 'file-code',
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

  const children = node ? nodes.filter((entry) => entry.parent === node.id) : [];
  const nodeLinks = node
    ? edges.filter((edge) => edge.from === node.id || edge.to === node.id)
    : [];
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  const pathOf = (entry) => {
    const names = [];
    for (let current = entry; current; current = byId.get(current.parent))
      names.unshift(nodeTitle(current.text));
    return names.join(' › ');
  };
  const kind = node?.floating ? t('游离节点') : node?.parent ? t('分支内容') : t('主干节点');

  const nodePanel =
    panel &&
    node &&
    tab === 'map' &&
    html`<aside class="ss-panel ss-map-panel" aria-label=${t('节点')}>
      <div class="ss-panel__head">
        <span class="ss-panel__title">${t('节点')}</span>
        <span class="ss-titlebar__spacer"></span>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('节点菜单')}
          aria-haspopup="menu"
          data-tip=${t('节点菜单')}
          onClick=${(event) => actions.openMenu(event, nodeItems(node), nodeTitle(node.text))}
        >
          <${Lucide} name="ellipsis" />
        </button>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('关闭节点面板')}
          data-tip=${t('关闭节点面板')}
          onClick=${() => setPanel(false)}
        >
          <${Lucide} name="x" />
        </button>
      </div>
      <div class="ss-panel__body ss-map-panel__body">
        <label class="ss-field">
          <span class="ss-field__label">${t('节点内容 · Markdown')}</span>
          <textarea
            ref=${textarea}
            class="ss-textarea"
            rows="4"
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
          <span class="ss-field__hint">
            ${t('离开输入框自动保存；Enter 新建同级，Shift Enter 换行。')}
          </span>
        </label>
        <div class="ss-field">
          <span class="ss-field__label">${t('进展')}</span>
          <${ChoiceMenu}
            label=${t('进展')}
            triggerClass="ss-select ss-select--sm"
            placement="bottom-start"
            items=${[
              {
                text: t('不标'),
                selected: !node.status,
                run: () => edit('updateNode', { id: node.id, changes: { status: '' } }),
              },
              ...STATUSES.map((status) => ({
                text: t(status),
                selected: node.status === status,
                run: () => edit('updateNode', { id: node.id, changes: { status } }),
              })),
            ]}
          >
            <span class="ss-select__value">${node.status ? t(node.status) : t('不标')}</span>
          <//>
        </div>
        <section class="ss-map-panel__group" aria-label=${t('分支')}>
          <div class="ss-block-head">
            <span class="ss-block-head__title">${t('分支')}</span>
            <span class="ss-count">${children.length}</span>
            <span class="ss-block-head__end">
              <button
                type="button"
                class="ss-icon-btn ss-icon-btn--sm"
                aria-label=${t('添加子节点')}
                data-tip=${t('添加子节点')}
                onClick=${() => add(node.id)}
              >
                <${Lucide} name="plus" />
              </button>
            </span>
          </div>
          ${children.map(
            (child) =>
              html`<button
                type="button"
                key=${child.id}
                class="ss-map-panel__row"
                onClick=${async () => {
                  await commit();
                  setSelected(child.id);
                }}
              >
                <${Lucide} name="list-tree" />
                <span class="ss-truncate">${nodeTitle(child.text)}</span>
              </button>`,
          )}
        </section>
        <section class="ss-map-panel__group" aria-label=${t('连线')}>
          <div class="ss-block-head">
            <span class="ss-block-head__title">${t('连线')}</span>
            <span class="ss-count">${nodeLinks.length}</span>
            <span class="ss-block-head__end">
              <button
                type="button"
                class="ss-icon-btn ss-icon-btn--sm"
                aria-label=${t('添加连线')}
                data-tip=${t('添加连线')}
                disabled=${nodes.length < 2}
                onClick=${() => setLinking(node)}
              >
                <${Lucide} name="plus" />
              </button>
            </span>
          </div>
          ${nodeLinks.map((edge) => {
            const other = byId.get(edge.from === node.id ? edge.to : edge.from);
            return html`<div key=${edge.id} class="ss-map-panel__row" data-link-row>
              <${Lucide} name="spline" />
              <span class="ss-map-panel__link">
                <span class="ss-truncate">
                  ${edge.directed ? (edge.from === node.id ? '→ ' : '← ') : ''}${nodeTitle(
                    other?.text ?? '',
                  )}
                </span>
                <small class="ss-truncate">${other ? pathOf(other) : ''}</small>
              </span>
              <button
                type="button"
                class="ss-icon-btn ss-icon-btn--sm"
                aria-label=${t('移除连线')}
                data-tip=${t('移除连线')}
                onClick=${() => edit('removeEdge', { id: edge.id })}
              >
                <${Lucide} name="x" />
              </button>
            </div>`;
          })}
        </section>
        <dl class="ss-props">
          <dt>${t('位置')}</dt>
          <dd>${pathOf(node)}</dd>
          <dt>${t('类型')}</dt>
          <dd>${kind}</dd>
        </dl>
      </div>
      <div class="ss-panel__foot">
        <button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm ss-btn--danger-text"
          onClick=${() => remove(node)}
        >
          <${Lucide} name="trash-2" />${t('删除节点')}
        </button>
      </div>
    </aside>`;

  return html`<main class="ss-main map-page">
      <div class="ss-header">
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('返回工作站')}
          data-tip=${t('返回工作站')}
          data-kbd="Alt ←"
          onClick=${back}
        >
          <${Lucide} name="arrow-left" />
        </button>
        <div class="ss-header__title"><span>${t('研究框架与进展')}</span></div>
        <span class="ss-header__sep"></span>
        <nav class="ss-tabs" role="tablist" aria-label=${t('导图视图')}>
          ${TABS.map(
            ([key, label]) =>
              html`<button
                type="button"
                key=${key}
                class="ss-tab"
                role="tab"
                aria-selected=${String(tab === key)}
                onClick=${async () => {
                  await commit();
                  setTab(key);
                }}
              >
                ${t(label)}
              </button>`,
          )}
        </nav>
        <div class="ss-header__actions">
          <button
            type="button"
            class="ss-icon-btn"
            aria-label=${t('历史版本')}
            data-tip=${t('历史版本')}
            onClick=${() => openResourceHistory(actions, { resource: 'map', key: projectId })}
          >
            <${Lucide} name="history" />
          </button>
          <button
            type="button"
            class="ss-icon-btn"
            aria-label=${t('导出')}
            aria-haspopup="menu"
            data-tip=${t('导出')}
            onClick=${exportMenu}
          >
            <${Lucide} name="download" />
          </button>
          <button
            type="button"
            class="ss-btn ss-btn--ghost"
            data-tip=${t('在画布空白处放一个不挂在树上的节点')}
            onClick=${addFloating}
          >
            ${t('游离节点')}
          </button>
          <button type="button" class="ss-btn" onClick=${() => (node ? add(node.id) : add(null))}>
            <${Lucide} name="plus" />${t('新增分支')}
          </button>
        </div>
      </div>
      ${
        !map
          ? html`<div class="ss-map"></div>`
          : tab === 'map'
            ? html`<${MapCanvas}
                nodes=${nodes}
                edges=${edges}
                editing
                selected=${node?.id}
                onSelect=${async (id) => {
                  await commit();
                  setSelected(id);
                  setPanel(true);
                }}
                onEditNode=${(target) => {
                  setSelected(target.id);
                  setPanel(true);
                  focusText();
                }}
                onNodeMenu=${nodeMenu}
                onKey=${onKey}
                onAddChild=${(parent) => add(parent)}
                onMoveNode=${async (id, position) => {
                  await commit();
                  await edit('updateNode', { id, changes: position });
                }}
                onDropText=${appendText}
                onPasteText=${appendText}
                bar=${html`<span class="ss-map__sep"></span>
                  <button
                    type="button"
                    class="ss-icon-btn ss-icon-btn--sm"
                    aria-label=${t('撤销')}
                    data-tip=${t('撤销')}
                    disabled=${!undoIds.current.length && !dirty}
                    onClick=${undo}
                  >
                    <${Lucide} name="undo-2" />
                  </button>
                  <button
                    type="button"
                    class="ss-icon-btn ss-icon-btn--sm"
                    aria-label=${t('重做')}
                    data-tip=${t('重做')}
                    disabled=${!redoIds.current.length}
                    onClick=${redoLast}
                  >
                    <${Lucide} name="redo-2" />
                  </button>`}
                barEnd=${html`<span class="ss-map__saved" role="status">
                  <span class=${`ss-dot ${dirty ? '' : 'ss-dot--ok'}`}></span>
                  ${dirty ? t('有未保存的修改') : t('已保存')}
                </span>`}
              />`
            : html`<${TextView}
                key=${tab}
                kind=${tab}
                map=${map}
                onApply=${(next) => edit('write', { map: next })}
              />`
      }
    </main>
    ${nodePanel}
    ${
      linking &&
      html`<${LinkDialog}
        from=${linking}
        nodes=${nodes}
        onClose=${() => setLinking(null)}
        onAdd=${(to, directed) => {
          setLinking(null);
          void edit('addEdge', { edge: { from: linking.id, to, directed } });
        }}
      />`
    }`;
}
