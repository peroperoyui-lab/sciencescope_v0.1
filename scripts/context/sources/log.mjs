import { projectSnapshot } from './workbench.mjs';
export const id = 'log';
export const sections = Object.freeze(['log']);
export const describe = (_role) => 'Read the project activity log, excluding assistant/tool records.';
export function createLogSource(deps) { return { id, sections, describe, async read(scope, args = {}) { const { value } = await projectSnapshot(deps, scope, args); return { log: (value.logs || []).map((log) => ({ title: log.title, date: log.date || log.time, text: log.text, note: log.note, files: (log.files || []).map((file) => file.name || file.path) })) }; } }; }
export default { id, sections, describe, create: createLogSource };
