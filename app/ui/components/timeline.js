// Activity timeline of one answer (design system ActivityTimeline): the
// model's words between calls, its thinking, retries of a failed request and
// one row per tool call, each opening to its details. Consecutive calls of one
// kind share a row (运行了 6 条命令), and an approval is the status of the call
// it held, not a row of its own. Open while the answer runs; afterwards it
// folds into one summary line. Every call stays reachable, failed ones with
// their reason.
import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { ApprovalCard, ApprovalRow } from './approval.js';
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
 * it acted on, whether that is a path or command (mono) or plain words, and
 * how a run of such calls is summed up (group).
 * @type {Record<string, (args: any, call: any) => { icon: string, verb: string, running: string, group?: string, target?: string, mono?: boolean }>}
 */
const TOOLS = {
  workspace_read: (args) => ({
    icon: 'file-search',
    verb: '读取',
    running: '正在读取',
    group: '读取了 {n} 项',
    target: resource(args?.target),
  }),
  workspace_edit: (args) => ({
    icon: 'file-pen',
    verb: '修改',
    running: '正在修改',
    group: '修改了 {n} 处',
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
    group: '搜索了 {n} 次资料库',
    running: '正在搜索资料库',
    target: text(args?.query),
  }),
  research_read: (args) => ({
    icon: 'book-open',
    verb: '读取资料',
    group: '读取了 {n} 份资料',
    running: '正在读取资料',
    target: text(args?.label ?? args?.id),
  }),
  view_image: (args, call) => ({
    icon: 'image',
    verb: '查看图片',
    group: '查看了 {n} 张图片',
    running: '正在查看图片',
    target: viewed(args, call.result?.preview),
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
    group: '运行了 {n} 条命令',
    running: '正在运行命令',
    target: text(args?.command),
    mono: true,
  }),
  read: (args) => ({
    icon: 'file-search',
    verb: '读取文件',
    group: '读取了 {n} 个文件',
    running: '正在读取文件',
    target: text(args?.path ?? args?.file_path),
    mono: true,
  }),
  write: (args) => ({
    icon: 'file-pen',
    verb: '写入文件',
    group: '写入了 {n} 个文件',
    running: '正在写入文件',
    target: text(args?.path ?? args?.file_path),
    mono: true,
  }),
  edit: (args) => ({
    icon: 'file-diff',
    verb: '修改文件',
    group: '修改了 {n} 个文件',
    running: '正在修改文件',
    target: text(args?.path ?? args?.file_path),
    mono: true,
  }),
  grep: (args) => ({
    icon: 'text-search',
    verb: '搜索内容',
    group: '搜索了 {n} 次内容',
    running: '正在搜索内容',
    target: text(args?.pattern),
    mono: true,
  }),
  web_fetch: (args) => ({
    icon: 'globe',
    verb: '读取网页',
    group: '读取了 {n} 个网页',
    running: '正在读取网页',
    target: text(args?.url),
    mono: true,
  }),
};
TOOLS.list_files = (args) => ({
  icon: 'folder-open',
  verb: '列出文件',
  group: '列出了 {n} 次文件',
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

/** "S3 · 第 4 页 · 局部": what view_image looked at. @param {any} args @param {any} [preview] */
function viewed(args, preview) {
  const name =
    preview?.name ??
    String(args?.path ?? '')
      .split(/[\\/]/)
      .pop();
  const page = preview?.page ?? args?.page;
  return [name, page && t('第 {n} 页', { n: page }), (preview?.region ?? args?.region) && t('局部')]
    .filter(Boolean)
    .join(' · ');
}

// The model could not see the image (pi/tools.js); the preview was made anyway.
const UNSEEN = '当前模型不能看图，请换支持图片的模型';

/** Tool calls proper; thinking and retries share the same activity list. @param {any} call */
export const isToolCall = (call) => (call.kind ?? 'tool') === 'tool';

/** @param {any} call */
export function describeCall(call) {
  const known = TOOLS[call.name]?.(call.args, call);
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

const pad = (n) => String(n).padStart(2, '0');
/** "16:27". @param {string} [iso] */
function clock(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** @param {{ call: any }} props */
function Narration({ call }) {
  return html`<div
    class="ss-act__narr ss-prose"
    dangerouslySetInnerHTML=${{ __html: renderMarkdown(call.preamble) }}
  ></div>`;
}

/** @param {{ call: any, running: boolean, approval?: any, narrate?: boolean }} props */
function ActivityRow({ call, running, approval, narrate = true }) {
  if (call.kind === 'thinking') return html`<${ThinkingRow} call=${call} running=${running} />`;
  if (call.kind === 'retry') return html`<${RetryRow} call=${call} />`;
  if (call.kind === 'approval') return html`<${ApprovalRow} call=${call} />`;
  if (call.kind === 'compaction') return html`<${CompactionRow} call=${call} />`;
  return html`<${CallRow}
    call=${call}
    running=${running}
    approval=${approval}
    narrate=${narrate}
  />`;
}

/**
 * One tool call. An approval it waited for is part of the row: 等待批准 at
 * the end while the card below waits, and who decided when in the details.
 * @param {{ call: any, running: boolean, approval?: any, narrate?: boolean }} props
 */
function CallRow({ call, running, approval, narrate = true }) {
  const [open, setOpen] = useState(false);
  const shown = describeCall(call);
  const held = approval?.status === 'pending';
  const active = call.status === 'running' && running && !held;
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
  const decided =
    approval?.status === 'approved'
      ? approval.result?.approvedBy
        ? t('你在 {time} 总是允许了这类操作', { time: clock(approval.endedAt) })
        : t('你在 {time} 允许了这一步', { time: clock(approval.endedAt) })
      : approval?.status === 'rejected'
        ? t('你在 {time} 拒绝了这一步', { time: clock(approval.endedAt) })
        : call.result?.approvedBy
          ? t('按规则自动允许')
          : '';
  const tone = failed ? 'ss-act__row--fail' : unfinished ? 'ss-act__row--muted' : '';
  return html`${narrate && call.preamble && html`<${Narration} call=${call} />`}
    <button
      type="button"
      class=${`ss-act__row ${tone}`}
      data-tool-call=${call.id}
      data-status=${call.status}
      data-approval=${approval?.status}
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
      (commandRan(call)
        ? html`<div class="ss-act__detail">
            <div class="ss-act__detail-head"><span>$ ${call.args?.command}</span></div>
            <pre>${call.result.output || t('（没有输出）')}</pre>
            <div class="ss-act__detail-foot">
              ${[
                t('退出码 {code}', { code: call.result.exitCode ?? '—' }),
                call.result.timedOut && t('已超时'),
                decided,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>`
        : imageViewed(call)
          ? html`<${ImageDetail} call=${call} decided=${decided} />`
          : html`<div class="ss-act__detail">
              <div class="ss-act__detail-head"><span class="ss-mono">${call.name}</span></div>
              <pre>${pretty(call.args)}</pre>
              ${
                call.result != null &&
                html`<div class="ss-act__detail-head">
                    <span>${failed ? t('错误') : t('结果')}</span>
                  </div>
                  <pre>${pretty(call.result)}</pre>`
              }
              ${decided && html`<div class="ss-act__detail-foot">${decided}</div>`}
            </div>`)
    }`;
}

/** @param {any} call */
const imageViewed = (call) => call.name === 'view_image' && call.result?.preview;

/**
 * The picture the model looked at; opens in the preview pane. When the model
 * could not see it, the row says so instead of showing it.
 * @param {{ call: any, decided: string }} props
 */
function ImageDetail({ call, decided }) {
  const actions = useActions();
  const { preview } = call.result;
  const unseen = call.result.text === UNSEEN;
  return html`<div class="ss-act__detail" data-viewed-image>
    ${
      unseen
        ? html`<div class="ss-act__detail-note">${t(UNSEEN)}</div>`
        : html`<button
            type="button"
            class="ss-act__image"
            title=${t('预览')}
            onClick=${() =>
              actions.openPreview({ kind: 'tool', turnId: call.turnId, id: call.callId })}
          >
            <img
              src=${actions.previewUrl(preview.url)}
              alt=${viewed(call.args, preview)}
              width=${preview.width}
              height=${preview.height}
            />
          </button>`
    }
    ${decided && html`<div class="ss-act__detail-foot">${decided}</div>`}
  </div>`;
}

/** A finished shell command reads as its output, like a terminal. @param {any} call */
const commandRan = (call) =>
  TOOLS[call.name] === TOOLS.bash &&
  typeof call.result?.output === 'string' &&
  !call.result.rejected &&
  !call.result.cancelled;

/**
 * Consecutive calls of one kind, as one row that opens to each of them:
 * 运行了 6 条命令. While the last one runs the row says what it is doing.
 * @param {{ run: { group?: string, calls: any[] }, running: boolean, approvals: Map<string, any> }} props
 */
function GroupRow({ run, running, approvals }) {
  const [open, setOpen] = useState(false);
  const tools = run.calls.filter(isToolCall);
  const last = tools.at(-1);
  const shown = describeCall(last);
  const held = tools.some((call) => approvals.get(call.id)?.status === 'pending');
  const active = running && !held && last.status === 'running';
  // A call waiting for approval has not run yet.
  const done = held ? tools.length - 1 : tools.length;
  const failed = tools.filter((call) => call.status === 'failed').length;
  const rejected = tools.filter((call) => call.result?.rejected).length;
  return html`${run.calls[0].preamble && html`<${Narration} call=${run.calls[0]} />`}
    <button
      type="button"
      class="ss-act__row"
      data-activity="group"
      data-count=${tools.length}
      aria-expanded=${open}
      onClick=${() => setOpen(!open)}
    >
      ${active ? html`<span class="ss-spin"></span>` : html`<${Lucide} name=${shown.icon} />`}
      <span class="ss-act__verb">${active ? t(shown.running) : t(run.group, { n: done })}</span>
      ${
        active &&
        shown.target &&
        html`<span class=${`ss-act__target ${shown.mono ? '' : 'ss-act__target--text'}`}
          >${shown.target}</span
        >`
      }
      ${held && html`<span class="ss-act__end">${t('等待批准')}</span>`}
      ${!held && failed > 0 && html`<span class="ss-act__end ss-act__end--fail">${t('{n} 个失败', { n: failed })}</span>`}
      ${!held && rejected > 0 && html`<span class="ss-act__end">${t('{n} 个已拒绝', { n: rejected })}</span>`}
      <${Lucide} name="chevron-right" class="ss-act__chev" />
    </button>
    ${
      open &&
      html`<div class="ss-act__nest">
        ${run.calls.map(
          (call, index) =>
            html`<${ActivityRow}
              key=${call.id}
              call=${call}
              running=${running}
              approval=${approvals.get(call.id)}
              narrate=${index > 0}
            />`,
        )}
      </div>`
    }`;
}

/**
 * Each approval belongs to the tool call it held (args.callId; older
 * requests: the nearest call before it). One without a call keeps its row.
 * @param {any[]} calls
 */
function approvalsByCall(calls) {
  /** @type {Map<string, any>} */
  const byCall = new Map();
  const loose = new Set();
  calls.forEach((call, index) => {
    if (call.kind !== 'approval') return;
    const callId = call.args?.callId;
    const owner =
      (callId && calls.find((item) => isToolCall(item) && item.callId === callId)) ||
      calls.slice(0, index).findLast(isToolCall);
    if (owner) byCall.set(owner.id, call);
    else loose.add(call);
  });
  return { byCall, loose };
}

/**
 * Rows of the timeline: consecutive calls of one kind (with the thinking
 * between them) form a group; narration or a different step starts anew.
 * @param {any[]} calls
 * @returns {{ group?: string, calls: any[] }[]} a single step has no group
 */
function rowsOf(calls) {
  /** @type {{ group?: string, calls: any[] }[]} */
  const rows = [];
  /** @type {{ group: string, calls: any[] } | null} */
  let run = null;
  const close = () => {
    if (!run) return;
    // Thinking after the run's last call belongs to whatever comes next.
    const tail = [];
    while (!isToolCall(run.calls.at(-1))) tail.unshift(run.calls.pop());
    if (run.calls.filter(isToolCall).length > 1) rows.push(run);
    else rows.push(...run.calls.map((call) => ({ calls: [call] })));
    rows.push(...tail.map((call) => ({ calls: [call] })));
    run = null;
  };
  for (const call of calls) {
    const group = isToolCall(call) ? describeCall(call).group : undefined;
    if (call.kind === 'thinking' && run) run.calls.push(call);
    else if (group && run?.group === group && !call.preamble) run.calls.push(call);
    else {
      close();
      if (group) run = { group, calls: [call] };
      else rows.push({ calls: [call] });
    }
  }
  close();
  return rows;
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
  const { byCall, loose } = approvalsByCall(calls);
  const rows = rowsOf(calls.filter((call) => call.kind !== 'approval' || loose.has(call)));
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
        ${rows.map((row) => {
          const [first] = row.calls;
          // The card waiting for a decision sits right under its step, never folded away.
          const card = row.calls
            .map((call) => byCall.get(call.id))
            .find((approval) => approval?.status === 'pending');
          return html`<${Fragment} key=${first.id}>
            ${
              row.group
                ? html`<${GroupRow} run=${row} running=${running} approvals=${byCall} />`
                : html`<${ActivityRow}
                    call=${first}
                    running=${running}
                    approval=${byCall.get(first.id)}
                  />`
            }
            ${card && html`<${ApprovalCard} call=${card} />`}
          <//>`;
        })}
      </div>`
    }
  </div>`;
}
