import { stableHash, MAX_OVERVIEW_CHATS, MAX_OVERVIEW_PROJECTS, databaseOf, workbenchFacade } from './_shared.mjs';
import { createStatusSource } from './status.mjs';

export const id = 'workspace';
export const sections = Object.freeze(['overview']);
export const describe = (_role) => 'Read a bounded overview of recently active projects. Use project_memory/chat_recall for detail.';

export function createWorkspaceSource(deps) {
  const database = databaseOf(deps);
  const facade = deps.facade ?? workbenchFacade({ db: deps.db, workbench: deps.workbench });
  const status = createStatusSource({ ...deps, facade });
  return { id, sections, describe, async read(scope, args = {}) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const assistantTable = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='assistant_conversations'").get());
    const temporaryColumn = ['temporary', 'is_temporary', 'temporary_flag'].find((name) => new Set(database.prepare('PRAGMA table_info(chats)').all().map((column) => column.name)).has(name));
    const visible = `${temporaryColumn ? `AND COALESCE(c."${temporaryColumn}",0)=0` : ''} ${assistantTable ? "AND NOT EXISTS (SELECT 1 FROM assistant_conversations a WHERE a.chat_id=c.id)" : ''}`;
    const projects = database.prepare(`SELECT p.id,p.name,p.description,p.archived,MAX(c.updated) AS latest_updated
      FROM projects p LEFT JOIN chats c ON c.project_id=p.id AND c.deleted_at IS NULL ${visible}
      GROUP BY p.id ORDER BY latest_updated IS NULL, latest_updated DESC, p.id`).all();
    const rows = [];
    for (const project of projects) {
      const chats = database.prepare(`SELECT c.id,c.title,c.updated,c.message_count FROM chats c
        WHERE c.project_id=? AND c.deleted_at IS NULL
          ${visible}
        ORDER BY c.updated DESC LIMIT ?`).all(project.id, MAX_OVERVIEW_CHATS);
      const latest = chats[0]?.updated ?? null;
      if (query && !`${project.name} ${project.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && !database.prepare(`SELECT 1 FROM chats c WHERE c.project_id=? AND c.deleted_at IS NULL ${visible} AND c.title LIKE ? LIMIT 1`).get(project.id, `%${query}%`)) continue;
      const targetScope = { role: 'global', ctx: {}, args: { projectId: project.id, ...(chats[0] ? { chatId: chats[0].id } : {}) } };
      const state = await status.read(targetScope, targetScope.args);
      const work = await facade.get(project.id);
      const memo=chats[0]?deps.minutes.get(chats[0].id):null;
      const goals=String(memo?.text||'').split(/\r?\n/).slice(0,6).join('\n');
      rows.push({ projectId: project.id, projectName: project.name, folder: work.folder, updated: latest, minutes: { goals:goals.slice(0,300),todos:state.minutesTodos.slice(0,300),summaryOnly:true }, pendingPlanCount: state.pendingPlans.length, map: { completed: state.map.nodes.filter((node) => ['done', 'completed', 'complete','已完成'].includes(String(node.status).toLowerCase())).length, total: state.map.nodes.length }, latestVersion: state.latestVersion?{name:state.latestVersion.name,status:state.latestVersion.status}:null, recentChats: chats.map((chat) => ({ chatId: chat.id, title: chat.title.slice(0,160), updated: chat.updated, messageCount: chat.message_count })) });
      if (rows.length >= MAX_OVERVIEW_PROJECTS) break;
    }
    const independentChats = database.prepare(`SELECT c.id,c.title,c.updated,c.message_count FROM chats c
      WHERE c.project_id IS NULL AND c.deleted_at IS NULL ${visible}
      ${query ? 'AND c.title LIKE ?' : ''} ORDER BY c.updated DESC LIMIT ?`).all(...(query ? [`%${query}%`, MAX_OVERVIEW_PROJECTS] : [MAX_OVERVIEW_PROJECTS]));
    const result = { projects: rows, independentChats: independentChats.map((chat) => ({ chatId: chat.id, title: chat.title, updated: chat.updated, messageCount: chat.message_count })), query: query || undefined, note: 'Overview is bounded; use workspace_overview({query}) or project_memory/chat_recall for details.' };
    return { ...result, hash: stableHash(result) };
  } };
}
export default { id, sections, describe, create: createWorkspaceSource };
