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
  python: { defaultEnvironment: null, indexUrl: null, installMirror: null },
  // Academic sites on the welcome page.
  sites: [
    { name: 'Elsevier', url: 'https://www.sciencedirect.com' },
    { name: 'WOS', url: 'https://www.webofscience.com' },
    { name: 'CNKI', url: 'https://www.cnki.net' },
    { name: '万方数据', url: 'https://www.wanfangdata.com.cn' },
    { name: 'Springer', url: 'https://link.springer.com' },
  ],
  // Model providers (keys are stored separately, see services/providers.js).
  providers: [],
  // The model AIs use unless their own definition names one.
  models: { default: null },
  context: { compactPercent: 80 },
  approvals: { rules: [] },
  semantic: DEFAULT_SEMANTIC_SETTINGS,
  // A cumulative input/output cost budget; null turns the budget off.
  memory: { enabled: true, idleMinutes: 10, model: null, tokenLimit: 100000 },
  // Summary thresholds trigger work; they never truncate the meeting record.
  summary: {
    afterDiscussion: true,
    everyMessages: { enabled: true, n: 20 },
    everyTokens: { enabled: true, n: 30000 },
    onEnterProject: true,
    onLeaveProject: true,
    saveMarkdown: true,
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
  ops: ['write', 'patch', 'add-approval-rule'],
  /** @param {import('../workspace.js').Locate} locate */
  file: (locate) => locate.paths.settings,
  /**
   * @param {string | null} text
   * @param {string} op
   * @param {any} args
   */
  apply(text, op, args) {
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
