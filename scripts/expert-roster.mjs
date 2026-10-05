// Persisted expert panel. Stable ids are the execution identity; labels are
// display names only and may change. A null model means "use the chat's model".
const ID = /^[A-Za-z0-9_-]{1,80}$/u;
const SKILL_ID = /^[A-Za-z0-9_.-]{1,80}$/u;
const MAX_EXPERTS = 8;
const MAX_REVIEWERS = 8;
const DEFAULT_REVIEWER_ID = 'independent-reviewer';

export class ExpertRosterError extends Error {
  constructor(message) { super(message); this.code = 'INVALID_EXPERT_ROSTER'; this.status = 400; }
}

const shared = 'You are one expert on a ScienceScope research panel. Answer in the language the user writes in. Ground every claim in the supplied material or state that it is your judgement; quote the exact sentence or number you are assessing. The user decides the next step; do not claim to have changed files unless a tool actually did.';
export const DEFAULT_EXPERTS = Object.freeze([
  { id: 'methodologist', label: '方法学家', role: '研究设计', persona: `${shared}\nYour focus: research design validity — confounding, selection, measurement, and whether the causal or general claims match what the design can support. Propose concrete design fixes.` },
  { id: 'statistician', label: '统计审稿人', role: '统计与数据', persona: `${shared}\nYour focus: statistics — sample size and power, multiple comparisons, effect sizes with intervals, model assumptions, data leakage and reproducibility of the analysis. Name the specific statistic you question.` },
  { id: 'red-team', label: '魔鬼代言人', role: '反方审阅', persona: `${shared}\nYour focus: argue the strongest alternative explanation for the reported result and name the evidence that would distinguish it. Avoid generic caveats; be specific and fair.` },
]);

export const DEFAULT_INDEPENDENT_REVIEWER = Object.freeze({
  id: DEFAULT_REVIEWER_ID,
  label: '独立审核人',
  role: '独立审核',
  persona: 'You are an independent reviewer for an academic research discussion. Review the participating experts\' answers for factual accuracy, evidential support, methodological validity, and consistency between evidence and conclusions. Identify concrete errors and unsupported claims, distinguish material issues from minor ones, and note points of agreement and disagreement. Do not participate in the discussion or claim that a proposed correction has been applied.',
  kind: 'reviewer',
  skills: [],
  enabled: false,
});

function normalize(expert, position, enabledSkillIds) {
  if (!expert || typeof expert !== 'object' || Array.isArray(expert)) throw new ExpertRosterError('专家配置格式无效。');
  const { id, label, role = '', persona, model = null, reasoningEffort = null, enabled = true, kind = 'expert', skills = [] } = expert;
  if (typeof id !== 'string' || !ID.test(id)) throw new ExpertRosterError('专家标识只能包含字母、数字、下划线和短横线。');
  if (typeof label !== 'string' || !label.trim() || label.length > 40) throw new ExpertRosterError('专家名称须为 1–40 个字符。');
  if (typeof role !== 'string' || role.length > 40) throw new ExpertRosterError('专家职责标签不能超过 40 个字符。');
  if (typeof persona !== 'string' || !persona.trim()) throw new ExpertRosterError('专家提示词须为非空文本。');
  if (Buffer.byteLength(persona,'utf8') > 64 * 1024 * 1024) {
    const error = new ExpertRosterError('专家提示词超过 64 MiB 资源上限；本次未保存，已有专家配置保持完整。');
    error.code = 'EXPERT_PROMPT_RESOURCE_LIMIT'; error.status = 413; throw error;
  }
  if (model !== null && (typeof model?.providerId !== 'string' || !model.providerId || typeof model?.modelId !== 'string' || !model.modelId)) throw new ExpertRosterError('专家模型无效。');
  if (reasoningEffort !== null && (typeof reasoningEffort !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/u.test(reasoningEffort))) throw new ExpertRosterError('专家推理强度无效。');
  if (kind !== 'expert' && kind !== 'reviewer') throw new ExpertRosterError('专家类型只能是参加专家或独立审核。');
  if (!Array.isArray(skills) || skills.some((skill) => typeof skill !== 'string' || !SKILL_ID.test(skill))) throw new ExpertRosterError('技能列表格式无效。');
  if (new Set(skills).size !== skills.length) throw new ExpertRosterError('技能不能重复绑定。');
  if (skills.some((skill) => !enabledSkillIds.has(skill))) throw new ExpertRosterError('绑定的技能不存在或未启用，请刷新后重试。');
  return {
    id,
    label: label.trim(),
    role: role.trim(),
    persona,
    model: model && { providerId: model.providerId, modelId: model.modelId },
    reasoningEffort,
    enabled: enabled !== false,
    kind,
    skills: [...skills],
    position,
  };
}

