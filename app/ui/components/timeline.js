// Activity timeline of one answer (design system ActivityTimeline): the
// model's words between calls and one row per tool call, each opening to its
// details. Open while the answer runs; afterwards it folds into one summary
// line. Every call stays visible, failed ones with their reason.
import { useEffect, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

const RESOURCE_NAMES = {
  map: '导图',
  plans: '计划',
  log: '日志',
  minutes: '纪要',
  notes: '笔记',
  agent: '专家设定',
  settings: '设置',
  versions: '文献版本',
  overview: '全部项目',
  project: '项目',
  meeting: '对话记录',
  changes: '最近改动',
};

/** @param {string} key */
const resource = (key) => (RESOURCE_NAMES[key] ? t(RESOURCE_NAMES[key]) : (key ?? ''));
/** @param {any} value */
const text = (value) => (value == null ? '' : String(value));

/**
 * How each tool reads in the timeline: icon, verb (done and running), what
 * it acted on, and whether that is a path or command (mono) or plain words.
 * @type {Record<string, (args: any) => { icon: string, verb: string, running: string, target?: string, mono?: boolean }>}
 */
const TOOLS = {
  workspace_read: (args) => ({
    icon: 'file-search',
    verb: '读取',
    running: '正在读取',
    target: resource(args?.target),
  }),
  workspace_edit: (args) => ({
    icon: 'file-pen',
    verb: '修改',
    running: '正在修改',
    target: resource(args?.resource),
  }),
  workspace_undo: () => ({ icon: 'undo-2', verb: '撤销改动', running: '正在撤销改动' }),
  workspace_versions: (args) =>
    args?.action === 'restore'
      ? { icon: 'history', verb: '恢复历史版本', running: '正在恢复历史版本' }
      : { icon: 'history', verb: '查看历史版本', running: '正在查看历史版本' },
  workspace_present: (args) => ({
    icon: 'file-text',
    verb: '展示文件',
    running: '正在展示文件',
    target: (args?.files ?? []).map((file) => file.path).join('、'),
    mono: true,
  }),
  research_search: (args) => ({
    icon: 'text-search',
    verb: '搜索资料库',
    running: '正在搜索资料库',
    target: text(args?.query),
  }),
  research_read: (args) => ({
    icon: 'book-open',
    verb: '读取资料',
    running: '正在读取资料',
    target: text(args?.label ?? args?.id),
  }),
  python_env_install: (args) => ({
    icon: 'package',
    verb: '安装 Python 包',
    running: '正在安装 Python 包',
    target: (args?.packages ?? []).join(' '),
    mono: true,
  }),
  propose_main_draft: () => ({
    icon: 'square-pen',
    verb: '起草主对话指令',
    running: '正在起草主对话指令',
  }),
  goal_update: (args) => ({
    icon: 'list-checks',
    verb: args?.status === 'blocked' ? '报告目标受阻' : '报告目标完成',
    running: '正在更新目标',
  }),
  // Runtime tools (shell, files, web).
  bash: (args) => ({
    icon: 'square-terminal',
    verb: '运行命令',
    running: '正在运行命令',
    target: text(args?.command),
    mono: true,
  }),
  read: (args) => ({
    icon: 'file-search',
    verb: '读取文件',
    running: '正在读取文件',
    target: text(args?.path ?? args?.file_path),
    mono: true,
  }),
  write: (args) => ({
    icon: 'file-pen',
    verb: '写入文件',
    running: '正在写入文件',
    target: text(args?.path ?? args?.file_path),
    mono: true,
  }),
  edit: (args) => ({
    icon: 'file-diff',
    verb: '修改文件',
    running: '正在修改文件',
    target: text(args?.path ?? args?.file_path),
    mono: true,
  }),
  grep: (args) => ({
    icon: 'text-search',
    verb: '搜索内容',
    running: '正在搜索内容',
    target: text(args?.pattern),
    mono: true,
  }),
  web_fetch: (args) => ({
    icon: 'globe',
    verb: '读取网页',
    running: '正在读取网页',
    target: text(args?.url),
    mono: true,
  }),
};
TOOLS.shell = TOOLS.bash;
TOOLS.read_file = TOOLS.read;
TOOLS.write_file = TOOLS.write;
TOOLS.edit_file = TOOLS.edit;
TOOLS.fetch = TOOLS.web_fetch;

/** @param {any} call */
export function describeCall(call) {
  const known = TOOLS[call.name]?.(call.args);
  return known ?? { icon: 'wrench', verb: '使用工具', running: '正在使用工具', target: '' };
}

/** A short outcome for the end of a row: "8 条", "26 行". @param {any} result */
function outcome(result) {
  if (Array.isArray(result)) return t('{n} 条', { n: result.length });
  if (result && typeof result === 'object') {
    for (const key of ['results', 'items', 'hits', 'passages', 'matches']) {
      if (Array.isArray(result[key])) return t('{n} 条', { n: result[key].length });
    }
  }
  if (typeof result === 'string' && result.includes('\n'))
    return t('{n} 行', { n: result.split('\n').length });
  return '';
}

/** @param {any} value */
const pretty = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

/** "6 秒", "2 分 5 秒". @param {number} ms */
export function duration(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return t('{n} 秒', { n: seconds });
  return t('{m} 分 {s} 秒', { m: Math.floor(seconds / 60), s: seconds % 60 });
}

/** @param {{ call: any, running: boolean }} props */
function CallRow({ call, running }) {
  const [open, setOpen] = useState(false);
  const shown = describeCall(call);
  const active = call.status === 'running' && running;
  const failed = call.status === 'failed';
  const unfinished = call.status === 'running' && !running;
  const end = failed ? t('失败') : unfinished ? t('未完成') : active ? '' : outcome(call.result);
  const tone = failed ? 'ss-act__row--fail' : unfinished ? 'ss-act__row--muted' : '';
  return html`${call.preamble && html`<p class="ss-act__narr">${call.preamble}</p>`}
    <button
      type="button"
      class=${`ss-act__row ${tone}`}
      data-tool-call=${call.id}
      data-status=${call.status}
      aria-expanded=${open}
      onClick=${() => setOpen(!open)}
    >
      ${active ? html`<span class="ss-spin"></span>` : html`<${Lucide} name=${shown.icon} />`}
      <span class="ss-act__verb">${t(active ? shown.running : shown.verb)}</span>
      ${
        shown.target &&
        html`<span class=${`ss-act__target ${shown.mono ? '' : 'ss-act__target--text'}`}
          >${shown.target}</span
        >`
      }
      ${end && html`<span class="ss-act__end">${end}</span>`}
      <${Lucide} name="chevron-right" class="ss-act__chev" />
    </button>
    ${
      open &&
      html`<div class="ss-act__detail">
        <div class="ss-act__detail-head"><span class="ss-mono">${call.name}</span></div>
        <pre>${pretty(call.args)}</pre>
        ${
          call.result != null &&
          html`<div class="ss-act__detail-head"><span>${failed ? t('错误') : t('结果')}</span></div>
            <pre>${pretty(call.result)}</pre>`
        }
      </div>`
    }`;
}

/**
 * @param {{ calls: any[], running: boolean, turn?: any }} props
 */
export function ActivityTimeline({ calls, running, turn }) {
  /** @type {[boolean | null, (open: boolean | null) => void]} */
  const [chosen, setChosen] = useState(null);
  // Folding happens when the answer ends; an earlier choice does not survive it.
  useEffect(() => {
    if (!running) setChosen(null);
  }, [running]);
  if (!calls.length) return null;
  const open = chosen ?? running;
  const failed = calls.filter((call) => call.status === 'failed').length;
  const started = turn?.startedAt ?? calls[0].startedAt;
  const ended = turn?.endedAt ?? calls.at(-1).endedAt;
  const parts = [];
  if (!running && started && ended)
    parts.push(t('用时 {time}', { time: duration(Date.parse(ended) - Date.parse(started)) }));
  parts.push(t('{n} 个步骤', { n: calls.length }));
  if (failed) parts.push(t('{n} 个失败', { n: failed }));
  return html`<div class="ss-act" data-turn-activity data-running=${running || undefined}>
    ${
      !running &&
      html`<button
        type="button"
        class="ss-act__summary"
        aria-expanded=${open}
        onClick=${() => setChosen(!open)}
      >
        ${parts.join(' · ')}<${Lucide} name="chevron-down" />
      </button>`
    }
    ${
      open &&
      html`<div class="ss-act__list">
        ${calls.map((call) => html`<${CallRow} key=${call.id} call=${call} running=${running} />`)}
      </div>`
    }
  </div>`;
}
