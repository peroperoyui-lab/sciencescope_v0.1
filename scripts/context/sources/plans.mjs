import { projectSnapshot, plansInScope } from './workbench.mjs';
export const id = 'plans';
export const sections = Object.freeze(['plans']);
export const describe = (_role) => 'Read project plans and their completion state.';
export function createPlansSource(deps) { return { id, sections, describe, async read(scope, args = {}) { const { target, facade } = await projectSnapshot(deps, scope, args); const selected=plansInScope(deps,target,await facade.plans()||[]); return { ...selected, plans: selected.plans.map((plan) => ({ title: plan.title, project: plan.project, time: plan.time, done: Boolean(plan.done) })) }; } }; }
export default { id, sections, describe, create: createPlansSource };
