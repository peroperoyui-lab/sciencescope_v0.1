import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { renderMarkdown } from '../markdown.js';

export const GOAL_LABELS = {
  running: '执行中',
  paused: '已暂停',
  blocked: '需要处理',
  completed: '已完成',
  ended: '已结束',
  failed: '失败',
};

/**
 * @param {{meetingId:string}} props
 */
export function GoalPanel({ meetingId }) {
  const actions = useActions();
  const goal = useAppState((state) => state.goals[meetingId]);
  const [maxRounds, setMaxRounds] = useState(30);
  useEffect(() => {
    if (goal) setMaxRounds(goal.maxRounds);
  }, [goal?.maxRounds]);
  if (!goal) return null;
  const active = ['running', 'paused', 'blocked'].includes(goal.status);
  const control = (action) => actions.attempt(() => actions.controlGoal(meetingId, { action }));
  return html`<section id="execution-state" class="execution-state" data-goal-status=${goal.status}>
    <div class="row">
      <strong>${t('自动化')} · ${t(GOAL_LABELS[goal.status] ?? goal.status)}</strong>
      <span class="grow" data-goal-rounds
        >${t('{started} / {maximum} 轮', { started: goal.rounds, maximum: goal.maxRounds })}</span
      >
      ${goal.status === 'running' && html`<button class="btn tiny" data-execution="pause" onClick=${() => control('pause')}>${t('暂停')}</button>`}
      ${['paused', 'blocked'].includes(goal.status) && html`<button class="btn tiny" data-execution="resume" onClick=${() => control('resume')}>${t('继续')}</button>`}
      ${active && html`<button class="btn tiny" data-execution="stop" onClick=${() => control('end')}>${t('结束目标')}</button>`}
    </div>
    <details>
      <summary>${t('目标')}</summary>
      <p class="goal-text">${goal.text}</p>
    </details>
    ${goal.reason && html`<div class="rendered-markdown" data-goal-reason dangerouslySetInnerHTML=${{ __html: renderMarkdown(goal.reason) }}></div>`}
    ${
      active &&
      html`<label class="goal-round-setting"
        >${t('最多轮数')}
        <input
          type="number"
          min="1"
          step="1"
          aria-label=${t('目标最多轮数')}
          value=${maxRounds}
          onInput=${(event) => setMaxRounds(Number(event.currentTarget.value))}
        />
        <button
          class="btn tiny"
          disabled=${!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds === goal.maxRounds}
          onClick=${() => actions.attempt(() => actions.controlGoal(meetingId, { maxRounds }))}
        >
          ${t('保存')}
        </button>
      </label>`
    }
  </section>`;
}
