// Expert state and the review adoption control reuse the approved message markup.
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { useActions } from '../context.js';
import { InfoTip } from './info-tip.js';

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
  if (calls.some((call) => call.status === 'running')) return 'tool';
  return message.refs?.discussion?.phase === 'waiting' ? 'waiting' : 'running';
}

/** @param {{message:any,calls:any[]}} props */
export function ExpertState({ message, calls }) {
  const state = expertState(message, calls);
  return html`<span class="expert-state" data-state=${state}>${t(labels[state])}</span>`;
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
