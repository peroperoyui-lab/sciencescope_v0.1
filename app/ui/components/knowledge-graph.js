// The knowledge base as a graph (design system PageKnowledgeGraph). The canvas
// (knowledge-map.js) draws the host's stored layout and loads what is in view;
// this component adds the floating controls, the centre node and its depth,
// filters, menus, drag-to-connect with the relation picker, merging, and page
// undo: every edit here joins one knowledge session, closed when the page goes.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { place } from '../floating.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { KIND_GROUPS, createKnowledgeMap, displayKind } from '../knowledge-map.js';
import { Dialog } from './dialog.js';
import { moveFocus, usePopover } from './popover.js';
import { relationKeys, relationLabel, splitRef } from './knowledge-fields.js';
import { addedBy } from './research-list.js';

// Edges of the centre's neighbourhood fetched at once; the rest stay as dots.
const NEIGHBOURHOOD = 400;
const LAYERS = [
  ['curated', '手动添加'],
  ['extracted', '从原文整理'],
  ['derived', '自动线索（引用、相似）'],
];
// Written by the host (citations, similarity, folders), never by hand.
const SYSTEM_RELATIONS = new Set(['cites', 'similar-to', 'in-folder']);
const COMMON_RELATIONS = ['implements', 'uses', 'variant-of', 'part-of', 'supports', 'contradicts'];
const PICKER_RELATIONS = [
  ...COMMON_RELATIONS,
  ...relationKeys.filter((key) => !COMMON_RELATIONS.includes(key) && !SYSTEM_RELATIONS.has(key)),
];
const LEGEND_TIP =
  '实线是手动添加的关系；带圆点的实线是从原文整理出来的，带页码证据；虚线是自动线索（引用、相似），只作参考。AI 添加且没人改过的关系带 AI 标记。拖动节点会把它钉在那里；按住 Shift 点选可以选中多个实体再合并。';

const noFilters = { kinds: null, layers: null, aiOnly: false };
/** A context-menu event at a canvas point, for actions.openMenu. @returns {any} */
const pointEvent = (host, point) => ({
  type: 'contextmenu',
  clientX: point.x,
  clientY: point.y,
  currentTarget: host,
  preventDefault() {},
  stopPropagation() {},
});
const typing = (target) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * @param {{
 *   selection: {type:string,id:string,title?:string}|null,
 *   onSelect: (selection: {type:string,id:string,title?:string}|null) => void,
 *   onStatus: (text: string) => void,
 *   query: string,
 *   searchNonce: number,
 * }} props
 */
