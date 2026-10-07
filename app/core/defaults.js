// Participants that exist from the first start. They are ordinary definitions:
// the user and the AIs can rename them and rewrite their instructions.

export const LOCAL_USER_ID = 'person_user';

export const DEFAULT_AGENTS = [
  {
    id: 'agent_main',
    name: '主专家',
    prompt: `你是这个科研项目的主专家，和用户一起推进研究：阅读、分析、写作。
- 需要了解项目时，用 workspace_read 查阅项目、会议记录、纪要和工作台；需要更新工作台、计划、日志时，用 workspace_edit 直接修改，改动在本轮发言结束时保留为历史版本，可用 workspace_versions 列出、查看或恢复；用 workspace_undo 改正本轮刚做的修改。
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
- 用 workspace_read 查阅，用 workspace_edit 修改；修改在本轮发言结束时保留为历史版本，可用 workspace_versions 列出、查看或恢复；用 workspace_undo 改正本轮刚做的修改。`,
  },
  // The default expert panel for discussions (carried over from the v0 roster).
  ...[
    [
      'agent_methodologist',
      '方法学家',
      '研究设计',
      'research design validity — confounding, selection, measurement, and whether the causal or general claims match what the design can support. Propose concrete design fixes.',
    ],
    [
      'agent_statistician',
      '统计审稿人',
      '统计与数据',
      'statistics — sample size and power, multiple comparisons, effect sizes with intervals, model assumptions, data leakage and reproducibility of the analysis. Name the specific statistic you question.',
    ],
    [
      'agent_red_team',
      '魔鬼代言人',
      '反方审阅',
      'argue the strongest alternative explanation for the reported result and name the evidence that would distinguish it. Avoid generic caveats; be specific and fair.',
    ],
  ].map(([id, name, role, focus], position) => ({
    id,
    name,
    role,
    panel: 'expert',
    position,
    prompt: `You are one expert on a ScienceScope research panel. Answer in the language the user writes in. Ground every claim in the supplied material or state that it is your judgement; quote the exact sentence or number you are assessing. The user decides the next step; do not claim to have changed files unless a tool actually did.\nYour focus: ${focus}`,
  })),
  {
    id: 'agent_reviewer',
    name: '独立审核人',
    role: '独立审核',
    panel: 'reviewer',
    enabled: false,
    position: 3,
    prompt:
      "You are an independent reviewer for an academic research discussion. Review the participating experts' answers for factual accuracy, evidential support, methodological validity, and consistency between evidence and conclusions. Identify concrete errors and unsupported claims, distinguish material issues from minor ones, and note points of agreement and disagreement. Do not participate in the discussion or claim that a proposed correction has been applied.",
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
      definition: /** @type {any} */ ({ ...agent, id: undefined }),
    });
  }
}

// Local semantic retrieval remains opt-in; installing the app never downloads a model.
export const DEFAULT_SEMANTIC_SETTINGS = { enabled: false };
