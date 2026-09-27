import { ContextAccessError, assertSourceAllowed, policyFor, targetFor } from './policy.mjs';
import { createCatchUp, createOverview } from './catch-up.mjs';
import { workbenchFacade } from './sources/_shared.mjs';
import conversation from './sources/conversation.mjs';
import minutes from './sources/minutes.mjs';
import log from './sources/log.mjs';
import plans from './sources/plans.mjs';
import map from './sources/map.mjs';
import versions from './sources/versions.mjs';
import status from './sources/status.mjs';
import workspace from './sources/workspace.mjs';

export const SOURCE_MODULES = Object.freeze({ conversation, minutes, log, plans, map, versions, status, workspace });

export function sourceDescriptors(role) {
  const allowed = new Set(policyFor(role).sources);
  return Object.values(SOURCE_MODULES).filter((source) => allowed.has(source.id)).map((source) => ({ id: source.id, sections: source.sections || [], description: source.describe(role) }));
}

export function createSourceRegistry(deps) {
  const facade = workbenchFacade({ db: deps.db ?? deps.chatStore?.db?.db, workbench: deps.workbench });
  const all = { conversation: conversation.create({ ...deps }), minutes: minutes.create({ ...deps }), log: log.create({ ...deps, facade }), plans: plans.create({ ...deps, facade }), map: map.create({ ...deps, facade }), versions: versions.create({ ...deps, facade }), status: status.create({ ...deps, facade }), workspace: workspace.create({ ...deps, facade }) };
  return all;
}

export function createContextAccess(deps) {
  const sources = createSourceRegistry(deps);
  const catchup = createCatchUp({ ...deps, status: sources.status });
  const overview = createOverview({ ...deps, workspace: sources.workspace });
  async function call(name, args = {}, ctx = {}) {
    policyFor(ctx.role);
    if (name === 'workspace_overview') {
      if (ctx.role !== 'global') throw new ContextAccessError('SOURCE_NOT_ALLOWED', 'workspace_overview is available only to the global assistant.');
      return sources.workspace.read({ role: ctx.role, ctx }, args);
    }
    if (name === 'minutes_refresh') {
      if (ctx.role !== 'secretary') throw new ContextAccessError('SOURCE_NOT_ALLOWED', 'minutes_refresh is available only to the secretary.');
      if (args.projectId !== undefined || args.chatId !== undefined) throw new ContextAccessError('TARGET_NOT_ALLOWED', 'The secretary cannot select another target.');
      if (!ctx.mainChatId || typeof deps.minutes?.refresh !== 'function') throw new ContextAccessError('CHAT_REQUIRED', 'No conversation is available to refresh.');
      const value = await deps.minutes.refresh(ctx.mainChatId);
      return { revision: value?.revision ?? 0, throughOrdinal: value?.throughOrdinal ?? 0 };
    }
    let sourceId = name === 'chat_recall' ? 'conversation' : name === 'project_memory' ? args.section : null;
    if (!sourceId || !sources[sourceId]) throw new ContextAccessError('UNKNOWN_TOOL', `Unknown context lookup ${name}.`);
    assertSourceAllowed(ctx.role, sourceId);
    targetFor(ctx.role, ctx, args);
    if(name==='project_memory'&&sourceId!=='minutes'&&ctx.role!=='global'&&!ctx.projectId)return {[sourceId]:[],note:'This conversation is not in a project.'};
    const sourceArgs = { ...args };
    if (ctx.role !== 'global') { delete sourceArgs.projectId; delete sourceArgs.chatId; }
    return sources[sourceId].read({ role: ctx.role, ctx }, sourceArgs);
  }
  return { call, catchUp: catchup.catchUp, overview, followUp: catchup.followUp, sources, sourceDescriptors, tools: sourceDescriptors };
}

export default { createContextAccess, createSourceRegistry, sourceDescriptors, SOURCE_MODULES };
