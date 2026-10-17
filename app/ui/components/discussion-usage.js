// Context ring in the composer bar (design system `ss-ring`): how much of the
// model's context window this conversation uses; click for each expert.
import { useEffect } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { currentLanguage, t } from '../i18n/index.js';
import { html } from '../html.js';
import { usePopover } from './popover.js';
import { useModelCatalog } from '../model-catalog.js';

// Level at which the ring turns to the warning colour when settings have not
// loaded; otherwise the compaction threshold (`context.compactPercent`).
const WARN_AT = 80;

/** @param {any} context @param {number | undefined} configured */
function normalize(context, configured) {
  if (!context || !Number.isFinite(context.usedTokens)) return null;
  const window = context.contextWindow ?? configured;
  return {
    used: context.usedTokens,
    window,
    estimated: Boolean(context.estimated),
    percent: window ? Math.max(0, Math.min(100, (100 * context.usedTokens) / window)) : null,
  };
}

/** "34 万" / "340K". @param {number} value */
export function tokenAmount(value) {
  if (currentLanguage() === 'en') {
    if (value >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
    return String(Math.round(value));
  }
  return value >= 1e4
    ? `${+(value / 1e4).toFixed(value >= 1e5 ? 0 : 1)} 万`
    : String(Math.round(value));
}

/** @param {{ percent: number, warnAt?: number }} props */
export function Ring({ percent, warnAt = WARN_AT }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  const circumference = 2 * Math.PI * 2.5;
  const level = p >= 95 ? 'danger' : p >= warnAt ? 'warn' : undefined;
  return html`<svg class="ss-ring" viewBox="0 0 16 16" data-level=${level} aria-hidden="true">
    <circle class="ss-ring__track" cx="8" cy="8" r="6.75" />
    <circle
      class="ss-ring__bar"
      cx="8"
      cy="8"
      r="2.5"
      stroke-dasharray=${`${((circumference * p) / 100).toFixed(2)} ${circumference.toFixed(2)}`}
    />
  </svg>`;
}

/** @param {{meetingId?:string}} props */
export function DiscussionUsageRing({ meetingId }) {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const contexts = useAppState((state) => state.meetingContexts[meetingId] ?? []);
  const definitions = useAppState((state) => state.participantDefinitions);
  const catalog = useModelCatalog();
  const pop = usePopover({ placement: 'top-end' });
  const warnAt = settings?.context?.compactPercent ?? WARN_AT;
  const modelFor = (id) => definitions[id]?.definition.model ?? settings?.models?.default;
  const measurement = (entry) => {
    const model = modelFor(entry.participantId);
    const window = catalog
      .find((provider) => provider.id === model?.provider)
      ?.models.find((candidate) => candidate.id === model?.model)?.contextWindow;
    return normalize(entry.context, window);
  };
  const main = contexts.find((entry) => entry.participantId === 'agent_main');
  const usage = main ? measurement(main) : null;
  const experts = contexts.filter((entry) => entry.participantId !== 'agent_main');
  useEffect(() => {
    if (pop.open && meetingId) void actions.loadMeetingContexts(meetingId).catch(() => {});
  }, [pop.open, meetingId]);
  const known = usage?.percent != null;
  const amount = (value) =>
    value?.window
      ? `${tokenAmount(value.used)} / ${tokenAmount(value.window)} token`
      : value
        ? `${tokenAmount(value.used)} / ${t('未知')} token`
        : t('暂无数据');
  const percent = (value) => (value?.percent != null ? `${Math.round(value.percent)}%` : '—');
  const tip = known
    ? t('上下文已用 {n}%（{amount}）', { n: Math.round(usage.percent), amount: amount(usage) })
    : t('上下文用量暂无数据');
  const row = (value, label, extra = {}) =>
    html`<div class="ss-pop__section" ...${extra}>
      <span class="ss-pop__label">${label}${value?.estimated ? t('（估计）') : ''}</span>
      <span class="usage-value"
        ><${Ring} percent=${value?.percent ?? 0} warnAt=${warnAt} />${percent(value)}
        <span class="ss-muted">${amount(value)}</span></span
      >
    </div>`;
  return html`<button
      type="button"
      ref=${pop.trigger}
      class="ss-icon-btn ss-icon-btn--sm"
      data-usage="main"
      data-context-known=${String(known)}
      aria-label=${tip}
      aria-expanded=${pop.open}
      data-tip=${tip}
      onClick=${pop.toggle}
    >
      <${Ring} percent=${usage?.percent ?? 0} warnAt=${warnAt} />
    </button>
    ${
      pop.open &&
      html`<div
        ref=${pop.layer}
        class="ss-pop"
        data-usage-pop
        role="dialog"
        aria-label=${t('模型上下文')}
      >
        <div class="ss-pop__head"><span>${t('模型上下文')}</span></div>
        <div class="ss-pop__body">
          ${row(usage, t('主专家 · 当前'))}
          ${
            experts.length > 0 &&
            html`<div class="ss-pop__label">${t('专家 · 上一次作答结束时')}</div>
              ${experts.map((entry) =>
                row(
                  measurement(entry),
                  definitions[entry.participantId]?.name ?? entry.participantId,
                  { 'data-context-participant': entry.participantId },
                ),
              )}`
          }
        </div>
      </div>`
    }`;
}
