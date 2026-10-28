// Research map layout (design system PageMap): each tree grows left to right,
// a node's children in the next column, the node centred beside them. Trees
// are stacked down the page; floating nodes keep the place they were dragged
// to. Links are curves from a node's right edge to its child's left edge.

export const NODE = {
  width: 150,
  root: 168,
  height: 30,
  /** A node with a second line (秘书添加, progress, attachments). */
  tall: 48,
  /** Space between a node and its children's column. */
  column: 48,
  /** Space between two leaves. */
  gap: 14,
  /** Space between two trees. */
  trees: 36,
  left: 24,
  top: 24,
};

/** Whether the node shows a second line under its title. @param {any} node */
export const hasMeta = (node) =>
  Boolean(
    node.addedBy === 'agent_secretary' || node.status || node.floating || node.attachments?.length,
  );

/**
 * @param {Array<{ id: string, parent: string | null, floating?:boolean, x?:number, y?:number }>} nodes
 * @param {Record<string, boolean>} collapsed
 * @returns {Array<{ node: any, x: number, y: number, w: number, h: number,
 *   root: boolean, parent?: string }>}
 */
export function layoutMap(nodes, collapsed) {
  const known = new Set(nodes.map((node) => node.id));
  const childrenOf = (id) => (collapsed[id] ? [] : nodes.filter((node) => node.parent === id));
  /** @type {any[]} */
  const result = [];
  /** Place a node and its subtree from `top`; returns the bottom and the node's centre. */
  const place = (node, x, top, root, parent) => {
    const w = root ? NODE.root : NODE.width;
    const h = hasMeta(node) ? NODE.tall : NODE.height;
    const entry = { node, x, y: top, w, h, root, ...(parent ? { parent } : {}) };
    result.push(entry);
    const children = childrenOf(node.id);
    if (!children.length) return { bottom: top + h, centre: top + h / 2 };
    let y = top;
    const centres = [];
    for (const child of children) {
      const placed = place(child, x + w + NODE.column, y, false, node.id);
      centres.push(placed.centre);
      y = placed.bottom + NODE.gap;
    }
    const centre = (centres[0] + centres.at(-1)) / 2;
    entry.y = Math.max(top, centre - h / 2);
    return { bottom: Math.max(y - NODE.gap, entry.y + h), centre: entry.y + h / 2 };
  };
  let y = NODE.top;
  for (const root of nodes.filter((node) => !node.parent || !known.has(node.parent))) {
    if (root.floating) {
      place(root, root.x ?? 420, root.y ?? 120, true);
      continue;
    }
    y = place(root, NODE.left, y, true).bottom + NODE.trees;
  }
  return result;
}

/** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
const curve = (x1, y1, x2, y2) => {
  const bend = Math.max(24, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1}C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
};

/**
 * The tree's links, parent to child.
 * @param {ReturnType<typeof layoutMap>} positions
 */
export function mapConnections(positions) {
  const byId = new Map(positions.map((position) => [position.node.id, position]));
  return positions.flatMap((child) => {
    const parent = child.parent && byId.get(child.parent);
    if (!parent) return [];
    return [curve(parent.x + parent.w, parent.y + parent.h / 2, child.x, child.y + child.h / 2)];
  });
}

/** Scale and offset that fit the whole map into a viewport. */
export function fitView(positions, width, height) {
  if (!positions.length) return { x: 18, y: 18, scale: 1 };
  const minX = Math.min(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y));
  const left = Math.min(0, minX);
  const top = Math.min(0, minY);
  const mapWidth = Math.max(...positions.map((p) => p.x + p.w)) - left + 35;
  const mapHeight = Math.max(...positions.map((p) => p.y + p.h)) - top + 35;
  const scale = Math.max(0.2, Math.min(1, (width - 36) / mapWidth, (height - 36) / mapHeight));
  return { x: 18 - left * scale, y: 18 - top * scale, scale };
}

/**
 * Extra links (连线) between visible nodes: forward to the other node's left
 * edge, otherwise out and back round to its right edge.
 * @param {ReturnType<typeof layoutMap>} positions @param {any[]} edges
 */
export function mapEdges(positions, edges) {
  const byId = new Map(positions.map((position) => [position.node.id, position]));
  return edges.flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return [];
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const y2 = to.y + to.h / 2;
    if (to.x > x1 + 24) return [{ ...edge, path: curve(x1, y1, to.x, y2) }];
    const x2 = to.x + to.w;
    const out = Math.max(x1, x2) + 56;
    return [{ ...edge, path: `M${x1} ${y1}C${out} ${y1} ${out} ${y2} ${x2} ${y2}` }];
  });
}
