// The main input box in the old interface's markup (`.composer`), shared by
// the welcome page and meetings: the context ring, the model and reasoning
// menus (the default model in settings) and send / stop.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { navigate } from '../route.js';

function useModelMenu() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const current = settings?.models?.default;
  const choices = (settings?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({
      provider: provider.id,
      model: model.id,
      text: `${provider.name ?? provider.id} · ${model.name ?? model.id}`,
    })),
  );
  const label = current
    ? (choices.find((c) => c.provider === current.provider && c.model === current.model)?.text ??
      `${current.provider} · ${current.model}`)
    : t('未连接模型');
  const open = (event) => {
    actions.openMenu(
      event,
      [
        ...choices.map((choice) => ({
          text: choice.text,
          check: current?.provider === choice.provider && current?.model === choice.model,
          run: () =>
            actions.attempt(() =>
              actions.updateSettings({
                // A different model has its own efforts; start from its default.
                models: {
                  default: { provider: choice.provider, model: choice.model, effort: null },
                },
              }),
            ),
        })),
        ...(choices.length ? [{ sep: true }] : []),
        {
          text: t('管理模型与 API'),
          icon: 'gear',
          run: () => navigate({ view: 'settings', id: 'models' }),
        },
      ],
      t('模型'),
    );
  };
  return { label, open };
}

/** Reasoning effort of the default model, from the efforts the model lists. */
function useEffortMenu() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const current = settings?.models?.default;
  const model = (settings?.providers ?? [])
    .find((provider) => provider.id === current?.provider)
    ?.models.find((candidate) => candidate.id === current?.model);
  const efforts = model?.efforts ?? [];
  const choose = (effort) =>
    actions.attempt(() =>
      // Settings patches merge, so "model default" is stored as null.
      actions.updateSettings({ models: { default: { ...current, effort: effort || null } } }),
    );
  const open = (event) =>
    actions.openMenu(
      event,
      [
        { text: t('模型默认'), check: !current?.effort, run: () => choose('') },
        ...efforts.map((effort) => ({
          text: effort,
          check: current?.effort === effort,
          run: () => choose(effort),
        })),
      ],
      t('思考强度'),
    );
  return { label: current?.effort || t('模型默认'), open, disabled: !current };
}

/**
 * Context pressure of the meeting's latest finished answer: what its next
 * request would carry against the model's window.
 * @param {string | undefined} meetingId
 */
function useContextUsage(meetingId) {
  const settings = useAppState((state) => state.settings);
  const turn = useAppState((state) =>
    Object.values(state.turns)
      .filter((candidate) => candidate.meetingId === meetingId && candidate.usage?.context)
      .sort((a, b) => (a.endedAt ?? '').localeCompare(b.endedAt ?? ''))
      .at(-1),
  );
  const context = turn?.usage?.context;
  if (!context?.usedTokens) return null;
  const current = settings?.models?.default;
  const configured = (settings?.providers ?? [])
    .find((provider) => provider.id === current?.provider)
    ?.models.find((model) => model.id === current?.model)?.contextWindow;
  const window = context.contextWindow ?? configured;
  if (!window) return null;
  return {
    used: context.usedTokens,
    window,
    estimated: Boolean(context.estimated),
    percent: Math.max(0, Math.min(100, (100 * context.usedTokens) / window)),
  };
}

/** @param {{ meetingId?: string }} props */
function UsageRing({ meetingId }) {
  const usage = useContextUsage(meetingId);
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!open || !button.current) return undefined;
    const rect = button.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(innerWidth - 310, rect.left)), top: rect.top - 10 });
    const close = (event) => !button.current?.contains(event.target) && setOpen(false);
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);
  const amount = usage
    ? `${Math.round(usage.used).toLocaleString()} / ${Math.round(usage.window).toLocaleString()} tokens`
    : t('暂无数据');
  return html`<button
      ref=${button}
      class="usage-ring"
      data-usage="main"
      data-context-known=${String(Boolean(usage))}
      style=${{ '--context-pct': `${usage?.percent ?? 0}%` }}
      title=${t('模型上下文与缓存')}
      aria-label=${
        usage ? t('上下文占用 {n}%', { n: usage.percent.toFixed(1) }) : t('上下文占用暂无数据')
      }
      onClick=${() => setOpen(!open)}
    ></button>
    ${
      open &&
      html`<div
        class="usage-pop"
        role="tooltip"
        style=${{ position: 'fixed', left: `${position.left}px`, top: `${position.top}px`, transform: 'translateY(-100%)' }}
      >
        <strong>${t('模型上下文')}</strong>
        <div class="usage-stat">
          <span>${t('当前')}${usage?.estimated ? t('（估计）') : ''}</span>
          <span>${usage ? `${usage.percent.toFixed(1)}%` : '—'}</span>
        </div>
        <div class="meter"><i style=${{ width: `${usage?.percent ?? 0}%` }}></i></div>
        <div class="usage-stat"><span>${t('占用')}</span><span>${amount}</span></div>
      </div>`
    }`;
}

/**
 * @param {{ onSend: (text: string) => Promise<any>, running?: boolean,
 *   onStop?: () => void, inputRef?: any, meetingId?: string }} props
 */
export function Composer({ onSend, running = false, onStop, inputRef, meetingId }) {
  const actions = useActions();
  const sendKey = useAppState((state) => state.settings?.composer?.sendKey ?? 'enter');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ownRef = useRef(null);
  const box = inputRef ?? ownRef;
  const model = useModelMenu();
  const effort = useEffortMenu();
  const quote = useAppState((state) => state.quote);

  // "引用到输入框" from a message of this meeting.
  useEffect(() => {
    if (!quote || quote.meetingId !== meetingId) return;
    setText(
      (current) => `${current}${current && !current.endsWith('\n') ? '\n' : ''}${quote.text}`,
    );
    box.current?.focus();
  }, [quote]);

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    // Keep the draft until the host accepts the message.
    const sent = await actions.attempt(() => onSend(value));
    setSending(false);
    if (sent !== undefined) setText('');
  }

  return html`<div class="composer" data-composer="main">
    <textarea
      ref=${box}
      value=${text}
      placeholder=${t('输入问题或下一步工作…')}
      aria-label=${t('主输入框')}
      onInput=${(event) => setText(event.currentTarget.value)}
      onKeyDown=${(event) => {
        if (event.key !== 'Enter' || event.isComposing || event.shiftKey) return;
        const wantsModifier = sendKey === 'ctrl-enter';
        if (wantsModifier === (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          send();
        }
      }}
    ></textarea>
    <div class="composerbar">
      <span class="spacer"></span>
      <${UsageRing} meetingId=${meetingId} />
      <button data-v="model-menu" onClick=${model.open}>
        ${model.label} <${Icon} name="down" />
      </button>
      <button data-v="reasoning-menu" disabled=${effort.disabled} onClick=${effort.open}>
        ${effort.label}
      </button>
      ${
        running
          ? html`<button
              class="sendbtn"
              data-main-stop
              aria-label=${t('停止当前回复')}
              title=${t('停止当前回复')}
              onClick=${onStop}
            >
              ■
            </button>`
          : html`<button
              class="sendbtn"
              aria-label=${t('发送')}
              disabled=${!text.trim() || sending}
              onClick=${send}
            >
              <${Icon} name="arrow" />
            </button>`
      }
    </div>
  </div>`;
}
