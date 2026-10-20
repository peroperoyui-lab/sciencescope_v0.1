// Expert state, the status box of an expert still speaking in an ordered
// discussion, and the review adoption control.
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { useActions, useAppState } from '../context.js';
import { Lucide } from '../icons.js';
import { ApprovalCard } from './approval.js';
import { InfoTip } from './info-tip.js';
import { Elapsed } from './status-line.js';
import { describeCall, isToolCall } from './timeline.js';

const labels = {
  waiting: '等待中',
  running: '作答中',
  tool: '使用工具',
  done: '已完成',
  failed: '未完成',
};

/** @param {any} message @param {any[]} calls @returns {string} */
export function expertState(message, calls) {
  if (message.status !== 'streaming') return message.status === 'done' ? 'done' : 'failed';
  if (calls.some((call) => call.status === 'running' && isToolCall(call))) return 'tool';
  return message.refs?.discussion?.phase === 'waiting' ? 'waiting' : 'running';
}

/** @param {{message:any,calls:any[]}} props */
export function ExpertState({ message, calls }) {
  const state = expertState(message, calls);
  return html`<span class="expert-state" data-state=${state}>${t(labels[state])}</span>`;
}

/**
 * What an expert is doing right now, for the head of its box.
 * @param {any} turn @param {any[]} calls @param {string} text @param {any[]} servers
 */
function currentStep(turn, calls, text, servers) {
  const phase = turn?.phase ?? '';
  if (phase === 'waiting-approval') {
    const card = calls.findLast((call) => call.kind === 'approval' && call.status === 'pending');
    return {
      icon: 'shield-question-mark',
      label: t('等待你的批准'),
      since: card?.startedAt,
      wait: true,
    };
  }
  const active = calls.findLast((call) => call.status === 'running' && isToolCall(call));
  if (active) {
    const shown = describeCall(active, servers);
    return { spin: true, label: t(shown.running), target: shown.target, since: active.startedAt };
  }
  if (phase === 'compacting') return { spin: true, label: t('正在压缩上下文') };
  if (text.trim()) return { spin: true, label: t('正在作答') };
  if (phase === 'thinking') {
    const thinking = calls.findLast((call) => call.kind === 'thinking');
    return { icon: 'lightbulb', label: t('正在思考'), since: thinking?.startedAt };
  }
  return { spin: true, label: t('正在连接模型') };
}

/**
 * An expert still speaking in an ordered discussion: one box of fixed height
 * with what it is doing and the last lines it wrote (or thought), so several
 * experts fit on screen. Once it finishes, the full answer replaces the box.
 * @param {{ message: any, turn?: any, calls: any[], text: string }} props
 */
export function ExpertBox({ message, turn, calls, text }) {
  const servers = useAppState((state) => state.settings?.mcp?.servers ?? []);
  if (message.refs?.discussion?.phase === 'waiting')
    return html`<div class="ss-expert-box" data-expert-box="waiting">
      <div class="ss-expert-box__head">
        <${Lucide} name="clock" /><span>${t('等前面的专家说完')}</span>
      </div>
    </div>`;
  const step = currentStep(turn, calls, text, servers);
  // The words it is writing, else its narration before the current step,
  // else what it is thinking.
  const thought = calls.findLast((call) => call.kind === 'thinking');
  const said = text.trim() || calls.findLast((call) => call.preamble)?.preamble || '';
  const tail =
    said ||
    (typeof thought?.result === 'string' && thought.status === 'running' ? thought.result : '');
  const card = calls.findLast((call) => call.kind === 'approval' && call.status === 'pending');
  return html`<div class="ss-expert-box" data-expert-box="answering">
      <div class=${`ss-expert-box__head ${step.wait ? 'ss-expert-box__head--wait' : ''}`}>
        ${step.spin ? html`<span class="ss-spin"></span>` : html`<${Lucide} name=${step.icon} />`}
        <span>${step.label}</span>
        ${step.target && html`<span class="ss-expert-box__target">${step.target}</span>`}
        <${Elapsed} since=${step.since} />
      </div>
      <div
        class=${`ss-expert-box__tail ${said ? '' : 'ss-expert-box__tail--thought'}`}
        aria-hidden="true"
      >
        <div>${tail.slice(-600)}</div>
      </div>
    </div>
    ${card && html`<${ApprovalCard} call=${card} />`}`;
}

/** @param {{message:any}} props */
export function ReviewAdoption({ message }) {
  const actions = useActions();
  const ready = message.status === 'done';
  const locked = Boolean(message.adoptionLocked);
  const adopted = Boolean(message.adopted);
  const explanation = locked
    ? '已有后续发言读取这份审核结论，不能撤回采纳。'
    : ready
      ? '审核结论默认不进入后续上下文。采纳后，后续发言会读取它。'
      : '审核尚未完成，完成后才能加入后续上下文。';
  const label = locked
    ? '已加入后续上下文 · 已被读取'
    : adopted
      ? '已加入后续上下文'
      : '加入后续上下文';
  return html`<div class="review-adopt" data-review-bar=${message.id}>
    <span>${t('审核结论')} <${InfoTip} label=${t('审核结论说明')} text=${t(explanation)} /></span>
    <button
      class=${`btn tiny ${adopted ? 'soft' : 'primary'}`}
      data-review-adopt=${message.id}
      aria-pressed=${adopted}
      disabled=${!ready || locked}
      onClick=${() => actions.attempt(() => actions.adoptReview(message.id, !adopted))}
    >
      ${t(label)}
    </button>
  </div>`;
}
