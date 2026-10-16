// One status line under an answer (design system StatusLine): what is
// happening now and for how long, or why it ended and what to do next. While
// text streams the text itself is the progress, so the line hides.
import { useEffect, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { describeCall } from './timeline.js';

/** Seconds since `since`, refreshed every second while shown. @param {string | undefined} since */
function useSeconds(since) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since ? Math.max(0, Math.round((now - Date.parse(since)) / 1000)) : 0;
}

/** @param {{ since?: string }} props */
function Elapsed({ since }) {
  const seconds = useSeconds(since);
  return since ? html`<span class="ss-status__time">${t('{n} 秒', { n: seconds })}</span>` : null;
}

/** @param {{ message: any, calls: any[], text: string, reason?: string }} props */
export function StatusLine({ message, calls, text, reason }) {
  const actions = useActions();
  if (message.status === 'streaming') {
    const active = calls.findLast((call) => call.status === 'running');
    if (active) {
      const shown = describeCall(active);
      return html`<div class="ss-status" role="status">
        <span class="ss-spin"></span><span>${t(shown.running)}</span>
        <${Elapsed} since=${active.startedAt} />
      </div>`;
    }
    if (text.trim()) return null;
    const last = calls.at(-1);
    return html`<div class="ss-status" role="status">
      <span class="ss-spin"></span
      ><span>${last ? t('等待模型继续') : t('已发送，等待模型响应')}</span>
      <${Elapsed} since=${last?.endedAt ?? message.createdAt} />
    </div>`;
  }
  if (message.status === 'failed')
    return html`<div class="ss-status ss-status--fail" role="status">
      <${Lucide} name="circle-alert" /><span>${reason ?? t('这次发言失败了。')}</span>
      <button
        type="button"
        class="ss-btn ss-btn--sm"
        onClick=${() => actions.attempt(() => actions.retry(message.id))}
      >
        <${Lucide} name="rotate-cw" /><span>${t('重试')}</span>
      </button>
    </div>`;
  if (message.status === 'cancelled')
    return html`<div class="ss-status" role="status">
      <${Lucide} name="circle-stop" /><span>${t('你停止了这次回答，已保留到目前的内容。')}</span>
      <button
        type="button"
        class="ss-btn ss-btn--ghost ss-btn--sm"
        onClick=${() => actions.attempt(() => actions.retry(message.id))}
      >
        <${Lucide} name="rotate-cw" /><span>${t('重试')}</span>
      </button>
    </div>`;
  if (message.status === 'max_tokens')
    return html`<div class="ss-status ss-status--wait" role="status">
      <${Lucide} name="triangle-alert" /><span
        >${t('回答达到模型的单次输出上限，后面的内容没有写出。')}</span
      >
      <button
        type="button"
        class="ss-btn ss-btn--sm"
        onClick=${() => actions.attempt(() => actions.continueAnswer(message.id))}
      >
        ${t('继续')}
      </button>
    </div>`;
  return null;
}
