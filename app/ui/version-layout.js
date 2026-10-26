// Version fork tree layout (U7): grows top-down from v1. A version's row is
// its depth; a child on its parent's branch stays in the parent's column and
// every other child starts a branch in a new column to the right. A folded
// branch takes no column and shows as one chip beside its parent.

export const NODE = { width: 132, height: 44, left: 20, top: 16, column: 170, row: 64 };

/**
 * @typedef {{ id: string, number: number, parentId: string | null, branch: string }} TreeNode
 * @typedef {{ node: any, column: number, row: number, x: number, y: number }} Placed
 */

/**
 * @param {TreeNode[]} nodes
 * @param {Set<string>} folded ids of the first version of each folded branch
 */
export function layoutVersions(nodes, folded = new Set()) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map();
  const roots = [];
  for (const node of [...nodes].sort((a, b) => a.number - b.number)) {
    if (node.parentId && byId.has(node.parentId)) {
      if (!children.has(node.parentId)) children.set(node.parentId, []);
      children.get(node.parentId).push(node);
    } else roots.push(node);
  }
  /** @type {Placed[]} */
  const placed = [];
  const links = [];
  const branches = [];
  const folds = [];
  let columns = 0;
  const size = (node) =>
    1 + (children.get(node.id) ?? []).reduce((sum, child) => sum + size(child), 0);
  const at = (column, row) => ({
    x: NODE.left + column * NODE.column,
    y: NODE.top + row * NODE.row,
  });

  /** @param {TreeNode} node @param {number} column @param {number} row */
  function place(node, column, row) {
    const self = { node, column, row, ...at(column, row) };
    placed.push(self);
    const kids = children.get(node.id) ?? [];
    // The child on the same branch continues the line; the first one if none is.
    const trunk = kids.find((child) => child.branch === node.branch) ?? kids[0];
    if (trunk) {
      const child = place(trunk, column, row + 1);
      links.push({ from: node.id, to: trunk.id, kind: 'trunk', ...line(self, child, 0) });
    }
    let side = 0;
    for (const kid of kids) {
      if (kid === trunk) continue;
      const lane = side++;
      if (folded.has(kid.id)) {
        folds.push({
          id: kid.id,
          name: kid.branch,
          count: size(kid),
          parent: node.id,
          lane,
          ...self,
        });
        continue;
      }
      const branchColumn = columns++;
      const child = place(kid, branchColumn, row + 1);
      const path = line(self, child, lane);
      links.push({ from: node.id, to: kid.id, kind: 'branch', ...path });
      branches.push({ id: kid.id, name: kid.branch, parent: node.id, lane, x: self.x, y: self.y });
    }
    return self;
  }

  for (const root of roots) place(root, columns++, 0);
  return {
    placed,
    links,
    branches,
    folds,
    width: NODE.left * 2 + Math.max(1, columns) * NODE.column,
    height: NODE.top * 2 + (Math.max(0, ...placed.map((entry) => entry.row)) + 1) * NODE.row,
  };
}

/** The link from a parent card to a child card, as an SVG path. */
function line(parent, child, lane) {
  if (parent.column === child.column)
    return {
      d: `M${parent.x + NODE.width / 2} ${parent.y + NODE.height}V${child.y}`,
    };
  const y = parent.y + NODE.height / 2 + lane * 8;
  const x = child.x + NODE.width / 2;
  return { d: `M${parent.x + NODE.width} ${y}H${x - 10}Q${x} ${y} ${x} ${y + 10}V${child.y}` };
}

/**
 * Ids from `id` up to the root, for the highlighted path.
 * @param {TreeNode[]} nodes @param {string | null} id
 */
export function pathToRoot(nodes, id) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path = new Set();
  for (
    let node = id ? byId.get(id) : null;
    node && !path.has(node.id);
    node = byId.get(node.parentId ?? '')
  )
    path.add(node.id);
  return path;
}
