// Tool activity of one answer, shared by Main, experts, the secretary and the
// global assistant. It reproduces the old `.turn-activity` card (one card per
// answer, the model's pre-call words as captions) with the behaviour the user
// asked for on 2026-10-12: while the answer runs the card is open, so preambles
// and calls are visible as they happen; when the answer ends it folds into one
// line. The person can open or close it at any time; a choice made after the
// answer ended is kept.
import { useEffect, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { isToolCall } from './timeline.js';

/** @param {any} value */
function pretty(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** @param {any} call @param {boolean} running */
function callState(call, running) {
  if (call.status === 'failed') return '失败';
  if (call.status === 'running') return running ? '进行中' : '未完成';
  return '完成';
}

/** One tool call inside the card. @param {{ call: any, running: boolean }} props */
function ToolCall({ call, running }) {
  return html`${call.preamble && html`<p class="tool-preamble">${call.preamble}</p>`}
    <details data-tool-call=${call.id} class=${`tool-call ${call.status}`}>
      <summary><span>${call.name}</span><small>${t(callState(call, running))}</small></summary>
      <div class="tool-detail-label">${t('输入')}</div>
      <pre>${pretty(call.args)}</pre>
      ${
        call.result != null &&
        html`<div class="tool-detail-label">${t('结果')}</div>
          <pre>${pretty(call.result)}</pre>`
      }
    </details>`;
}

/**
 * All tool calls of one answer as a single card.
 * @param {{ calls: any[], running: boolean }} props
 */
export function ToolActivity({ calls: activity, running }) {
  // Thinking and retries have their own rows in the new timeline only.
  const calls = activity.filter(isToolCall);
  /** @type {[boolean | null, (open: boolean | null) => void]} */
  const [chosen, setChosen] = useState(null);
  // Folding happens when the answer ends; an earlier choice does not survive it.
  useEffect(() => {
    if (!running) setChosen(null);
  }, [running]);
  if (!calls.length) return null;
  const open = chosen ?? running;
  const active = calls.filter((call) => call.status === 'running').length;
  const failed = calls.filter((call) => call.status === 'failed').length;
  const caption = calls.findLast((call) => call.preamble)?.preamble?.replace(/\s+/g, ' ') ?? '';
  const title = running
    ? t('正在使用工具 · {count}', { count: active || calls.length })
    : t('工具记录 · {count}', { count: calls.length });
  return html`<details
    class="turn-activity"
    data-turn-activity
    data-running=${running || undefined}
    open=${open}
    onToggle=${(event) => {
      const next = event.currentTarget.open;
      if (next !== open) setChosen(next);
    }}
  >
    <summary>
      <b>${title}${failed ? ` · ${t('失败 {count}', { count: failed })}` : ''}</b>
      ${caption && html`<em class="turn-activity-caption">${caption}</em>`}
      <span>${running ? t('执行中') : open ? t('收起') : t('展开查看')}</span>
    </summary>
    <div class="turn-activity-calls">
      ${calls.map((call) => html`<${ToolCall} key=${call.id} call=${call} running=${running} />`)}
    </div>
  </details>`;
}
