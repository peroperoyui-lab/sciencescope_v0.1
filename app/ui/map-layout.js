// Research map layout, ported from the approved prototype (`mapPositions`,
// `mapViewport`): root nodes stacked down a vertical trunk, each node's
// children to its right, grouped by a curly brace.

const ROOT = { x: 80, w: 172, h: 68 };
const CHILD = { dx: 280, w: 228, h: 49 };
const ROW = 68;

/**
 * @param {Array<{ id: string, parent: string | null }>} nodes
 * @param {Record<string, boolean>} collapsed
 * @returns {Array<{ node: any, x: number, y: number, w: number, h: number,
 *   root: boolean, parent?: string }>}
 */
export function layoutMap(nodes, collapsed) {
  const known = new Set(nodes.map((node) => node.id));
  const childrenOf = (id) => (collapsed[id] ? [] : nodes.filter((node) => node.parent === id));
  const height = (id) => {
    const children = childrenOf(id);
    return children.length
      ? Math.max(
          ROW,
          children.reduce((sum, child) => sum + height(child.id), 0),
        )
      : ROW;
  };
  const result = [];
  const placeChildren = (node, x, top) => {
    let y = top;
    for (const child of childrenOf(node.id)) {
      result.push({
        node: child,
        x: x + CHILD.dx,
        y,
        w: CHILD.w,
        h: CHILD.h,
        root: false,
        parent: node.id,
      });
      placeChildren(child, x + CHILD.dx, y);
      y += height(child.id);
    }
  };
  let y = 45;
  for (const root of nodes.filter((node) => !node.parent || !known.has(node.parent))) {
    const h = height(root.id);
    result.push({ node: root, x: ROOT.x, y: y + Math.max(0, (h - ROW) / 2), ...ROOT, root: true });
    placeChildren(root, ROOT.x, y);
    y += Math.max(136, h + 58);
  }
  return result;
}

/**
 * SVG path data for the trunk arrows between roots and the brace to each
 * node's children.
 * @param {ReturnType<typeof layoutMap>} positions
 */
export function mapConnections(positions) {
  const paths = [];
  const roots = positions.filter((p) => p.root);
  roots.forEach((root, index) => {
    const next = roots[index + 1];
    if (!next) return;
    paths.push(`M${root.x + 86} ${root.y + root.h}V${next.y - 7}`);
    paths.push(`m${root.x + 82} ${next.y - 13} 4 6 4-6`);
  });
  for (const p of positions) {
    const children = positions.filter((q) => q.parent === p.node.id);
    if (!children.length) continue;
    const mid = p.y + p.h / 2;
    const x = p.x + p.w + 28;
    const first = children[0];
    const last = children[children.length - 1];
    paths.push(
      `M${p.x + p.w} ${mid}H${x} M${x + 14} ${first.y + 16}Q${x} ${first.y + 16} ${x} ${first.y + 30}` +
        `V${Math.max(mid - 10, first.y + 30)}Q${x} ${mid} ${x - 10} ${mid}Q${x} ${mid} ${x} ${mid + 10}` +
        `V${Math.max(mid + 10, last.y + last.h - 16)}Q${x} ${last.y + last.h} ${x + 14} ${last.y + last.h}`,
    );
    for (const child of children) paths.push(`M${x + 14} ${child.y + 24}H${child.x}`);
  }
  return paths;
}

/** Scale and offset that fit the whole map into a viewport. */
export function fitView(positions, width, height) {
  if (!positions.length) return { x: 18, y: 18, scale: 1 };
  const maxX = Math.max(...positions.map((p) => p.x + p.w)) + 35;
  const maxY = Math.max(...positions.map((p) => p.y + p.h)) + 35;
  return {
    x: 18,
    y: 18,
    scale: Math.max(0.2, Math.min(1, (width - 36) / maxX, (height - 36) / maxY)),
  };
}
