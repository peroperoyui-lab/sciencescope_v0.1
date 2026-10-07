// The research map canvas (`.mapviewport` + `.mapfoot`), shared by the
// workbench preview and the map editor: the prototype's layout, drag to pan,
// zoom buttons, fit, and +/− to open or close a branch.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { fitView, layoutMap, mapConnections } from '../map-layout.js';
import { renderMarkdown } from '../markdown.js';

/**
 * @param {{ nodes: any[], editing?: boolean, readonly?:boolean, selected?: string | null,
 *   onSelect?: (id: string) => void, onAddChild?: (parentId: string | null) => void,
 *   onEditNode?: (node: any) => void, onNodeMenu?: (event: Event, node: any) => void }} props
 */
export function MapCanvas({
  nodes,
  editing = false,
  readonly = false,
  selected,
  onSelect,
  onAddChild,
  onEditNode,
  onNodeMenu,
}) {
  const [collapsed, setCollapsed] = useState(/** @type {Record<string, boolean>} */ ({}));
  const [view, setView] = useState({ x: 18, y: 18, scale: 1 });
  const viewport = useRef(null);
  const drag = useRef(null);
  const fitted = useRef(false);
  const positions = layoutMap(nodes, collapsed);

  const fit = () => {
    const { clientWidth, clientHeight } = viewport.current;
    setView(fitView(positions, clientWidth, clientHeight));
  };
  useLayoutEffect(() => {
    if (fitted.current || !nodes.length || !viewport.current) return;
    fitted.current = true;
    fit();
  }, [nodes.length]);
  const zoom = (factor) =>
    setView({ ...view, scale: Math.min(2, Math.max(0.2, view.scale * factor)) });

  return html`<div
      class="mapviewport"
      data-edit=${String(editing)}
      ref=${viewport}
      onPointerDown=${(event) => {
        // Panning starts on the empty canvas only; nodes and buttons keep their clicks.
        if (event.target.closest('.mapnode, button')) return;
        drag.current = { x: event.clientX - view.x, y: event.clientY - view.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove=${(event) => {
        if (!drag.current) return;
        setView({ ...view, x: event.clientX - drag.current.x, y: event.clientY - drag.current.y });
      }}
      onPointerUp=${() => {
        drag.current = null;
      }}
      onWheel=${(event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1);
      }}
    >
      ${!editing && html`<span class="readbadge">${readonly ? t('只读预览') : t('缩放 / 拖动 / 展开 · 右键编辑')}</span>`}
      <div
        class="mapscene"
        style=${{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <svg class="connections">
          <g fill="none" stroke="#9bac8f" stroke-width="1.5">
            ${mapConnections(positions).map((d, index) => html`<path key=${index} d=${d} />`)}
          </g>
        </svg>
        ${positions.map((p) => {
          const hasChildren = nodes.some((node) => node.parent === p.node.id);
          const open = hasChildren && !collapsed[p.node.id];
          return html`<div
            key=${p.node.id}
            class=${`mapnode ${p.root ? 'root' : 'secondary'} ${selected === p.node.id ? 'selected' : ''}`}
            style=${{ left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, minHeight: `${p.h}px` }}
            tabindex="0"
            data-node=${p.node.id}
            onClick=${() => onSelect?.(p.node.id)}
            onDblClick=${() => onEditNode?.(p.node)}
            onContextMenu=${(event) => onNodeMenu?.(event, p.node)}
          >
            <div
              class="nodetext"
              dangerouslySetInnerHTML=${{ __html: renderMarkdown(p.node.text) }}
            ></div>
            ${p.root && p.node.status && html`<span class="nodestatus">${p.node.status}</span>`}
            ${p.node.addedBy === 'agent_secretary' && html`<small class="wb-secretary-origin">${t('秘书添加')}</small>`}
            ${
              (!readonly || hasChildren) &&
              html`<button
                class="nodeplus"
                aria-label=${open ? t('收起分支') : hasChildren ? t('展开分支') : t('新增分支')}
                onClick=${(event) => {
                  event.stopPropagation();
                  if (hasChildren) setCollapsed({ ...collapsed, [p.node.id]: open });
                  else onAddChild?.(p.node.id);
                }}
              >
                ${open ? '−' : '+'}
              </button>`
            }
          </div>`;
        })}
      </div>
      ${
        !nodes.length &&
        !readonly &&
        html`<div
          class="inline-empty"
          style="position:absolute;inset:auto 0 45% 0;text-align:center"
        >
          <button class="btn tiny" onClick=${() => onAddChild?.(null)}>
            + ${t('添加第一个节点')}
          </button>
        </div>`
      }
    </div>
    <div class="mapfoot">
      <button class="iconbtn" title=${t('适应画布')} aria-label=${t('适应画布')} onClick=${fit}>
        <${Icon} name="search" />
      </button>
      <span class="spacer"></span>
      <button aria-label=${t('缩小')} onClick=${() => zoom(1 / 1.15)}>−</button>
      <span>${Math.round(view.scale * 100)}%</span>
      <button aria-label=${t('放大')} onClick=${() => zoom(1.15)}>+</button>
      <button onClick=${fit}>${t('适应')}</button>
    </div>`;
}
