// Persisted expert panel. Stable ids are the execution identity; labels are
// display names only and may change. A null model means "use the chat's model".
const ID = /^[A-Za-z0-9_-]{1,80}$/u;
const MAX_EXPERTS = 8;

export class ExpertRosterError extends Error {
  constructor(message) { super(message); this.code = 'INVALID_EXPERT_ROSTER'; this.status = 400; }
}

const shared = 'You are one expert on a ScienceScope research panel. Answer in the language the user writes in. Ground every claim in the supplied material or state that it is your judgement; quote the exact sentence or number you are assessing. The user decides the next step; do not claim to have changed files unless a tool actually did.';
export const DEFAULT_EXPERTS = Object.freeze([
  { id: 'methodologist', label: '方法学家', role: '研究设计', persona: `${shared}\nYour focus: research design validity — confounding, selection, measurement, and whether the causal or general claims match what the design can support. Propose concrete design fixes.` },
  { id: 'statistician', label: '统计审稿人', role: '统计与数据', persona: `${shared}\nYour focus: statistics — sample size and power, multiple comparisons, effect sizes with intervals, model assumptions, data leakage and reproducibility of the analysis. Name the specific statistic you question.` },
  { id: 'red-team', label: '魔鬼代言人', role: '反方审阅', persona: `${shared}\nYour focus: argue the strongest alternative explanation for the reported result and name the evidence that would distinguish it. Avoid generic caveats; be specific and fair.` },
]);

function normalize(expert, position) {
  if (!expert || typeof expert !== 'object') throw new ExpertRosterError('专家配置格式无效。');
  const { id, label, role = '', persona, model = null, reasoningEffort = null, enabled = true } = expert;
  if (typeof id !== 'string' || !ID.test(id)) throw new ExpertRosterError('专家标识只能包含字母、数字、下划线和短横线。');
  if (typeof label !== 'string' || !label.trim() || label.length > 40) throw new ExpertRosterError('专家名称须为 1–40 个字符。');
  if (typeof role !== 'string' || role.length > 40) throw new ExpertRosterError('专家职责标签不能超过 40 个字符。');
  if (typeof persona !== 'string' || !persona.trim() || persona.length > 16000) throw new ExpertRosterError('专家提示词须为 1–16000 个字符。');
  if (model !== null && (typeof model?.providerId !== 'string' || !model.providerId || typeof model?.modelId !== 'string' || !model.modelId)) throw new ExpertRosterError('专家模型无效。');
  if (reasoningEffort !== null && (typeof reasoningEffort !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/u.test(reasoningEffort))) throw new ExpertRosterError('专家推理强度无效。');
  return { id, label: label.trim(), role: role.trim(), persona, model: model && { providerId: model.providerId, modelId: model.modelId }, reasoningEffort, enabled: enabled !== false, position };
}

export function createExpertRoster({ db }) {
  db.exec(`CREATE TABLE IF NOT EXISTS experts(id TEXT PRIMARY KEY, label TEXT NOT NULL, role TEXT NOT NULL, persona TEXT NOT NULL, model_json TEXT, reasoning_effort TEXT, enabled INTEGER NOT NULL, position INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS expert_roster_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const seeded = db.prepare("SELECT value FROM expert_roster_state WHERE key='seeded'").get();
  const write = (experts) => {
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM experts').run();
      const insert = db.prepare('INSERT INTO experts VALUES(?,?,?,?,?,?,?,?,?)');
      for (const e of experts) insert.run(e.id, e.label, e.role, e.persona, e.model ? JSON.stringify(e.model) : null, e.reasoningEffort, e.enabled ? 1 : 0, e.position, now);
      db.prepare("INSERT OR REPLACE INTO expert_roster_state VALUES('seeded','1')").run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  // Seed once; a user who deletes every expert keeps an empty roster.
  if (!seeded) write(DEFAULT_EXPERTS.map((e, i) => normalize(e, i)));
  const list = () => db.prepare('SELECT * FROM experts ORDER BY position, id').all().map((row) => ({
    id: row.id, label: row.label, role: row.role, persona: row.persona,
    model: row.model_json ? JSON.parse(row.model_json) : null, reasoningEffort: row.reasoning_effort, enabled: row.enabled === 1, position: row.position,
  }));
  return {
    list,
    save(experts) {
      if (!Array.isArray(experts) || experts.length > MAX_EXPERTS) throw new ExpertRosterError(`专家数量须为 0–${MAX_EXPERTS} 位。`);
      const normalized = experts.map(normalize);
      if (new Set(normalized.map((e) => e.id)).size !== normalized.length) throw new ExpertRosterError('专家标识不能重复。');
      write(normalized);
      return list();
    },
    resolve(ids) {
      const roster = list();
      if (!Array.isArray(ids) || !ids.length) throw new ExpertRosterError('请至少选择一位专家。');
      const unknown = ids.filter((id) => !roster.some((e) => e.id === id));
      if (unknown.length) throw new ExpertRosterError('所选专家不存在或已被移除，请刷新后重试。');
      // Display (and result) order always follows the roster, not the request.
      return roster.filter((e) => ids.includes(e.id));
    },
  };
}
