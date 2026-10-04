import { stableHash } from './_shared.mjs';
import { projectSnapshot, plansInScope } from './workbench.mjs';
import { createMinutesSource } from './minutes.mjs';

export const id = 'status';
export const sections = Object.freeze(['status']);
export const describe = (_role) => 'Read a compact project status: map markers, incomplete plans, recent log entries, latest version and minutes to-dos.';

export function createStatusSource(deps) {
  const minutesSource = createMinutesSource(deps);
  return { id, sections, describe, async read(scope, args = {}) {
    const { target, value, facade } = await projectSnapshot(deps, scope, args);
    const plans = await facade.plans();
    const projectName = value.projectName || target.project?.name;
    const {plans:projectPlans,scopeNote} = plansInScope(deps,target,plans||[]);
    const pendingPlans = projectPlans.filter((plan) => !plan.done).map((plan) => ({ title: plan.title, project: plan.project, time: plan.time }));
    const logs = (value.logs || []).slice(-5).map((log) => ({ title: log.title, date: log.date || log.time, text: log.text, note: log.note }));
    const versions = value.versions || [];
    const latestVersion = versions.at(-1) ? { name: versions.at(-1).name, number: versions.at(-1).number, status: versions.at(-1).status, notes: versions.at(-1).note, summary: versions.at(-1).summary } : null;
    const nodes = (value.map?.nodes || []).map((node) => ({ id: node.id, text: String(node.text || ''), status: node.status || null }));
    const minutes = target.chatId ? await minutesSource.read(scope, args) : { minutes: null };
    let todo = '';
    if (typeof minutes.minutes === 'string') {
      const lines = minutes.minutes.split(/\r?\n/u);
      const start = lines.findIndex((line) => /^\s*(?:#{1,6}\s*)?(?:7[.)](?:\s|$)|待办(?:\s|$)|To-?dos?(?:\s|$)|Next steps?(?:\s|$))/i.test(line));
      if (start >= 0) {
        const rest = [];
        for (const line of lines.slice(start + 1)) {
          if (/^\s*(?:#{1,6}\s*)?(?:[1-6][.)]|研究问题|已定结论|被否定|未决问题|各参与者|文稿与文件)\b/i.test(line)) break;
          rest.push(line);
        }
        todo = rest.join('\n').trim();
      }
    }
    const result = { projectId: target.projectId, projectName, map: { nodes }, pendingPlans, recentLogs: logs, latestVersion, minutesTodos: todo, ...(scopeNote?{scopeNote}:{}) };
    return { ...result, hash: stableHash(result) };
  } };
}
export default { id, sections, describe, create: createStatusSource };
