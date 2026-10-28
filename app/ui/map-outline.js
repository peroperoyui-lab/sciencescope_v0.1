// The research map as a Markdown outline and back (the map page's
// 「Markdown 大纲」 tab). Each node is a `- ` line indented two spaces per
// level, its progress in （…） at the end, further lines of its text indented
// under it. Reading an outline back keeps the ids, positions and attachments
// of nodes whose text did not change, and the links between nodes that remain.

export const STATUSES = ['待开始', '进行中', '已整理', '待核查', '已完成'];

/** @param {any[]} nodes */
export function outline(nodes) {
  const known = new Set(nodes.map((node) => node.id));
  const lines = [];
  const walk = (node, depth) => {
    const [first, ...rest] = (node.text ?? '').split('\n');
    lines.push(`${'  '.repeat(depth)}- ${first}${node.status ? ` （${node.status}）` : ''}`);
    for (const line of rest) lines.push(`${'  '.repeat(depth + 1)}${line}`);
    for (const child of nodes.filter((candidate) => candidate.parent === node.id))
      walk(child, depth + 1);
  };
  for (const root of nodes.filter((node) => !node.parent || !known.has(node.parent))) walk(root, 0);
  return `${lines.join('\n')}\n`;
}

const ITEM = /^(\s*)[-*+] (.*)$/;
const STATUS = new RegExp(`\\s*（(${STATUSES.join('|')})）$`);

/** @param {string} prefix */
function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

/**
 * @param {string} text the edited outline
 * @param {{ nodes: any[], edges?: any[] }} map the map it was made from
 * @returns {{ nodes: any[], edges: any[] }}
 */
export function parseOutline(text, map) {
  /** @type {Array<{ depth: number, lines: string[], status: string }>} */
  const items = [];
  for (const line of text.split('\n')) {
    const match = ITEM.exec(line);
    if (match) {
      const status = STATUS.exec(match[2])?.[1] ?? '';
      items.push({
        depth: Math.floor(match[1].replace(/\t/g, '  ').length / 2),
        lines: [status ? match[2].replace(STATUS, '') : match[2]],
        status,
      });
    } else if (line.trim() && items.length) items.at(-1).lines.push(line.trim());
  }
  const unused = [...map.nodes];
  const stack = [];
  const nodes = items.map((item) => {
    const nodeText = item.lines.join('\n').trim();
    const index = unused.findIndex((node) => (node.text ?? '').trim() === nodeText);
    const old = index >= 0 ? unused.splice(index, 1)[0] : null;
    const depth = Math.min(item.depth, stack.length);
    stack.length = depth;
    const parent = depth ? stack[depth - 1] : null;
    const node = {
      ...(old ?? { id: newId('node') }),
      parent,
      text: nodeText,
    };
    if (item.status) node.status = item.status;
    else delete node.status;
    // A floating node stays floating only while it is still a root.
    if (parent) delete node.floating;
    stack.push(node.id);
    return node;
  });
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    edges: (map.edges ?? []).filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
  };
}
