// The research map canvas (design system PageMap, ss-map): node cards on a
// dotted ground, tree links as curves and 连线 as dashed accent curves. Wheel
// zooms around the pointer, dragging the ground pans, a branch folds into its
// child count. Shared by the map page (`editing`), the workbench preview
// (`preview`: a click opens the node on the map page) and history previews
// (`readonly`).
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { fitView, layoutMap, mapConnections, mapEdges } from '../map-layout.js';

/** A node's card title: the first line of its Markdown, without the marks. @param {string} text */
export function nodeTitle(text) {
  const line = (text ?? '').split('\n').find((entry) => entry.trim()) ?? '';
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#+|>|[-*+])\s+/, '')
    .replace(/[*_`]+/g, '')
    .trim();
}

/** The second line of a card. @param {{ node: any }} props */
function NodeMeta({ node }) {
  if (node.addedBy === 'agent_secretary')
    return html`<span class="ss-mnode__meta"
      ><${Lucide} name="sparkle" small />${t('秘书添加')}</span
    >`;
  if (node.status)
    return html`<span class="ss-mnode__meta"
      ><span class=${`ss-dot ${node.status === '已完成' ? 'ss-dot--ok' : ''}`}></span>${t(
        node.status,
      )}</span
    >`;
  if (node.attachments?.length)
    return html`<span class="ss-mnode__meta"
      ><${Lucide} name="paperclip" small />${t('{n} 个附件', { n: node.attachments.length })}</span
    >`;
  if (node.floating) return html`<span class="ss-mnode__meta">${t('游离节点')}</span>`;
  return null;
}

/**
 * @param {{ nodes: any[], edges?: any[], editing?: boolean, readonly?: boolean, preview?: boolean,
 *   selected?: string | null, onSelect?: (id: string) => void, onOpen?: (node: any) => void,
 *   onAddChild?: (parentId: string | null) => void, onEditNode?: (node: any) => void,
 *   onNodeMenu?: (event: Event, node: any) => void, onKey?: (event: KeyboardEvent) => void,
 *   onMoveNode?: (id: string, position: { x: number, y: number }) => void,
 *   onDropText?: (id: string, transfer: DataTransfer) => void,
 *   onPasteText?: (id: string, transfer: DataTransfer) => void, bar?: any, barEnd?: any }} props
 * `bar` and `barEnd` go in the bottom bar after the zoom buttons and at its end;
 * without them there is no bar.
 */
export function MapCanvas({
  nodes,
  edges = [],
  editing = false,
  readonly = false,
  preview = false,
  selected,
  onSelect,
  onOpen,
  onAddChild,
  onEditNode,
  onNodeMenu,
  onKey,
  onMoveNode,
  onDropText,
  onPasteText,
  bar,
  barEnd,
}) {
  const [collapsed, setCollapsed] = useState(/** @type {Record<string, boolean>} */ ({}));
  const [view, setView] = useState({ x: 18, y: 18, scale: 1 });
  const viewport = useRef(/** @type {HTMLDivElement | null} */ (null));
  const drag = useRef(/** @type {any} */ (null));
  const fitted = useRef(false);
  const nodeDrag = useRef(/** @type {any} */ (null));
  const [moving, setMoving] = useState(/** @type {any} */ (null));
  const [dropTarget, setDropTarget] = useState(/** @type {string | null} */ (null));
  const markerId = useRef(`map-arrow-${Math.random().toString(36).slice(2)}`);
  const positions = layoutMap(
    nodes.map((node) => (moving?.id === node.id ? { ...node, x: moving.x, y: moving.y } : node)),
    collapsed,
  );
  const links = mapEdges(positions, edges);
  const childCount = (id) => nodes.filter((node) => node.parent === id).length;

  const fit = () => {
    if (!viewport.current) return;
    const { clientWidth, clientHeight } = viewport.current;
    setView(fitView(positions, clientWidth, clientHeight));
  };
  useLayoutEffect(() => {
    if (fitted.current || !nodes.length || !viewport.current) return;
    fitted.current = true;
    fit();
  }, [nodes.length]);
  /** Zoom by `factor`, keeping the point (`cx`, `cy`) of the viewport still. */
  const zoom = (factor, cx, cy) =>
    setView((current) => {
      const scale = Math.min(2, Math.max(0.2, current.scale * factor));
      const box = viewport.current;
      const px = cx ?? (box ? box.clientWidth / 2 : 0);
      const py = cy ?? (box ? box.clientHeight / 2 : 0);
      const ratio = scale / current.scale;
      return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
    });
  const hint = editing
    ? t('滚轮缩放 · 拖动画布 · 右键节点编辑')
    : preview
      ? t('滚轮缩放 · 点节点在导图里打开')
      : '';

  const canvas = html`<div
    class=${`ss-map ${preview ? 'ss-map--preview' : ''}`}
    ref=${viewport}
    role="tree"
    aria-label=${t('研究导图')}
    data-edit=${String(editing)}
    onKeyDown=${(event) => onKey?.(event)}
    onPointerDown=${(event) => {
      // Panning starts on the ground only; nodes and buttons keep their clicks.
      if (event.target.closest('.ss-mnode, button')) return;
      drag.current = { x: event.clientX - view.x, y: event.clientY - view.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove=${(event) => {
      if (nodeDrag.current) {
        const current = nodeDrag.current;
        const x = current.x + (event.clientX - current.startX) / view.scale;
        const y = current.y + (event.clientY - current.startY) / view.scale;
        current.moved =
          Math.abs(event.clientX - current.startX) + Math.abs(event.clientY - current.startY) > 4;
        current.position = { x, y };
        setMoving({ id: current.id, x, y });
        return;
      }
      if (!drag.current) return;
      setView({ ...view, x: event.clientX - drag.current.x, y: event.clientY - drag.current.y });
    }}
    onPointerUp=${() => {
      const current = nodeDrag.current;
      nodeDrag.current = null;
      setMoving(null);
      if (current?.moved) onMoveNode?.(current.id, current.position);
      drag.current = null;
    }}
    onPointerCancel=${() => {
      nodeDrag.current = null;
      setMoving(null);
      drag.current = null;
    }}
    onWheel=${(event) => {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - box.left, event.clientY - box.top);
    }}
  >
    ${hint && html`<span class="ss-map__hint">${hint}</span>`}
    <div
      class="ss-map__scene"
      style=${{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
    >
      <svg class="ss-map__links" width="1" height="1" aria-hidden="true">
        <defs>
          <marker
            id=${markerId.current}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0 0 L8 4 L0 8" />
          </marker>
        </defs>
        ${mapConnections(positions).map((d, index) => html`<path key=${index} d=${d} />`)}
        ${links.map(
          (edge) =>
            html`<path
              key=${edge.id}
              data-link
              data-edge=${edge.id}
              d=${edge.path}
              marker-end=${edge.directed ? `url(#${markerId.current})` : undefined}
            />`,
        )}
      </svg>
      ${positions.map((p) => {
        const count = childCount(p.node.id);
        const folded = count > 0 && collapsed[p.node.id];
        const title = nodeTitle(p.node.text) || t('（空节点）');
        return html`<div
          key=${p.node.id}
          class=${`ss-mnode ${p.root ? 'ss-mnode--root' : ''} ${p.node.floating ? 'ss-mnode--loose' : ''}`}
          style=${{ left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px` }}
          role="treeitem"
          tabindex=${readonly ? undefined : selected === p.node.id ? '0' : '-1'}
          aria-label=${title}
          aria-selected=${String(selected === p.node.id)}
          aria-expanded=${count ? String(!folded) : undefined}
          data-node=${p.node.id}
          data-floating=${String(Boolean(p.node.floating))}
          data-drop=${editing ? 'map' : undefined}
          data-dragover=${dropTarget === p.node.id ? '' : undefined}
          title=${p.node.text}
          onPointerDown=${(event) => {
            if (
              !editing ||
              !p.node.floating ||
              event.button !== 0 ||
              event.target.closest('button')
            )
              return;
            event.stopPropagation();
            event.preventDefault();
            onSelect?.(p.node.id);
            nodeDrag.current = {
              id: p.node.id,
              x: p.x,
              y: p.y,
              startX: event.clientX,
              startY: event.clientY,
              moved: false,
              position: { x: p.x, y: p.y },
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onDragOver=${(event) => {
            if (editing && onDropText) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setDropTarget(p.node.id);
            }
          }}
          onDragLeave=${() => setDropTarget(null)}
          onDrop=${(event) => {
            if (editing && onDropText) {
              event.preventDefault();
              event.stopPropagation();
              setDropTarget(null);
              onDropText(p.node.id, event.dataTransfer);
            }
          }}
          onPaste=${(event) => {
            if (editing && onPasteText) {
              event.preventDefault();
              event.stopPropagation();
              onPasteText(p.node.id, event.clipboardData);
            }
          }}
          onClick=${() => (preview ? onOpen?.(p.node) : onSelect?.(p.node.id))}
          onDblClick=${() => onEditNode?.(p.node)}
          onContextMenu=${(event) => onNodeMenu?.(event, p.node)}
        >
          <span class="ss-mnode__title">${title}</span>
          <${NodeMeta} node=${p.node} />
          ${
            count > 0 &&
            html`<button
              type="button"
              class="ss-mnode__fold"
              data-open=${folded ? undefined : ''}
              aria-label=${folded ? t('展开分支') : t('收起分支')}
              data-tip=${folded ? t('展开 {n} 个子节点', { n: count }) : t('收起分支')}
              onClick=${(event) => {
                event.stopPropagation();
                setCollapsed({ ...collapsed, [p.node.id]: !folded });
              }}
            >
              ${folded ? count : '−'}
            </button>`
          }
        </div>`;
      })}
    </div>
    ${
      !nodes.length &&
      html`<div class="ss-map__empty">
        ${
          editing
            ? html`<button
                type="button"
                class="ss-btn ss-btn--sm"
                onClick=${() => onAddChild?.(null)}
              >
                <${Lucide} name="plus" />${t('添加第一个节点')}
              </button>`
            : html`<span>${t('导图还没有节点。')}</span>`
        }
      </div>`
    }
  </div>`;
  if (!bar && !barEnd) return canvas;
  return html`${canvas}
    <div class="ss-map__bar">
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('缩小')}
        data-tip=${t('缩小')}
        onClick=${() => zoom(1 / 1.15)}
      >
        <${Lucide} name="zoom-out" />
      </button>
      <span class="ss-map__zoom">${Math.round(view.scale * 100)}%</span>
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('放大')}
        data-tip=${t('放大')}
        onClick=${() => zoom(1.15)}
      >
        <${Lucide} name="zoom-in" />
      </button>
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('适应画布')}
        data-tip=${t('适应画布')}
        onClick=${fit}
      >
        <${Lucide} name="scan" />
      </button>
      ${bar}
      <span class="ss-titlebar__spacer"></span>
      ${barEnd}
    </div>`;
}