export function createExpertRoster({ db }) {
  db.exec(`CREATE TABLE IF NOT EXISTS experts(id TEXT PRIMARY KEY, label TEXT NOT NULL, role TEXT NOT NULL, persona TEXT NOT NULL, model_json TEXT, reasoning_effort TEXT, enabled INTEGER NOT NULL, position INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS expert_roster_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const columns = new Set(db.prepare('PRAGMA table_info(experts)').all().map((column) => column.name));
  if (!columns.has('kind')) db.exec("ALTER TABLE experts ADD COLUMN kind TEXT NOT NULL DEFAULT 'expert'");
  if (!columns.has('skills_json')) db.exec("ALTER TABLE experts ADD COLUMN skills_json TEXT NOT NULL DEFAULT '[]'");

  const getState = (key) => db.prepare('SELECT value FROM expert_roster_state WHERE key=?').get(key);
  const markState = (key) => db.prepare('INSERT OR REPLACE INTO expert_roster_state(key,value) VALUES(?,\'1\')').run(key);
  const write = (experts) => {
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM experts').run();
      const insert = db.prepare('INSERT INTO experts(id,label,role,persona,model_json,reasoning_effort,enabled,position,updated_at,kind,skills_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
      for (const e of experts) insert.run(e.id, e.label, e.role, e.persona, e.model ? JSON.stringify(e.model) : null, e.reasoningEffort, e.enabled ? 1 : 0, e.position, now, e.kind, JSON.stringify(e.skills));
      markState('seeded');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };

  // Seed the original participant roster once. The independent-reviewer seed
  // has its own marker so deleting it never causes it to reappear on restart.
  if (!getState('seeded')) {
    const existing = db.prepare('SELECT COUNT(*) AS count FROM experts').get().count;
    if (existing === 0) write(DEFAULT_EXPERTS.map((expert, position) => normalize(expert, position, new Set())));
    else markState('seeded');
  }
  if (!getState('independent-reviewer-seeded')) {
    const collision = db.prepare('SELECT id FROM experts WHERE id=?').get(DEFAULT_REVIEWER_ID);
    if (!collision) {
      const position = db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS position FROM experts WHERE kind='reviewer'").get().position;
      const reviewer = normalize(DEFAULT_INDEPENDENT_REVIEWER, position, new Set());
      const now = new Date().toISOString();
      db.prepare('INSERT INTO experts(id,label,role,persona,model_json,reasoning_effort,enabled,position,updated_at,kind,skills_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(reviewer.id, reviewer.label, reviewer.role, reviewer.persona, null, null, 0, reviewer.position, now, reviewer.kind, JSON.stringify(reviewer.skills));
    }
    // A pre-existing user row with the reserved default id is left untouched;
    // mark the attempt so it can never be overwritten or recreated later.
    markState('independent-reviewer-seeded');
  }

  const list = () => db.prepare('SELECT * FROM experts ORDER BY kind, position, id').all().map((row) => ({
    id: row.id,
    label: row.label,
    role: row.role,
    persona: row.persona,
    model: row.model_json ? JSON.parse(row.model_json) : null,
    reasoningEffort: row.reasoning_effort,
    enabled: row.enabled === 1,
    position: row.position,
    kind: row.kind || 'expert',
    skills: row.skills_json ? JSON.parse(row.skills_json) : [],
  }));

  function resolve(ids) {
    const roster = list();
    if (!Array.isArray(ids) || !ids.length) throw new ExpertRosterError('请至少选择一位专家。');
    if (new Set(ids).size !== ids.length) throw new ExpertRosterError('专家不能重复选择。');
    const unknown = ids.filter((id) => !roster.some((expert) => expert.id === id));
    if (unknown.length) throw new ExpertRosterError('所选专家不存在或已被移除，请刷新后重试。');
    // Display (and result) order always follows the roster, not the request.
    return roster.filter((expert) => ids.includes(expert.id));
  }

  return {
    list,
    save(experts, { enabledSkillIds = [] } = {}) {
      if (!Array.isArray(enabledSkillIds) || enabledSkillIds.some((skill) => typeof skill !== 'string' || !SKILL_ID.test(skill))) throw new ExpertRosterError('可用技能列表格式无效。');
      const enabled = new Set(enabledSkillIds);
      if (!Array.isArray(experts)) throw new ExpertRosterError('专家列表格式无效。');
      const normalized = experts.map((expert, position) => normalize(expert, position, enabled));
      if (new Set(normalized.map((expert) => expert.id)).size !== normalized.length) throw new ExpertRosterError('专家标识不能重复。');
      const expertsCount = normalized.filter((expert) => expert.kind === 'expert').length;
      const reviewersCount = normalized.length - expertsCount;
      if (expertsCount > MAX_EXPERTS) throw new ExpertRosterError(`参加专家须为 0–${MAX_EXPERTS} 位。`);
      if (reviewersCount > MAX_REVIEWERS) throw new ExpertRosterError(`独立审核须为 0–${MAX_REVIEWERS} 位。`);
      write(normalized);
      return list();
    },
    resolve,
    resolveParticipants(ids) {
      const selected = resolve(ids);
      if (selected.some((expert) => expert.kind === 'reviewer')) throw new ExpertRosterError('独立审核专家不能作为作答参加者。');
      if (selected.some((expert) => !expert.enabled)) throw new ExpertRosterError('所选专家已停用，请刷新后重试。');
      if (selected.length > MAX_EXPERTS) throw new ExpertRosterError(`参加专家须为 1–${MAX_EXPERTS} 位。`);
      return selected;
    },
    resolveReviewer(id) {
      const [reviewer] = resolve([id]);
      if (!reviewer.enabled) throw new ExpertRosterError('所选审核专家已停用，请刷新后重试。');
      return reviewer;
    },
  };
}
