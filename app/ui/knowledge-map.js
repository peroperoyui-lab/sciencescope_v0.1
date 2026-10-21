// The knowledge graph canvas (KNOWLEDGE_BASE §7a). The host's layout index
// gives every node a position; only nodes near the viewport become Cytoscape
// elements, at most RENDER_LIMIT and hubs first. Every other node in view is a
// faint dot on a canvas underneath, so the whole map stays visible cheaply.
// Positions are never laid out here: the host computes them and they persist.
import { LUCIDE } from './lucide-icons.js';
import { kindIcon, nodeKind, relationLabel, splitRef } from './components/knowledge-fields.js';

export const RENDER_LIMIT = 1500;
export const EDGE_LIMIT = 5000;
// Above this many drawn edges, only the centre's, the selection's and the
// hovered edges keep their labels: thousands of labels cost ~10x a frame.
const EDGE_LABEL_LIMIT = 300;
// Load a quarter of the view beyond each side, after panning settles.
const MARGIN = 0.25;
const SETTLE_MS = 100;
// Average spacing between nodes on screen at zoom 1, whatever the host's units.
const SPACING = 90;
const LABEL_ZOOM = 0.7;

/** Node kinds that share a colour token (components.css `[data-node-kind]`). */
const TOKEN = {
  source: 'source',
  method: 'method',
  variant: 'method',
  dataset: 'dataset',
  variable: 'variable',
  metric: 'variable',
  software: 'software',
  code: 'software',
  person: 'agent',
  org: 'agent',
};
/** Kind groups for the legend and the filter, in display order. @type {[string,string,string[]][]} */
export const KIND_GROUPS = [
  ['source', '文献', ['source']],
  ['method', '方法', ['method', 'variant']],
  ['dataset', '数据集', ['dataset']],
  ['variable', '变量与指标', ['variable', 'metric']],
  ['software', '软件与代码', ['software', 'code']],
  ['concept', '概念与条目', []],
  ['agent', '人物与机构', ['person', 'org']],
];
/** @param {string} kind A display kind (nodeKind). */
export const kindGroup = (kind) => TOKEN[kind] ?? 'concept';

/** @param {string} ref @param {string} kind The index kind: source, item type or entity kind. */
export function displayKind(ref, kind) {
  const { type } = splitRef(ref);
  return type === 'entity' ? kind : nodeKind(type, kind);
}