export function KnowledgeGraph({ selection, onSelect, onStatus, query, searchNonce }) {
  const actions = useActions();
  const version = useAppState((state) => state.researchVersion);
  const layoutVersion = useAppState((state) => state.layoutVersion);
  const host = useRef(/** @type {HTMLElement|null} */ (null));
  const graph = useRef(/** @type {HTMLElement|null} */ (null));
  const mapRef = useRef(/** @type {ReturnType<typeof createKnowledgeMap>|null} */ (null));
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  const [meta, setMeta] = useState(
    /** @type {{nodes:number,edges:number,pending:number}|null} */ (null),
  );
  const placed = useRef(false);
  const [center, setCenter] = useState(
    /** @type {{ref:string,name:string,kind:string}|null} */ (null),
  );
  const [depth, setDepth] = useState(1);
  const [around, setAround] = useState(/** @type {{count:number,remaining:number}|null} */ (null));
  const fitNext = useRef(false);
  const [filters, setFilters] = useState(noFilters);
  const [extra, setExtra] = useState(/** @type {string[]} */ ([]));
  const fromMap = useRef(false);
  const [connectFrom, setConnectFrom] = useState(/** @type {string|null} */ (null));
  const [picker, setPicker] = useState(
    /** @type {{from:string,to:string,point:{x:number,y:number}}|null} */ (null),
  );
  const [hover, setHover] = useState(
    /** @type {{edge:any,point:{x:number,y:number}}|null} */ (null),
  );
  const [hoverDetail, setHoverDetail] = useState(/** @type {any} */ (null));
  const hoverCache = useRef(new Map());
  const [merge, setMerge] = useState(
    /** @type {{into:string,from:string[],intoName:string,fromName:string,count:number}|null} */ (
      null
    ),
  );
  const [relayout, setRelayout] = useState(false);
  const [handle, setHandle] = useState(/** @type {{x:number,y:number}|null} */ (null));
  const session = useRef(/** @type {Promise<string>|null} */ (null));
  const [steps, setSteps] = useState({ canUndo: false, canRedo: false });
  const selectedRef = selection ? `${selection.type}:${selection.id}` : null;
  const handlers = useRef(/** @type {any} */ ({}));

  // ---- The canvas ----------------------------------------------------------
  useEffect(() => {
    let map = null;
    let cancelled = false;
    import('cytoscape')
      .then(({ default: cytoscape }) => {
        if (cancelled || !host.current) return;
        map = createKnowledgeMap(cytoscape, host.current, {
          load: (refs) => actions.knowledgeViewport(refs, null),
          onSelect: (...args) => handlers.current.select(...args),
          onCenter: (ref) => handlers.current.center(ref),
          onMenu: (ref, point) => handlers.current.menu(ref, point),
          onEdgeMenu: (edge, point) => handlers.current.edgeMenu(edge, point),
          onHover: (edge, point) => setHover(edge ? { edge, point } : null),
          onMove: (ref, x, y) =>
            actions
              .saveKnowledgePositions([{ ref, x, y, pinned: true }])
              .catch((caught) => actions.toast(caught.message)),
          onConnect: (from, to, point) => setPicker({ from, to, point }),
          onLoaded: () => handlers.current.loaded(),
        });
        mapRef.current = map;
        // Browser tests read the canvas through the element.
        Object.assign(host.current, { knowledgeMap: map });
        let frame = 0;
        map.cy.on('viewport position add remove', () => {
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            handlers.current.loaded();
          });
        });
        setReady(true);
      })
      .catch((caught) => setFailure(caught.message));
    return () => {
      cancelled = true;
      map?.destroy();
      mapRef.current = null;
    };
  }, []);

  // The layout index: every node's place. Edits and host layouts refresh it.
  useEffect(() => {
    if (!ready) return undefined;
    let current = true;
    const timer = setTimeout(
      () =>
        actions
          .knowledgeLayout(null)
          .then((result) => {
            const map = mapRef.current;
            if (!current || !map) return;
            map.setIndex(result.nodes);
            if (!placed.current && result.nodes.length) {
              placed.current = true;
              if (result.nodes.length <= 80) map.fit(undefined, false);
              else map.look(map.hub().ref, 1, false);
            }
            setMeta({ nodes: map.size, edges: map.edgeCount, pending: result.pending });
            setFailure('');
          })
          .catch((caught) => current && setFailure(caught.message)),
      placed.current ? 250 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [ready, version, layoutVersion]);

  useEffect(() => {
    if (!meta) return;
    onStatus(
      t('{nodes} 个节点 · {edges} 条关系', {
        nodes: meta.nodes.toLocaleString(),
        edges: meta.edges.toLocaleString(),
      }) + (meta.pending ? t('，{n} 个正在排布', { n: meta.pending.toLocaleString() }) : ''),
    );
  }, [meta]);
  useEffect(() => () => onStatus(''), []);

  // ---- Centre and depth ----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (!center) {
      map.setCenter(null);
      setAround(null);
      return undefined;
    }
    let current = true;
    actions
      .knowledgeGraph({ ref: center.ref, depth, limit: NEIGHBOURHOOD })
      .then((result) => {
        if (!current) return;
        const refs = result.nodes.map((node) => node.ref);
        map.setCenter(center.ref, refs);
        setAround({ count: Math.max(0, refs.length - 1), remaining: result.remaining ?? 0 });
        if (fitNext.current) {
          fitNext.current = false;
          map.fit(refs.filter((ref) => map.has(ref)));
        }
      })
      .catch((caught) => {
        if (!current) return;
        actions.toast(caught.message);
        setCenter(null);
      });
    return () => {
      current = false;
    };
  }, [ready, center?.ref, depth, version]);

  function focusCenter(ref) {
    const map = mapRef.current;
    if (!map) return;
    if (!map.has(ref)) {
      actions.toast(t('这个节点不在知识库的图里'));
      return;
    }
    const element = map.cy.getElementById(ref);
    const node = map.node(ref);
    fitNext.current = true;
    setCenter({
      ref,
      name: element.nonempty() ? element.data('label') : (selection?.title ?? ''),
      kind: displayKind(ref, node.kind),
    });
  }

  // The toolbar search finds a node and makes it the centre.
  useEffect(() => {
    if (!ready || !query.trim()) return undefined;
    let current = true;
    actions
      .knowledgeGraph({ query: query.trim(), depth: 0, limit: 1 })
      .then((result) => {
        if (!current) return;
        const found = result.nodes[0];
        if (!found) actions.toast(t('没有找到「{q}」', { q: query.trim() }));
        else if (!mapRef.current?.has(found.ref)) actions.toast(t('这个节点不在知识库的图里'));
        else {
          fitNext.current = true;
          setCenter({ ref: found.ref, name: found.name, kind: displayKind(found.ref, found.kind) });
          fromMap.current = true;
          onSelect({ ...splitRef(found.ref), title: found.name });
        }
      })
      .catch((caught) => current && actions.toast(caught.message));
    return () => {
      current = false;
    };
  }, [ready, query, searchNonce]);

  // ---- Selection -----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.select(selectedRef ? [selectedRef, ...extra.filter((ref) => ref !== selectedRef)] : []);
  }, [ready, selectedRef, extra]);
  useEffect(() => {
    const map = mapRef.current;
    // A node chosen in the panel (a connection, a search hit) comes into view.
    if (map && selectedRef && !fromMap.current && map.has(selectedRef))
      map.look(selectedRef, Math.max(map.cy.zoom(), 0.8));
    fromMap.current = false;
  }, [ready, selectedRef]);

  // ---- Session: one history version for everything done on this page -------
  const sessionId = () => {
    session.current ??= actions.openKnowledgeSession(null).then((opened) => opened.id);
    return session.current;
  };
  useEffect(
    () => () => {
      session.current?.then((id) => actions.knowledgeSessionStep(id, 'close')).catch(() => {});
    },
    [],
  );
  async function step(kind) {
    if (!session.current) return;
    await actions.attempt(async () => {
      const result = await actions.knowledgeSessionStep(await session.current, kind);
      setSteps({ canUndo: result.canUndo, canRedo: result.canRedo });
      if (result.skipped?.length)
        actions.toast(t('有 {n} 处已在别处改过，没有动它们', { n: result.skipped.length }));
      mapRef.current?.refresh();
    });
  }
  /** @param {(sessionId:string)=>Promise<any>} work @param {string} done */
  async function edit(work, done) {
    await actions.attempt(async () => {
      await work(await sessionId());
      setSteps({ canUndo: true, canRedo: false });
      mapRef.current?.refresh();
      actions.toast(done, { label: t('撤销'), run: () => step('undo') });
    });
  }
  useEffect(() => {
    /** @param {KeyboardEvent} event */
    const key = (event) => {
      if (typing(event.target) || document.querySelector('.ss-scrim')) return;
      const mod = event.ctrlKey || event.metaKey;
      const lower = event.key.toLowerCase();
      if (mod && lower === 'z') {
        event.preventDefault();
        void step(event.shiftKey ? 'redo' : 'undo');
      } else if (mod && lower === 'y') {
        event.preventDefault();
        void step('redo');
      } else if (event.key === 'Escape' && connectFrom) setConnectFrom(null);
      else if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedRef?.startsWith('entity:') &&
        graph.current?.contains(document.activeElement)
      ) {
        event.preventDefault();
        removeEntity(selectedRef);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const label = (ref) => {
    const element = mapRef.current?.cy.getElementById(ref);
    return element?.nonempty() ? element.data('label') : '';
  };
  function removeEntity(ref) {
    const name = label(ref);
    if (ref === selectedRef) onSelect(null);
    if (ref === center?.ref) setCenter(null);
    setExtra((refs) => refs.filter((other) => other !== ref));
    void edit(
      (id) => actions.removeKnowledgeEntity(splitRef(ref).id, id),
      t('已删除「{name}」', { name }),
    );
  }
  function removeEdge(edge) {
    void edit(
      (id) => actions.removeKnowledgeEdge(edge.id, id),
      t('已删除关系「{name}」', { name: relationLabel(edge.relation) }),
    );
  }
  function connect(fromRef, toRef, relation) {
    setPicker(null);
    void edit(
      (id) => actions.createKnowledgeEdge({ fromRef, toRef, relation, sessionId: id }),
      t('已添加关系「{name}」', { name: relationLabel(relation) }),
    );
  }
  async function askMerge(into, from) {
    await actions.attempt(async () => {
      const preview = await actions.knowledgeMergePreview(
        splitRef(into).id,
        from.map((ref) => splitRef(ref).id),
      );
      setMerge({
        into,
        from,
        intoName: label(into),
        fromName: from.length === 1 ? label(from[0]) : '',
        count: preview.relationCount,
      });
    });
  }
  function confirmMerge() {
    if (!merge) return;
    const { into, from, intoName } = merge;
    setMerge(null);
    setExtra([]);
    fromMap.current = true;
    onSelect({ ...splitRef(into), title: intoName });
    void edit(
      (id) =>
        actions.mergeKnowledgeEntities({
          into: splitRef(into).id,
          from: from.map((ref) => splitRef(ref).id),
          sessionId: id,
        }),
      t('已合并到「{name}」', { name: intoName }),
    );
  }

  // ---- Canvas callbacks (read the latest state) ----------------------------
  handlers.current = {
    select(ref, multi, point) {
      setHover(null);
      if (connectFrom) {
        const from = connectFrom;
        setConnectFrom(null);
        if (ref && ref !== from) setPicker({ from, to: ref, point });
        return;
      }
      if (!ref) {
        setExtra([]);
        onSelect(null);
        return;
      }
      fromMap.current = true;
      if (multi && selectedRef && ref !== selectedRef) {
        setExtra((refs) => (refs.includes(ref) ? refs.filter((r) => r !== ref) : [...refs, ref]));
        return;
      }
      setExtra([]);
      onSelect({ ...splitRef(ref), title: label(ref) });
    },
    center: (ref) => focusCenter(ref),
    menu(ref, point) {
      const map = mapRef.current;
      if (!map) return;
      const name = label(ref);
      const entity = ref.startsWith('entity:');
      const others = [selectedRef, ...extra].filter(
        (other) => other && other !== ref && other.startsWith('entity:'),
      );
      actions.openMenu(
        pointEvent(host.current, point),
        [
          { text: t('设为中心'), icon: 'locate', key: t('双击'), run: () => focusCenter(ref) },
          { text: t('从这里拉关系'), icon: 'spline', run: () => setConnectFrom(ref) },
          ...(map.node(ref)?.pinned
            ? [
                {
                  text: t('取消钉住'),
                  icon: 'pin',
                  run: () => {
                    const node = map.node(ref);
                    actions
                      .saveKnowledgePositions([{ ref, x: node.x, y: node.y, pinned: false }])
                      .then(() => {
                        node.pinned = false;
                        actions.toast(t('已取消钉住，重新排布时它会跟着移动'));
                      })
                      .catch((caught) => actions.toast(caught.message));
                  },
                },
              ]
            : []),
          ...(entity && others.length
            ? [
                {
                  text:
                    others.length === 1
                      ? t('把「{name}」合并到这里', { name: label(others[0]) })
                      : t('把选中的 {n} 个合并到这里', { n: others.length }),
                  icon: 'git-merge',
                  run: () => askMerge(ref, others),
                },
              ]
            : []),
          ...(entity
            ? [
                { sep: true },
                {
                  text: t('删除'),
                  icon: 'trash-2',
                  key: 'Del',
                  danger: true,
                  run: () => removeEntity(ref),
                },
              ]
            : []),
        ],
        name,
      );
    },
    edgeMenu(edge, point) {
      actions.openMenu(
        pointEvent(host.current, point),
        [
          edge.layer === 'derived'
            ? { text: t('自动线索会重建，不能删除'), icon: 'info', disabled: true, run() {} }
            : {
                text: t('删除这条关系'),
                icon: 'trash-2',
                danger: true,
                run: () => removeEdge(edge),
              },
        ],
        relationLabel(edge.relation),
      );
    },
    loaded() {
      const map = mapRef.current;
      const single = selectedRef && !extra.length ? selectedRef : null;
      const next = map && single && !map.connecting() ? map.handlePoint(single) : null;
      setHandle((previous) =>
        previous?.x === next?.x && previous?.y === next?.y ? previous : next,
      );
    },
  };
  useEffect(() => handlers.current.loaded(), [selectedRef, extra, ready]);

  // Hovering an edge shows who added it and its first evidence passage.
  useEffect(() => {
    setHoverDetail(null);
    const edge = hover?.edge;
    if (!edge) return undefined;
    if (hoverCache.current.has(edge.id)) {
      setHoverDetail(hoverCache.current.get(edge.id));
      return undefined;
    }
    let current = true;
    const timer = setTimeout(() => {
      actions
        .knowledgeEdgesOf(edge.source, { relations: edge.relation, limit: 200 })
        .then((result) => {
          const row = result.rows.find((candidate) => candidate.id === edge.id) ?? {};
          hoverCache.current.set(edge.id, row);
          if (current) setHoverDetail(row);
        })
        .catch(() => {});
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [hover?.edge?.id]);
  useEffect(() => hoverCache.current.clear(), [version]);

  // ---- Rendering -----------------------------------------------------------
  const box = graph.current?.getBoundingClientRect();
  const local = (point) => (box ? { x: point.x - box.left, y: point.y - box.top } : point);
  const empty = meta && meta.nodes === 0;
  return html`<div
      ref=${graph}
      class="ss-graph kb-graph"
      data-kb-graph
      data-connecting=${connectFrom ? 'true' : undefined}
      tabindex="-1"
      onContextMenu=${(event) => event.preventDefault()}
    >
      <div
        ref=${host}
        class="ss-graph__canvas kb-map"
        data-kb-map
        onPointerDown=${() => graph.current?.focus({ preventScroll: true })}
      ></div>
      ${
        handle &&
        !connectFrom &&
        html`<button
          type="button"
          class="kb-map__handle"
          style=${{ left: `${handle.x}px`, top: `${handle.y}px` }}
          aria-label=${t('拖到另一个节点建关系')}
          data-tip=${t('拖到另一个节点建关系')}
          onPointerDown=${(event) => {
            event.preventDefault();
            setHandle(null);
            mapRef.current?.startConnect(selectedRef, event.clientX, event.clientY);
          }}
        ></button>`
      }
      <div class="ss-graph__bar">
        ${
          center
            ? html`<span class="ss-graph__center" data-node-kind=${center.kind} data-kb-center
                  ><span class="ss-kind__dot"></span
                  ><span class="ss-truncate">${center.name}</span>${
                    around &&
                    html`<span class="ss-muted kb-graph__around"
                      >${t('{n} 个相连', { n: around.count })}${around.remaining > 0 ? ` · ${t('还有更多未显示')}` : ''}</span
                    >`
                  }<button
                    type="button"
                    class="ss-icon-btn ss-icon-btn--sm"
                    aria-label=${t('不再以它为中心')}
                    data-tip=${t('不再以它为中心')}
                    onClick=${() => setCenter(null)}
                  >
                    <${Lucide} name="x" /></button
                ></span>
                <div class="ss-seg ss-seg--sm ss-graph__float" role="group" aria-label=${t('深度')}>
                  ${[1, 2, 3].map(
                    (value) =>
                      html`<button
                        type="button"
                        aria-pressed=${String(depth === value)}
                        data-tip=${[t('一层关系'), t('两层关系'), t('三层关系')][value - 1]}
                        onClick=${() => {
                          fitNext.current = true;
                          setDepth(value);
                        }}
                      >
                        ${value}
                      </button>`,
                  )}
                </div>`
            : meta &&
              !empty &&
              html`<span class="ss-graph__center ss-muted kb-graph__hint"
                >${t('双击一个节点，看它周围的关系')}</span
              >`
        }
        ${
          connectFrom &&
          html`<span class="ss-graph__center kb-graph__hint" role="status"
            >${t('点另一个节点，和「{name}」建关系', { name: label(connectFrom) })}<button
              type="button"
              class="ss-icon-btn ss-icon-btn--sm"
              aria-label=${t('取消')}
              data-tip=${t('取消')}
              data-kbd="Esc"
              onClick=${() => setConnectFrom(null)}
            >
              <${Lucide} name="x" /></button
          ></span>`
        }
        <span class="ss-toolbar__spacer"></span>
        <span class="ss-graph__float kb-graph__tools">
          <button
            type="button"
            class="ss-icon-btn"
            aria-label=${t('撤销')}
            data-tip=${t('撤销')}
            data-kbd="Ctrl Z"
            disabled=${!steps.canUndo}
            onClick=${() => step('undo')}
          >
            <${Lucide} name="undo-2" />
          </button>
          <button
            type="button"
            class="ss-icon-btn"
            aria-label=${t('重做')}
            data-tip=${t('重做')}
            data-kbd="Ctrl Shift Z"
            disabled=${!steps.canRedo}
            onClick=${() => step('redo')}
          >
            <${Lucide} name="redo-2" />
          </button>
          <${GraphFilters}
            filters=${filters}
            onChange=${(next) => {
              setFilters(next);
              mapRef.current?.setFilters(next);
            }}
          />
        </span>
      </div>
      <div class="ss-graph__legend ss-graph__float">
        ${KIND_GROUPS.map(
          ([group, name]) =>
            html`<span class="ss-kind" data-node-kind=${group}
              ><span class="ss-kind__dot"></span>${t(name)}</span
            >`,
        )}
        <button type="button" class="ss-info" aria-label=${t('说明')} data-tip=${t(LEGEND_TIP)}>
          <${Lucide} name="info" />
        </button>
      </div>
      <div class="ss-graph__zoom ss-graph__float">
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('放大')}
          data-tip=${t('放大')}
          data-tip-place="left"
          onClick=${() => mapRef.current?.zoomBy(1.4)}
        >
          <${Lucide} name="zoom-in" />
        </button>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('缩小')}
          data-tip=${t('缩小')}
          data-tip-place="left"
          onClick=${() => mapRef.current?.zoomBy(1 / 1.4)}
        >
          <${Lucide} name="zoom-out" />
        </button>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('适应窗口')}
          data-tip=${t('适应窗口')}
          data-tip-place="left"
          onClick=${() => mapRef.current?.fit()}
        >
          <${Lucide} name="scan" />
        </button>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('重新排列')}
          data-tip=${t('重新排列')}
          data-tip-place="left"
          onClick=${() => setRelayout(true)}
        >
          <${Lucide} name="refresh-cw" />
        </button>
      </div>
      ${
        (failure || empty || (!meta && !failure)) &&
        html`<div class="ss-empty kb-graph__empty">
          <div class="ss-empty__icon">
            ${!meta && !failure ? html`<span class="ss-spin"></span>` : html`<${Lucide} name="waypoints" />`}
          </div>
          <div class="ss-empty__title">
            ${failure ? t('图没有加载出来') : !meta ? t('正在读取…') : meta.pending ? t('正在排布节点…') : t('知识库里还没有节点')}
          </div>
          <div class="ss-empty__text">
            ${failure || (meta && !meta.pending ? t('导入文献、整理论文或新建实体后会出现在这里。') : '')}
          </div>
        </div>`
      }
      ${
        meta &&
        meta.nodes > 0 &&
        meta.edges === 0 &&
        html`<div class="ss-graph__float kb-graph__note" role="status">
          <strong>${t('这里还没有关系')}</strong>
          <span class="ss-muted"
            >${t('论文整理完后会出现引用和方法关系；也可以从节点拖线手动添加。')}</span
          >
        </div>`
      }
      ${
        hover &&
        html`<div
          class="ss-graph__float kb-graph__hover"
          role="tooltip"
          style=${{ left: `${local(hover.point).x + 14}px`, top: `${local(hover.point).y + 14}px` }}
        >
          <div class="kb-graph__hover-title">
            ${label(hover.edge.source)}
            <span class="ss-muted">${relationLabel(hover.edge.relation)}</span>
            ${' '}${label(hover.edge.target)}${hover.edge.ai && html` <span class="ss-ai">AI</span>`}
          </div>
          <p class="ss-prov">
            ${
              hover.edge.layer === 'derived'
                ? t('自动线索，只作参考')
                : hoverDetail?.origin === 'ai' && hoverDetail.createdBy
                  ? addedBy(hoverDetail.createdBy)
                  : hover.edge.layer === 'extracted'
                    ? t('从原文整理')
                    : t('手动添加')
            }
          </p>
          ${
            hoverDetail?.evidence?.[0] &&
            html`<p class="ss-prov kb-graph__quote">
              ${hoverDetail.evidence[0].page != null ? `p.${hoverDetail.evidence[0].page} ` : ''}「${hoverDetail.evidence[0].quote ?? hoverDetail.evidence[0].excerpt ?? ''}」
            </p>`
          }
        </div>`
      }
    </div>
    ${
      picker &&
      html`<${RelationPicker}
        from=${picker.from}
        to=${picker.to}
        point=${picker.point}
        name=${label}
        onPick=${connect}
        onClose=${() => setPicker(null)}
      />`
    }
    ${
      relayout &&
      html`<${Dialog}
        title=${t('重新排列整张图？')}
        size="sm"
        onClose=${() => setRelayout(false)}
        onSubmit=${() => {
          setRelayout(false);
          actions
            .rerunKnowledgeLayout(null)
            .then(() => actions.toast(t('正在后台重新排列，排好后图会更新')))
            .catch((caught) => actions.toast(caught.message));
        }}
        foot=${html`<button type="button" class="ss-btn" onClick=${() => setRelayout(false)}>
            ${t('取消')}</button
          ><button type="submit" class="ss-btn ss-btn--primary">${t('重新排列')}</button>`}
      >
        <p>${t('没有钉住的节点都会换位置，拖动过（钉住）的节点不动。这一步不能撤销。')}</p>
      <//>`
    }
    ${
      merge &&
      html`<${Dialog}
        title=${
          merge.fromName
            ? t('把「{from}」合并到「{into}」？', { from: merge.fromName, into: merge.intoName })
            : t('把 {n} 个实体合并到「{into}」？', { n: merge.from.length, into: merge.intoName })
        }
        size="sm"
        onClose=${() => setMerge(null)}
        onSubmit=${confirmMerge}
        foot=${html`<button type="button" class="ss-btn" onClick=${() => setMerge(null)}>
            ${t('取消')}</button
          ><button type="submit" class="ss-btn ss-btn--primary">${t('合并')}</button>`}
      >
        <p>
          ${t('{n} 条关系会改挂到「{into}」，被合并的名称成为它的别名。合并后可以撤销。', {
            n: merge.count,
            into: merge.intoName,
          })}
        </p>
      <//>`
    }`;
}

/** Kinds, edge layers and AI-only, applied on the canvas immediately. */
function GraphFilters({ filters, onChange }) {
  const pop = usePopover({ placement: 'bottom-end' });
  const active = Boolean(filters.kinds || filters.layers || filters.aiOnly);
  const toggle = (key, value, all) => {
    const current = new Set(filters[key] ?? all);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    onChange({ ...filters, [key]: current.size === all.length ? null : current });
  };
  const kinds = KIND_GROUPS.map(([group]) => group);
  const layers = LAYERS.map(([layer]) => layer);
  return html`<button
      type="button"
      ref=${pop.trigger}
      class="ss-icon-btn"
      aria-label=${t('筛选')}
      aria-haspopup="dialog"
      aria-expanded=${pop.open}
      aria-pressed=${String(active)}
      data-tip=${t('筛选')}
      onClick=${pop.toggle}
    >
      <${Lucide} name="funnel" />
    </button>
    ${
      pop.open &&
      html`<div ref=${pop.layer} class="ss-pop kb-filter" role="dialog" aria-label=${t('筛选')}>
        <div class="ss-pop__body">
          <div class="ss-pop__section">
            <span class="ss-pop__label">${t('种类')}</span>
            ${KIND_GROUPS.map(
              ([group, name]) =>
                html`<label class="ss-check"
                  ><input
                    type="checkbox"
                    checked=${!filters.kinds || filters.kinds.has(group)}
                    onChange=${() => toggle('kinds', group, kinds)}
                  /><span>${t(name)}</span></label
                >`,
            )}
          </div>
          <div class="ss-pop__section">
            <span class="ss-pop__label">${t('关系的来源')}</span>
            ${LAYERS.map(
              ([layer, name]) =>
                html`<label class="ss-check"
                  ><input
                    type="checkbox"
                    checked=${!filters.layers || filters.layers.has(layer)}
                    onChange=${() => toggle('layers', layer, layers)}
                  /><span>${t(name)}</span></label
                >`,
            )}
            <label class="ss-check"
              ><input
                type="checkbox"
                checked=${filters.aiOnly}
                onChange=${(event) => onChange({ ...filters, aiOnly: event.currentTarget.checked })}
              /><span>${t('只看 AI 添加的')}</span></label
            >
          </div>
        </div>
        <div class="ss-pop__foot">
          <span class="ss-muted kb-filter__note">${t('筛选立即生效')}</span>
          <button
            type="button"
            class="ss-btn ss-btn--ghost ss-btn--sm"
            onClick=${() => onChange(noFilters)}
          >
            ${t('清除')}
          </button>
        </div>
      </div>`
    }`;
}

/**
 * The menu after a drag-to-connect: search or type a new relation, common ones
 * first, and a last item that flips the direction.
 * @param {{from:string,to:string,point:{x:number,y:number},name:(ref:string)=>string,
 *   onPick:(from:string,to:string,relation:string)=>void,onClose:()=>void}} props
 */
function RelationPicker({ from, to, point, name, onPick, onClose }) {
  const layer = useRef(/** @type {HTMLElement|null} */ (null));
  const [text, setText] = useState('');
  const [reversed, setReversed] = useState(false);
  const [source, target] = reversed ? [to, from] : [from, to];
  useLayoutEffect(() => {
    if (layer.current)
      place(
        layer.current,
        { left: point.x, right: point.x, top: point.y, bottom: point.y, width: 0, height: 0 },
        'bottom-start',
        4,
      );
  }, [point.x, point.y]);
  useEffect(() => {
    /** @param {PointerEvent} event */
    const outside = (event) => {
      if (!layer.current?.contains(/** @type {Node} */ (event.target))) onClose();
    };
    /** @param {KeyboardEvent} event */
    const key = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
    };
  }, []);
  const typed = text.trim();
  const needle = typed.toLowerCase();
  // Common relations up front; searching reaches every built-in one.
  const matches = needle
    ? PICKER_RELATIONS.filter(
        (key) => key.includes(needle) || relationLabel(key).toLowerCase().includes(needle),
      )
    : COMMON_RELATIONS;
  const exact = PICKER_RELATIONS.find(
    (key) => key === needle || relationLabel(key).toLowerCase() === needle,
  );
  const pick = (relation) => onPick(source, target, relation);
  return html`<div
    ref=${layer}
    class="ss-menu kb-picker"
    role="menu"
    aria-label=${t('关系')}
    onKeyDown=${moveFocus}
  >
    <div class="kb-picker__search">
      <span class="ss-input ss-input--sm"
        ><${Lucide} name="search" class="ss-i--sm" /><input
          autofocus
          aria-label=${t('搜索或输入新关系')}
          placeholder=${t('搜索或输入新关系')}
          value=${text}
          onInput=${(event) => setText(event.currentTarget.value)}
          onKeyDown=${(event) => {
            if (event.key !== 'Enter' || !typed) return;
            event.preventDefault();
            // Enter takes the first row: the exact relation, or the new one.
            pick(exact ?? typed);
          }}
      /></span>
    </div>
    <div class="ss-menu__label ss-truncate">${name(source)} → ${name(target)}</div>
    ${
      typed &&
      !exact &&
      html`<button type="button" class="ss-menu__item" role="menuitem" onClick=${() => pick(typed)}>
        <${Lucide} name="plus" /><span>${t('新关系「{name}」', { name: typed })}</span>
      </button>`
    }
    ${matches.map(
      (key) =>
        html`<button
          type="button"
          class="ss-menu__item"
          role="menuitem"
          data-relation=${key}
          onClick=${() => pick(key)}
        >
          <span>${relationLabel(key)}</span>
        </button>`,
    )}
    <div class="ss-menu__sep"></div>
    <button
      type="button"
      class="ss-menu__item"
      role="menuitem"
      onClick=${() => setReversed(!reversed)}
    >
      <${Lucide} name="arrow-down-up" /><span
        >${t('反向：{from} → {to}', { from: name(target), to: name(source) })}</span
      >
    </button>
  </div>`;
}
