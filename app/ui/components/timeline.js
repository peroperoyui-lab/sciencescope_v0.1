// Activity timeline of one answer (design system ActivityTimeline): the
// model's words between calls, its thinking, retries of a failed request and
// one row per tool call, each opening to its details. Open while the answer
// runs; afterwards it folds into one summary line. Every call stays visible,
// failed ones with their reason.
import { useEffect, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { ApprovalRow } from './approval.js';
import { tokenAmount } from './discussion-usage.js';

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
TOOLS.list_files = (args) => ({
  icon: 'folder-open',
  verb: '列出文件',
  running: '正在列出文件',
  target: text(args?.pattern ?? args?.path),
  mono: true,
});
TOOLS.grep_files = TOOLS.grep;
TOOLS.shell = TOOLS.bash;
TOOLS.read_file = TOOLS.read;
TOOLS.write_file = TOOLS.write;
TOOLS.edit_file = TOOLS.edit;
TOOLS.fetch = TOOLS.web_fetch;

/** Tool calls proper; thinking and retries share the same activity list. @param {any} call */
export const isToolCall = (call) => (call.kind ?? 'tool') === 'tool';

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

/** One stretch of the model's thinking, opening to its text. @param {{ call: any, running: boolean }} props */
function ThinkingRow({ call, running }) {
  const [open, setOpen] = useState(false);
  const active = call.status === 'running' && running;
  const took =
    call.endedAt && call.startedAt
      ? duration(Date.parse(call.endedAt) - Date.parse(call.startedAt))
      : '';
  return html`<button
      type="button"
      class="ss-act__row"
      data-activity="thinking"
      aria-expanded=${open}
      onClick=${() => setOpen(!open)}
    >
      ${active ? html`<span class="ss-spin"></span>` : html`<${Lucide} name="lightbulb" />`}
      <span class="ss-act__verb"
        >${active ? t('正在思考') : took ? t('思考了 {time}', { time: took }) : t('思考')}</span
      >
      <${Lucide} name="chevron-right" class="ss-act__chev" />
    </button>
    ${open && html`<div class="ss-act__thinking">${typeof call.result === 'string' ? call.result : ''}</div>`}`;
}

/** A request that failed before any answer and is tried again. @param {{ call: any }} props */
function RetryRow({ call }) {
  const { attempt, maxAttempts, error } = call.result ?? {};
  return html`<div class="ss-act__row ss-act__row--warn" data-activity="retry">
    <${Lucide} name="refresh-cw" /><span class="ss-act__verb">${t('重试')}</span>
    ${error && html`<span class="ss-act__target ss-act__target--text">${error}</span>`}
    ${
      attempt &&
      html`<span class="ss-act__end">${t('第 {n}/{m} 次', { n: attempt, m: maxAttempts })}</span>`
    }
  </div>`;
}

/** The session context was summarised to make room. @param {{ call: any }} props */
function CompactionRow({ call }) {
  const { beforeTokens, afterTokens } = call.result ?? {};
  return html`<div class="ss-act__row ss-act__row--muted" data-activity="compaction">
    <${Lucide} name="fold-vertical" /><span class="ss-act__verb">${t('上下文已自动压缩')}</span>
    ${
      beforeTokens &&
      html`<span class="ss-act__end"
        >${t('{before} → {after} token', {
          before: tokenAmount(beforeTokens),
          after: tokenAmount(afterTokens),
        })}</span
      >`
    }
  </div>`;
}

/** @param {{ call: any, running: boolean, waiting: boolean }} props */
function ActivityRow({ call, running, waiting }) {
  if (call.kind === 'thinking') return html`<${ThinkingRow} call=${call} running=${running} />`;
  if (call.kind === 'retry') return html`<${RetryRow} call=${call} />`;
  if (call.kind === 'approval') return html`<${ApprovalRow} call=${call} />`;
  if (call.kind === 'compaction') return html`<${CompactionRow} call=${call} />`;
  return html`<${CallRow} call=${call} running=${running} waiting=${waiting} />`;
}

/** @param {{ call: any, running: boolean, waiting?: boolean }} props */
function CallRow({ call, running, waiting = false }) {
  const [open, setOpen] = useState(false);
  const shown = describeCall(call);
  // A call held for approval is not running yet; its card follows it.
  const held = call.status === 'running' && running && waiting;
  const active = call.status === 'running' && running && !waiting;
  const failed = call.status === 'failed';
  const unfinished = call.status === 'running' && !running;
  const end = failed
    ? t('失败')
    : unfinished
      ? t('未完成')
      : held
        ? t('等待批准')
        : active
          ? ''
          : call.result?.rejected
            ? t('已拒绝')
            : call.result?.cancelled
              ? t('已取消')
              : outcome(call.result);
  const tone = failed ? 'ss-act__row--fail' : unfinished ? 'ss-act__row--muted' : '';
  return html`${
      call.preamble &&
      html`<div
        class="ss-act__narr ss-prose"
        dangerouslySetInnerHTML=${{ __html: renderMarkdown(call.preamble) }}
      ></div>`
    }
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
  const tools = calls.filter(isToolCall);
  const failed = tools.filter((call) => call.status === 'failed').length;
  const retries = calls.filter((call) => call.kind === 'retry').length;
  const waiting = calls.some((call) => call.kind === 'approval' && call.status === 'pending');
  const started = turn?.startedAt ?? calls[0].startedAt;
  const ended = turn?.endedAt ?? calls.at(-1).endedAt;
  const parts = [];
  if (!running && started && ended)
    parts.push(t('用时 {time}', { time: duration(Date.parse(ended) - Date.parse(started)) }));
  if (tools.length) parts.push(t('{n} 个步骤', { n: tools.length }));
  else if (calls.some((call) => call.kind === 'thinking')) parts.push(t('已思考'));
  if (failed) parts.push(t('{n} 个失败', { n: failed }));
  if (retries) parts.push(t('重试 {n} 次', { n: retries }));
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
        ${calls.map((call) => html`<${ActivityRow} key=${call.id} call=${call} running=${running} waiting=${waiting} />`)}
      </div>`
    }
  </div>`;
}
