import { projectSnapshot } from './workbench.mjs';
export const id = 'map';
export const sections = Object.freeze(['map']);
export const describe = (_role) => 'Read the complete project research map with node status markers.';
export function createMapSource(deps) { return { id, sections, describe, async read(scope, args = {}) { const { value } = await projectSnapshot(deps, scope, args); const nodes = value.map?.nodes || []; const children = (parent) => nodes.filter((node) => node.parent === parent); const lines = []; const walk = (node, depth) => { lines.push(`${'  '.repeat(depth)}- ${String(node.text || '').replace(/\s+/g, ' ')}${node.status ? ` [${node.status}]` : ''}`); for (const child of children(node.id)) walk(child, depth + 1); }; for (const root of nodes.filter((node) => !node.parent)) walk(root, 0); return { map: lines.join('\n') }; } }; }
export default { id, sections, describe, create: createMapSource };
