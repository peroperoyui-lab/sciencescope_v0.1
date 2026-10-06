import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';

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
/** @param {{meetingId?:string}} props */
export function DiscussionUsageRing({ meetingId }) {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const contexts = useAppState((state) => state.meetingContexts[meetingId] ?? []);
  const definitions = useAppState((state) => state.participantDefinitions);
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const popup = useRef(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const modelFor = (id) => definitions[id]?.definition.model ?? settings?.models?.default;
  const measurement = (entry) => {
    const model = modelFor(entry.participantId);
    const window = settings?.providers
      ?.find((provider) => provider.id === model?.provider)
      ?.models.find((candidate) => candidate.id === model?.model)?.contextWindow;
    return normalize(entry.context, window);
  };
  const main = contexts.find((entry) => entry.participantId === 'agent_main');
  const usage = main ? measurement(main) : null;
  const experts = contexts.filter((entry) => entry.participantId !== 'agent_main');
  useEffect(() => {
    if (!open) return;
    if (meetingId) void actions.loadMeetingContexts(meetingId).catch(() => {});
    const rect = button.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(innerWidth - 310, rect.left)), top: rect.top - 10 });
    const close = (event) => {
      if (!button.current?.contains(event.target) && !popup.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open, meetingId]);
  const amount = (value) =>
    value
      ? `${Math.round(value.used).toLocaleString()} / ${value.window ? Math.round(value.window).toLocaleString() : t('未知')} tokens`
      : t('暂无数据');
  const row = (value, label) =>
    html`<div class="usage-stat">
        <span>${label}${value?.estimated ? t('（估计）') : ''}</span
        ><span>${value?.percent != null ? value.percent.toFixed(1) + '%' : '—'}</span>
      </div>
      <div class="meter"><i style=${{ width: (value?.percent ?? 0) + '%' }}></i></div>
      <div class="usage-stat"><span>${amount(value)}</span></div>`;
  return html`<button
      ref=${button}
      class="usage-ring"
      data-usage="main"
      data-context-known=${String(usage?.percent != null)}
      style=${{ '--context-pct': (usage?.percent ?? 0) + '%' }}
      title=${t('模型上下文与缓存')}
      aria-label=${usage?.percent != null ? t('上下文占用 {n}%', { n: usage.percent.toFixed(1) }) : t('上下文占用暂无数据')}
      aria-expanded=${open}
      onClick=${() => setOpen(!open)}
    ></button
    >${
      open &&
      html`<div
        class="usage-pop"
        ref=${popup}
        role="tooltip"
        style=${{ position: 'fixed', left: position.left + 'px', top: position.top + 'px', transform: 'translateY(-100%)' }}
      >
        <strong>${t('模型上下文')}</strong>${row(usage, t('主专家 · 当前'))}${
          experts.length > 0 &&
          html`<div class="usage-experts">
            <div class="usage-experts-head">${t('专家 · 上一次作答结束时')}</div>
            ${experts.map((entry) => html`<div class="usage-expert" data-context-participant=${entry.participantId}>${row(measurement(entry), definitions[entry.participantId]?.name ?? entry.participantId)}</div>`)}
          </div>`
        }
      </div>`
    }`;
}
