import { checkScopeTarget, databaseOf, workbenchFacade } from './_shared.mjs';
import { ContextAccessError } from '../policy.mjs';

export function targetProject({ db, role, ctx, args }) {
  const database = databaseOf({ db });
  const target = checkScopeTarget(database, role, ctx, args);
  if (!target.projectId) throw new ContextAccessError('PROJECT_REQUIRED', 'This lookup requires a project.');
  return target;
}

export async function projectSnapshot(deps, scope, args) {
  const target = targetProject({ db: deps.db, role: scope.role, ctx: scope.ctx, args });
  const facade = deps.facade ?? workbenchFacade({ db: deps.db, workbench: deps.workbench });
  return { target, value: await facade.get(target.projectId), facade };
}

// Legacy plans used a project name. Never treat an ambiguous name as proof
// that a plan belongs to this session; explicit IDs take precedence.
export function plansInScope(deps, target, plans) {
  const database=databaseOf(deps);
  const name=target.project?.name;
  const uniqueName=name&&database.prepare('SELECT COUNT(*) AS n FROM projects WHERE name=?').get(name).n===1;
  const visible=plans.filter(plan=>{
    if(plan.projectId)return plan.projectId===target.projectId;
    if(!plan.project||plan.project==='全局计划')return true;
    return uniqueName&&plan.project===name;
  });
  return {plans:visible,...(!uniqueName&&plans.some(plan=>!plan.projectId&&plan.project===name)
    ?{scopeNote:'Legacy plans with an ambiguous project name are omitted; their project ownership must be made explicit.'}:{})};
}
