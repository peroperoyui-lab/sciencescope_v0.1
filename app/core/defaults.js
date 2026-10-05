// Participants that exist from the first start. They are ordinary definitions:
// the user and the AIs can rename them and rewrite their instructions.

export const LOCAL_USER_ID = 'person_user';

export const DEFAULT_AGENTS = [
  {
    id: 'agent_main',
    name: '主专家',
    prompt: `你是这个科研项目的主专家，和用户一起推进研究：阅读、分析、写作。
- 需要了解项目时，用 workspace_read 查阅项目、会议记录、纪要和工作台；需要更新工作台、计划、日志时，用 workspace_edit 直接修改，改动会进入更改记录，用户可以撤销。
- 写多少、怎么写由你判断：问题简单就简短，任务需要就完整。
- 有依据就给出处；不确定就说明不确定。`,
  },
  {
    id: 'agent_secretary',
    name: '任务秘书',
    prompt: `你是项目的任务秘书，跟随一场主对话，帮用户整理和推进：
- 维护这场会议的纪要：研究目标、已定结论及出处、被否定的方案、分歧与各方立场、文稿与文件状态、待办。用户修改过的纪要以用户为准。
- 按需更新工作台、计划和日志；帮用户为主专家起草下一步的指令。
- 用 workspace_read 查阅，用 workspace_edit 修改。`,
  },
  {
    id: 'agent_assistant',
    name: '全局助手',
    prompt: `你是 ScienceScope 的全局助手，不属于某一个项目，可以查阅和修改所有项目的数据：
- 回答关于各个项目进展的问题，帮用户在项目之间整理信息。
- 用 workspace_read 查阅，用 workspace_edit 修改；修改会进入更改记录，用户可以撤销。`,
  },
];

/**
 * Create the local user and the default AIs if they do not exist yet.
 * @param {{ db: import('./db/database.js').Db, participants: ReturnType<typeof import('./participants.js').createParticipants> }} deps
 */
export async function ensureDefaultParticipants({ db, participants }) {
  const exists = (id) => Boolean(db.prepare('SELECT 1 FROM participants WHERE id = ?').get(id));
  if (!exists(LOCAL_USER_ID)) {
    await participants.create({ id: LOCAL_USER_ID, kind: 'human', name: '我' });
  }
  for (const agent of DEFAULT_AGENTS) {
    if (exists(agent.id)) continue;
    await participants.create({
      id: agent.id,
      kind: 'ai',
      name: agent.name,
      definition: { prompt: agent.prompt },
    });
  }
}
