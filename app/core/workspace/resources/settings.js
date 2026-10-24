// All settings in one readable JSON file. Reading merges stored values over the
// defaults, so new settings appear without a migration.
import { AppError } from '../../errors.js';
import { DEFAULT_SEMANTIC_SETTINGS } from '../../defaults.js';

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  profile: { name: '', bio: '' },
  appearance: {
    language: 'zh',
    theme: 'light',
    density: 'standard',
    font: '',
    codeFontSize: 14,
    // Main chat text; side panels and the left sidebar use sideFontSize.
    chatFontSize: 14,
    // Line height of chat text as a multiple of its size; paragraphs follow it.
    chatLineHeight: 1.6,
    sideFontSize: 14,
    reduceMotion: false,
    scrollbars: false,
    // 'compact' hides tool activity cards in meetings (视图 → 简洁执行记录).
    transcript: 'full',
    // Widths of the right-side panels, set by dragging their edge.
    panels: { secretary: 360, assistant: 360 },
    // Where the knowledge page opens: 'global' knowledge base or the current
    // project's 'project' database; the last choice is kept.
    knowledgeScope: 'global',
    // The knowledge base as a 'table' (lists) or a 'graph'; the last choice is kept.
    knowledgeView: 'table',
  },
  // Window shortcuts, recorded in Settings → 快捷键.
  shortcuts: {
    search: 'Ctrl+K',
    browse: 'Ctrl+Shift+K',
    newChat: 'Ctrl+N',
    independentChat: 'Ctrl+Alt+N',
  },
  composer: { sendKey: 'enter', hideWindowOnScreenshot: true },
  // Native launch visibility; ordinary browsers continue to use the panel.
  assistant: { startup: 'closed' },
  // Native update checks persist their attempt time, including failed checks.
  updates: { autoCheck: true, lastCheckedAt: null },
  // Download sources the person added in Settings → Python 环境, as { name, url }.
  python: {
    defaultEnvironment: null,
    indexUrl: null,
    installMirror: null,
    customIndexes: [],
    customInstallMirrors: [],
  },
  // Academic sites on the welcome page.
  sites: [
    { name: 'Elsevier', url: 'https://www.sciencedirect.com' },
    { name: 'WOS', url: 'https://www.webofscience.com' },
    { name: 'CNKI', url: 'https://www.cnki.net' },
    { name: '万方数据', url: 'https://www.wanfangdata.com.cn' },
    { name: 'Springer', url: 'https://link.springer.com' },
  ],
  // Provider API keys and header values are stored separately. The host injects
  // the credential preparation at the resource boundary before recording edits.
  providers: [],
  // The model AIs use unless their own definition names one.
  models: { default: null },
  context: { compactPercent: 80 },
  // defaultApproval: the execution mode a new chat starts in ('ask' or 'auto').
  approvals: { rules: [], defaultApproval: 'ask' },
  skills: { disabled: [] },
  mcp: { servers: [], npmRegistry: null },
  semantic: DEFAULT_SEMANTIC_SETTINGS,
  knowledge: {
    retrievalExpansion: true,
    similarity: { threshold: 0.85, maxPerPaper: 3 },
    cards: { enabled: true, model: null },
  },
  desk: { tiers: ['草稿', '内部审阅', '投稿', '修回', '终稿'], tex: { engine: 'auto' } },
  // Features still being built; each turns on once its checks pass.
  features: { editingDesk: false },
  // A cumulative input/output cost budget; null turns the budget off.
  memory: { enabled: true, idleMinutes: 10, model: null, tokenLimit: 100000 },
  // Summary thresholds trigger work; they never truncate the meeting record.
  summary: {
    afterDiscussion: true,
    everyMessages: { enabled: true, n: 20 },
    everyTokens: { enabled: true, n: 30000 },
    onEnterProject: true,
    onLeaveProject: true,
    workbench: { map: 'off', plans: 'off', log: 'off', versions: 'off' },
  },
  versionNotes: {
    template:
      '# 版本说明\n## 比较对象\n## 实际文件变化\n## 秘书的解释：与当前研究的关系\n## 待用户决定的建议\n## 相关导图节点与文件',
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Deep merge where `patch` wins; arrays and scalars replace. */
export function mergeSettings(base, patch) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    result[key] =
      isPlainObject(value) && isPlainObject(base[key]) ? mergeSettings(base[key], value) : value;
  }
  return result;
}

/** @param {string | null} text */
function parse(text) {
  return mergeSettings(DEFAULT_SETTINGS, text == null ? {} : JSON.parse(text));
}

function format(value) {
  if (typeof value.knowledge?.retrievalExpansion !== 'boolean')
    throw new AppError('INVALID_RETRIEVAL_EXPANSION', '知识图检索扩展设置必须为开启或关闭。');
  if (!['ask', 'auto'].includes(value.approvals?.defaultApproval))
    throw new AppError('INVALID_DEFAULT_APPROVAL', '新对话默认的执行方式只能是请求批准或常规。');
  if (!['auto', 'xelatex', 'lualatex', 'pdflatex'].includes(value.desk?.tex?.engine))
    throw new AppError('INVALID_TEX_ENGINE', '请选择自动或已支持的 TeX 引擎。');
  for (const server of value.mcp.servers)
    for (const field of ['env', 'headers'])
      if (Object.values(server[field] ?? {}).some((entry) => !entry?.keyRef))
        throw new AppError('MCP_CREDENTIAL', '请通过 MCP 服务器接口保存凭据。');
  const percent = value.context?.compactPercent;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 50 || percent > 95)
    throw new AppError(
      'INVALID_COMPACTION_PERCENT',
      'context.compactPercent must be between 50 and 95.',
    );
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const settings = {
  name: 'settings',
  ops: ['write', 'patch', 'add-approval-rule', 'put-mcp-server', 'remove-mcp-server'],
  /** @param {import('../workspace.js').Locate} locate */
  file: (locate) => locate.paths.settings,
  /**
   * @param {string | null} text
   * @param {string} op
   * @param {any} args
   */
  apply(text, op, args) {
    if (op === 'put-mcp-server' || op === 'remove-mcp-server') {
      const current = parse(text);
      const id = args.server?.id ?? args.id;
      const index = current.mcp.servers.findIndex((entry) => entry.id === id);
      // An edited server keeps its place in the list; a new one goes last.
      if (op === 'put-mcp-server' && index < 0) current.mcp.servers.push(args.server);
      else if (op === 'put-mcp-server') current.mcp.servers[index] = args.server;
      else if (index >= 0) current.mcp.servers.splice(index, 1);
      return format(current);
    }
    if (op === 'add-approval-rule') {
      const current = parse(text);
      const rule = args.rule;
      if (
        !current.approvals.rules.some(
          (saved) =>
            saved.projectId === rule.projectId &&
            saved.meetingId === rule.meetingId &&
            saved.tool === rule.tool &&
            saved.kind === rule.kind &&
            saved.value === rule.value,
        )
      )
        current.approvals = { ...current.approvals, rules: [...current.approvals.rules, rule] };
      return format(current);
    }
    if (op === 'write') return format(mergeSettings(DEFAULT_SETTINGS, args.settings));
    if (op === 'patch') return format(mergeSettings(parse(text), args.changes));
    throw new AppError('UNKNOWN_OP', `不支持的操作：${op}`);
  },
  parse,
};
