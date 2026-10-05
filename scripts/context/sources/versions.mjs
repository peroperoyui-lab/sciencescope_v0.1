import { projectSnapshot } from './workbench.mjs';
export const id = 'versions';
export const sections = Object.freeze(['versions']);
export const describe = (_role) => 'Read manuscript versions and their explicit status/notes.';
export function createVersionsSource(deps) { return { id, sections, describe, async read(scope, args = {}) { const { value } = await projectSnapshot(deps, scope, args); return { versions: (value.versions || []).map((version) => ({ name: version.name, number: version.number, path: version.relativePath, created: version.created, status: version.status, notes: version.status === 'organized' ? version.note : undefined, summary: version.summary })) }; } }; }
export default { id, sections, describe, create: createVersionsSource };
