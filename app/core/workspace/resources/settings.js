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
    chatFontSize: 16,
    reduceMotion: false,
    scrollbars: false,
    // 'compact' hides tool activity cards in meetings (视图 → 简洁执行记录).
    transcript: 'full',
  },
  // Window shortcuts, recorded in Settings → 快捷键.
  shortcuts: {
    search: 'Ctrl+K',
    browse: 'Ctrl+Shift+K',
    newChat: 'Ctrl+N',
    independentChat: 'Ctrl+Alt+N',
  },
  composer: { sendKey: 'enter' },
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
  semantic: DEFAULT_SEMANTIC_SETTINGS,
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
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const settings = {
  name: 'settings',
  ops: ['write', 'patch'],
  /** @param {import('../workspace.js').Locate} locate */
  file: (locate) => locate.paths.settings,
  /**
   * @param {string | null} text
   * @param {string} op
   * @param {any} args
   */
  apply(text, op, args) {
    if (op === 'write') return format(mergeSettings(DEFAULT_SETTINGS, args.settings));
    if (op === 'patch') return format(mergeSettings(parse(text), args.changes));
    throw new AppError('UNKNOWN_OP', `不支持的操作：${op}`);
  },
  parse,
};