/** Any CSS colour as #rrggbb, through a canvas. @param {string} value */
function hex(value) {
  const context = document.createElement('canvas').getContext('2d');
  context.fillStyle = '#000';
  context.fillStyle = value.trim() || '#000';
  return context.fillStyle;
}
/** @param {string} a @param {string} b @param {number} share Share of `a`. */
function mix(a, b, share) {
  const parse = (color) => [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
  const [x, y] = [parse(a), parse(b)];
  return (
    '#' +
    x
      .map((value, index) =>
        Math.round(value * share + y[index] * (1 - share))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Design tokens the canvas needs, read from the page so both themes work. */
function readPalette(element) {
  const style = getComputedStyle(element);
  const token = (name) => hex(style.getPropertyValue(name));
  const palette = {
    paper: token('--paper'),
    raised: token('--raised'),
    ink: token('--ink'),
    ink2: token('--ink-2'),
    muted: token('--muted'),
    line: token('--line-strong'),
    accent: token('--accent'),
    accentSoft: token('--accent-soft'),
    accentInk: token('--accent-ink'),
    font: style.getPropertyValue('--font-sans').trim() || 'sans-serif',
    kinds: /** @type {Record<string,{stroke:string,fill:string,dot:string}>} */ ({}),
  };
  for (const [group] of KIND_GROUPS) {
    const stroke = token(`--kg-${group}`);
    palette.kinds[group] = {
      stroke,
      fill: mix(stroke, palette.raised, 0.18),
      dot: mix(stroke, palette.paper, 0.45),
    };
  }
  return palette;
}

/** A Lucide icon as an image Cytoscape can draw inside a node. */
function iconImage(name, color) {
  const body = LUCIDE[name] ?? LUCIDE['file-text'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function stylesheet(palette) {
  const kindSelectors = Object.entries(palette.kinds).flatMap(([group, colours]) => [
    {
      selector: `node[group = "${group}"]`,
      style: { 'background-color': colours.fill, 'border-color': colours.stroke },
    },
  ]);
  return [
    {
      selector: 'node',
      style: {
        width: 'data(size)',
        height: 'data(size)',
        'border-width': 1.5,
        'background-image': 'data(icon)',
        'background-width': '46%',
        'background-height': '46%',
        label: 'data(label)',
        'font-family': palette.font,
        'font-size': 11,
        color: palette.ink2,
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'text-max-width': '140px',
        'text-wrap': 'ellipsis',
        'text-background-color': palette.paper,
        'text-background-opacity': 0.8,
        'text-background-padding': '1px',
        'min-zoomed-font-size': 8,
        'overlay-opacity': 0,
      },
    },
    ...kindSelectors,
    { selector: 'node.hub', style: { 'font-size': 12, 'font-weight': 600, color: palette.ink } },
    {
      selector: 'node.center',
      style: {
        'outline-width': 1.5,
        'outline-color': palette.muted,
        'outline-style': 'dashed',
        'outline-offset': 5,
        'font-weight': 600,
        color: palette.ink,
      },
    },
    {
      selector: 'node.chosen',
      style: {
        'underlay-color': palette.accent,
        'underlay-opacity': 0.22,
        'underlay-padding': 6,
        'underlay-shape': 'ellipse',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1,
        'curve-style': 'straight',
        'line-color': palette.line,
        'target-arrow-shape': 'triangle',
        'target-arrow-color': palette.line,
        'arrow-scale': 0.7,
        label: 'data(label)',
        'font-family': palette.font,
        'font-size': 10,
        color: palette.muted,
        'min-zoomed-font-size': 9,
        'text-background-color': palette.paper,
        'text-background-opacity': 1,
        'text-background-padding': '2px',
        'overlay-opacity': 0,
      },
    },
    { selector: 'edge.quiet', style: { label: '' } },
    { selector: 'edge.derived', style: { 'line-style': 'dashed', 'line-dash-pattern': [4, 3] } },
    {
      selector: 'edge.extracted',
      style: { 'mid-target-arrow-shape': 'circle', 'mid-target-arrow-color': palette.line },
    },
    {
      selector: 'edge.ai',
      style: {
        color: palette.accentInk,
        'text-background-color': palette.accentSoft,
        'text-background-shape': 'roundrectangle',
      },
    },
    {
      selector: 'edge.hover',
      style: {
        label: 'data(label)',
        width: 2,
        'line-color': palette.accent,
        'target-arrow-color': palette.accent,
        'mid-target-arrow-color': palette.accent,
        color: palette.accentInk,
        'min-zoomed-font-size': 0,
        'z-index': 10,
      },
    },
    { selector: '.faded', style: { opacity: 0.16 } },
    { selector: 'edge.faded', style: { opacity: 0.08 } },
    { selector: '.hidden', style: { display: 'none' } },
    {
      selector: 'node.ghost',
      style: { width: 1, height: 1, opacity: 0, label: '', 'background-image': 'none' },
    },
    {
      selector: 'edge.ghost',
      style: { 'line-style': 'dotted', 'line-color': palette.accent, label: '' },
    },
  ];
}

/**
 * @typedef {{ref:string,x:number,y:number,kind:string,degree:number,pinned:boolean}} IndexNode
 * @typedef {{kinds:Set<string>|null,layers:Set<string>|null,aiOnly:boolean}} MapFilters
 * @typedef {{
 *   load:(refs:string[])=>Promise<{nodes:any[],edges:any[]}>,
 *   onSelect?:(ref:string|null,multi:boolean,point:{x:number,y:number})=>void,
 *   onCenter?:(ref:string)=>void,
 *   onMenu?:(ref:string,point:{x:number,y:number})=>void,
 *   onEdgeMenu?:(edge:any,point:{x:number,y:number})=>void,
 *   onHover?:(edge:any|null,point?:{x:number,y:number})=>void,
 *   onMove?:(ref:string,x:number,y:number)=>void,
 *   onConnect?:(from:string,to:string,point:{x:number,y:number})=>void,
 *   onLoaded?:(state:{rendered:number,dots:number})=>void,
 * }} MapOptions
 */

/**
 * @param {any} cytoscape The library, loaded on demand.
 * @param {HTMLElement} host Holds the dot canvas and the Cytoscape container.
 * @param {MapOptions} options
 */
export function createKnowledgeMap(cytoscape, host, options) {
  const dots = document.createElement('canvas');
  dots.className = 'kb-map__dots';
  const container = document.createElement('div');
  container.className = 'kb-map__cy';
  host.append(dots, container);
  let palette = readPalette(host);
  const icons = new Map();
  const icon = (kind, group) => {
    const key = `${kind}:${group}`;
    if (!icons.has(key)) icons.set(key, iconImage(kindIcon(kind), palette.kinds[group].stroke));
    return icons.get(key);
  };
  const cy = cytoscape({
    container,
    layout: { name: 'preset' },
    style: /** @type {any} */ (stylesheet(palette)),
    minZoom: 0.02,
    maxZoom: 4,
    wheelSensitivity: 0.3,
    boxSelectionEnabled: false,
    // Pan and zoom move a snapshot; the graph is redrawn once they stop.
    textureOnViewport: true,
    // Selection belongs to the page (the detail panel); see `chosen`.
    autounselectify: true,
  });

  /** @type {IndexNode[]} */
  let nodes = [];
  /** @type {Map<string, number>} */
  let position = new Map();
  let scale = 0;
  let hubDegree = Infinity;
  /** @type {MapFilters} */
  let filters = { kinds: null, layers: null, aiOnly: false };
  /** @type {{ref:string,refs:Set<string>}|null} */
  let center = null;
  /** Selected refs, kept loaded even when they are not hubs. */
  let chosen = new Set();
  let syncTimer = null;
  let syncSerial = 0;
  let frame = 0;
  let destroyed = false;

  const visibleKind = (node) =>
    !filters.kinds || filters.kinds.has(kindGroup(displayKind(node.ref, node.kind)));
  const size = (degree) => Math.round(20 + Math.min(20, 4 * Math.log2(1 + degree)));
  const model = (node) => ({ x: node.x * scale, y: node.y * scale });

  /** Replace the layout index; keep the camera and the loaded elements. */
  function setIndex(rows) {
    nodes = rows.map(([ref, x, y, kind, degree, pinned]) => ({
      ref,
      x,
      y,
      kind,
      degree,
      pinned: Boolean(pinned),
    }));
    position = new Map(nodes.map((node, index) => [node.ref, index]));
    if (!scale && nodes.length) {
      let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const node of nodes) {
        x1 = Math.min(x1, node.x);
        y1 = Math.min(y1, node.y);
        x2 = Math.max(x2, node.x);
        y2 = Math.max(y2, node.y);
      }
      const spacing = Math.sqrt(Math.max(1, (x2 - x1) * (y2 - y1)) / nodes.length);
      scale = nodes.length < 2 ? 1 : Math.min(100, Math.max(0.01, SPACING / spacing));
    }
    const degrees = nodes.map((node) => node.degree).sort((a, b) => b - a);
    hubDegree = Math.max(3, degrees[Math.min(degrees.length - 1, 29)] ?? Infinity);
    // Moved nodes take their new place; removed ones leave.
    cy.batch(() => {
      for (const element of cy.nodes(':not(.ghost)')) {
        const index = position.get(element.id());
        if (index == null) element.remove();
        else if (!element.grabbed()) element.position(model(nodes[index]));
      }
    });
    schedule(0);
    drawDots();
  }

  /** The node with the most connections, where the camera first looks. */
  function hub() {
    let best = null;
    for (const node of nodes) if (!best || node.degree > best.degree) best = node;
    return best;
  }

  function look(ref, zoom = 1, animate = true) {
    const index = position.get(ref);
    if (index == null) return;
    const point = model(nodes[index]);
    const target = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), zoom));
    const pan = { x: cy.width() / 2 - point.x * target, y: cy.height() / 2 - point.y * target };
    if (animate) cy.animate({ pan, zoom: target }, { duration: 300 });
    else cy.viewport({ pan, zoom: target });
  }

  /** Frame the given refs, or every node. @param {Iterable<string>} [refs] */
  function fit(refs, animate = true) {
    const chosenNodes = refs
      ? [...refs].map((ref) => nodes[position.get(ref)]).filter(Boolean)
      : nodes;
    if (!chosenNodes.length) return;
    let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const node of chosenNodes) {
      const point = model(node);
      x1 = Math.min(x1, point.x);
      y1 = Math.min(y1, point.y);
      x2 = Math.max(x2, point.x);
      y2 = Math.max(y2, point.y);
    }
    const pad = 80;
    const zoom = Math.max(
      cy.minZoom(),
      Math.min(
        1,
        (cy.width() - pad * 2) / Math.max(1, x2 - x1),
        (cy.height() - pad * 2) / Math.max(1, y2 - y1),
      ),
    );
    const pan = {
      x: cy.width() / 2 - ((x1 + x2) / 2) * zoom,
      y: cy.height() / 2 - ((y1 + y2) / 2) * zoom,
    };
    if (animate) cy.animate({ zoom, pan }, { duration: 250 });
    else cy.viewport({ zoom, pan });
  }

  /** Refs to render: the centre's neighbourhood and selection first, then hubs in view. */
  function wanted() {
    const extent = cy.extent();
    const dx = extent.w * MARGIN;
    const dy = extent.h * MARGIN;
    const [x1, y1, x2, y2] = [
      (extent.x1 - dx) / scale,
      (extent.y1 - dy) / scale,
      (extent.x2 + dx) / scale,
      (extent.y2 + dy) / scale,
    ];
    const must = new Set([...chosen].filter((ref) => position.has(ref)));
    if (center) for (const ref of center.refs) if (position.has(ref)) must.add(ref);
    const inView = [];
    for (const node of nodes)
      if (
        node.x >= x1 &&
        node.x <= x2 &&
        node.y >= y1 &&
        node.y <= y2 &&
        visibleKind(node) &&
        !must.has(node.ref)
      )
        inView.push(node);
    const room = Math.max(0, RENDER_LIMIT - must.size);
    if (inView.length > room) inView.sort((a, b) => b.degree - a.degree).length = room;
    return [...must, ...inView.map((node) => node.ref)];
  }

  async function sync() {
    if (destroyed || !scale) return;
    const serial = ++syncSerial;
    const refs = wanted();
    let result;
    try {
      result = refs.length ? await options.load(refs) : { nodes: [], edges: [] };
    } catch {
      return;
    }
    if (destroyed || serial !== syncSerial) return;
    const keep = new Set(result.nodes.map((node) => node.ref));
    let edges = result.edges;
    if (edges.length > EDGE_LIMIT) {
      const weight = (edge) =>
        (center?.refs.has(edge.from) || center?.refs.has(edge.to) ? 1e9 : 0) +
        (nodes[position.get(edge.from)]?.degree ?? 0) +
        (nodes[position.get(edge.to)]?.degree ?? 0);
      edges = [...edges].sort((a, b) => weight(b) - weight(a)).slice(0, EDGE_LIMIT);
    }
    const edgeIds = new Set(edges.map((edge) => edge.id));
    cy.batch(() => {
      for (const element of cy.nodes(':not(.ghost)')) if (!keep.has(element.id())) element.remove();
      for (const element of cy.edges(':not(.ghost)'))
        if (!edgeIds.has(element.id())) element.remove();
      const added = [];
      for (const row of result.nodes) {
        const index = position.get(row.ref);
        if (index == null) continue;
        const existing = cy.getElementById(row.ref);
        const node = nodes[index];
        const kind = displayKind(row.ref, row.kind ?? node.kind);
        const group = kindGroup(kind);
        const data = {
          id: row.ref,
          label: row.name ?? '',
          kind,
          group,
          size: size(node.degree),
          icon: icon(kind, group),
        };
        if (existing.nonempty()) existing.data(data);
        else added.push({ group: 'nodes', data, position: model(node) });
      }
      cy.add(added);
      cy.add(
        edges
          .filter((edge) => cy.getElementById(edge.id).empty())
          .map((edge) => ({
            group: 'edges',
            data: {
              id: edge.id,
              source: edge.from,
              target: edge.to,
              relation: edge.relation,
              layer: edge.layer,
              origin: edge.origin,
              ai: edge.aiUntouched,
              label: relationLabel(edge.relation) + (edge.aiUntouched ? ' · AI' : ''),
            },
          })),
      );
      for (const element of cy.nodes(':not(.ghost)')) {
        element.toggleClass('hub', element.data('size') && nodeDegree(element.id()) >= hubDegree);
        element.toggleClass('center', element.id() === center?.ref);
        element.toggleClass('chosen', chosen.has(element.id()));
      }
      for (const element of cy.edges(':not(.ghost)')) {
        element.toggleClass('derived', element.data('layer') === 'derived');
        element.toggleClass('extracted', element.data('layer') === 'extracted');
        element.toggleClass('ai', Boolean(element.data('ai')));
      }
      applyClasses();
    });
    drawDots();
    options.onLoaded?.({ rendered: cy.nodes(':not(.ghost)').length, dots: nodes.length });
  }
  const nodeDegree = (ref) => nodes[position.get(ref)]?.degree ?? 0;

  /** Filters hide; the centre's neighbourhood stays bright and the rest fades. */
  function applyClasses() {
    for (const element of cy.nodes(':not(.ghost)')) {
      const index = position.get(element.id());
      element.toggleClass('hidden', index == null || !visibleKind(nodes[index]));
      element.toggleClass('faded', Boolean(center) && !center.refs.has(element.id()));
    }
    const quiet = cy.edges(':not(.ghost)').length > EDGE_LABEL_LIMIT;
    for (const element of cy.edges(':not(.ghost)')) {
      const [from, to] = [element.source().id(), element.target().id()];
      element.toggleClass(
        'quiet',
        quiet &&
          !(center?.refs.has(from) && center.refs.has(to)) &&
          !chosen.has(from) &&
          !chosen.has(to),
      );
      const hidden =
        (filters.layers && !filters.layers.has(element.data('layer'))) ||
        (filters.aiOnly && !element.data('ai'));
      element.toggleClass('hidden', Boolean(hidden));
      element.toggleClass(
        'faded',
        Boolean(center) &&
          !(center.refs.has(element.source().id()) && center.refs.has(element.target().id())),
      );
    }
  }

  function schedule(delay = SETTLE_MS) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void sync(), delay);
  }

  /** Every node in view that Cytoscape is not drawing, as a small dot. */
  function drawDots() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (destroyed) return;
      const ratio = window.devicePixelRatio || 1;
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (dots.width !== Math.round(width * ratio) || dots.height !== Math.round(height * ratio)) {
        dots.width = Math.round(width * ratio);
        dots.height = Math.round(height * ratio);
      }
      const context = dots.getContext('2d');
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const zoom = cy.zoom();
      const pan = cy.pan();
      const radius = Math.max(1.2, Math.min(3, zoom * 4));
      const faded = Boolean(center);
      const groups = new Map();
      for (const node of nodes) {
        const x = node.x * scale * zoom + pan.x;
        const y = node.y * scale * zoom + pan.y;
        if (x < -4 || y < -4 || x > width + 4 || y > height + 4) continue;
        if (!visibleKind(node) || cy.getElementById(node.ref).nonempty()) continue;
        const group = kindGroup(displayKind(node.ref, node.kind));
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(x, y);
      }
      context.globalAlpha = faded ? 0.25 : 0.7;
      for (const [group, points] of groups) {
        context.fillStyle = palette.kinds[group].dot;
        context.beginPath();
        // Tiny dots as squares: tens of thousands of arcs cost a frame.
        for (let index = 0; index < points.length; index += 2)
          if (radius < 2)
            context.rect(
              points[index] - radius,
              points[index + 1] - radius,
              radius * 2,
              radius * 2,
            );
          else {
            context.moveTo(points[index] + radius, points[index + 1]);
            context.arc(points[index], points[index + 1], radius, 0, Math.PI * 2);
          }
        context.fill();
      }
    });
  }

  // ---- Pointer interaction --------------------------------------------------
  const point = (event) => {
    const rendered = event.renderedPosition ?? event.position;
    const box = container.getBoundingClientRect();
    return { x: box.left + rendered.x, y: box.top + rendered.y };
  };
  cy.on('viewport', () => {
    drawDots();
    schedule();
  });
  cy.on('tap', 'node:not(.ghost)', (event) => {
    const multi = Boolean(event.originalEvent?.shiftKey || event.originalEvent?.ctrlKey);
    options.onSelect?.(event.target.id(), multi, point(event));
  });
  cy.on('tap', (event) => {
    if (event.target === cy) options.onSelect?.(null, false, point(event));
  });
  cy.on('dbltap', 'node:not(.ghost)', (event) => options.onCenter?.(event.target.id()));
  cy.on('cxttap', 'node:not(.ghost)', (event) => options.onMenu?.(event.target.id(), point(event)));
  cy.on('cxttap', 'edge:not(.ghost)', (event) =>
    options.onEdgeMenu?.(event.target.data(), point(event)),
  );
  cy.on('mouseover', 'edge:not(.ghost)', (event) => {
    event.target.addClass('hover');
    options.onHover?.(event.target.data(), point(event));
  });
  cy.on('mouseout', 'edge', (event) => {
    event.target.removeClass('hover');
    options.onHover?.(null);
  });
  cy.on('dragfree', 'node:not(.ghost)', (event) => {
    const ref = event.target.id();
    const index = position.get(ref);
    if (index == null) return;
    const { x, y } = event.target.position();
    Object.assign(nodes[index], { x: x / scale, y: y / scale, pinned: true });
    options.onMove?.(ref, x / scale, y / scale);
  });

  // Drag-to-connect from the handle beside the selected node.
  let connecting = null;
  function startConnect(ref, clientX, clientY) {
    const source = cy.getElementById(ref);
    if (source.empty()) return;
    const box = container.getBoundingClientRect();
    const toModel = (x, y) => ({
      x: (x - box.left - cy.pan().x) / cy.zoom(),
      y: (y - box.top - cy.pan().y) / cy.zoom(),
    });
    const ghost = cy.add({
      group: 'nodes',
      classes: 'ghost',
      data: { id: '__ghost' },
      position: toModel(clientX, clientY),
      grabbable: false,
      selectable: false,
    });
    cy.add({
      group: 'edges',
      classes: 'ghost',
      data: { id: '__ghost-edge', source: ref, target: '__ghost' },
    });
    cy.userPanningEnabled(false);
    const move = (event) => ghost.position(toModel(event.clientX, event.clientY));
    const up = (event) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cy.remove('.ghost');
      cy.userPanningEnabled(true);
      connecting = null;
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      const target = cy.nodes(':not(.ghost):not(.hidden)').filter((node) => {
        const bounds = node.renderedBoundingBox({ includeLabels: false });
        return x >= bounds.x1 && x <= bounds.x2 && y >= bounds.y1 && y <= bounds.y2;
      })[0];
      if (target && target.id() !== ref)
        options.onConnect?.(ref, target.id(), { x: event.clientX, y: event.clientY });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    connecting = { ref };
  }

  /** Screen point at the right edge of a node, for the connect handle. */
  function handlePoint(ref) {
    const element = cy.getElementById(ref);
    if (element.empty() || element.hasClass('hidden')) return null;
    const rendered = element.renderedPosition();
    const radius = (element.renderedWidth() || 0) / 2;
    return { x: rendered.x + radius + 6, y: rendered.y };
  }

  const observer = new MutationObserver(() => {
    palette = readPalette(host);
    icons.clear();
    cy.style(/** @type {any} */ (stylesheet(palette)));
    cy.batch(() => {
      for (const element of cy.nodes(':not(.ghost)'))
        element.data('icon', icon(element.data('kind'), element.data('group')));
    });
    drawDots();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style', 'class'],
  });
  const resize = new ResizeObserver(() => {
    cy.resize();
    drawDots();
    schedule();
  });
  resize.observe(host);

  return {
    cy,
    setIndex,
    get size() {
      return nodes.length;
    },
    get edgeCount() {
      return Math.round(nodes.reduce((sum, node) => sum + node.degree, 0) / 2);
    },
    has: (ref) => position.has(ref),
    node: (ref) => nodes[position.get(ref)] ?? null,
    hub,
    look,
    fit,
    zoomBy(factor) {
      cy.animate(
        {
          zoom: {
            level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)),
            renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
          },
        },
        { duration: 150 },
      );
    },
    /** @param {MapFilters} next */
    setFilters(next) {
      filters = next;
      cy.batch(applyClasses);
      drawDots();
      schedule(0);
    },
    /** @param {string|null} ref @param {Iterable<string>} [refs] */
    setCenter(ref, refs = []) {
      center = ref ? { ref, refs: new Set([ref, ...refs]) } : null;
      cy.batch(() => {
        for (const element of cy.nodes(':not(.ghost)'))
          element.toggleClass('center', element.id() === center?.ref);
        applyClasses();
      });
      drawDots();
      schedule(0);
    },
    /** @param {string[]} refs */
    select(refs) {
      chosen = new Set(refs);
      cy.batch(() => {
        for (const element of cy.nodes(':not(.ghost)'))
          element.toggleClass('chosen', chosen.has(element.id()));
        applyClasses();
      });
      if (refs.some((ref) => position.has(ref) && cy.getElementById(ref).empty())) schedule(0);
    },
    selected: () => [...chosen],
    rendered: (ref) => cy.getElementById(ref).nonempty(),
    labelsVisible: () => cy.zoom() >= LABEL_ZOOM,
    startConnect,
    handlePoint,
    refresh: () => schedule(0),
    connecting: () => Boolean(connecting),
    destroy() {
      destroyed = true;
      clearTimeout(syncTimer);
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      cy.destroy();
      dots.remove();
      container.remove();
    },
  };
}
