// Provenance stays visible both before and after a candidate is accepted.
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { useActions } from '../context.js';
import { navigate } from '../route.js';
import { InfoTip } from './info-tip.js';

/**
 * @param {{ item: any }} props
 * @returns {import('preact').VNode}
 */
export function MemoryEvidence({ item }) {
  const actions = useActions();
  const evidence = item.payload?.evidence ?? [];
  const external = item.payload?.originTrust === 'external';
  async function openSource(entry) {
    const ref = entry.ref ?? entry;
    const meetingId = ref.meetingId ?? item.origin?.meetingId;
    if (!meetingId) return;
    const messageId = ref.messageId ?? (ref.type === 'message' ? ref.id : null);
    navigate({ view: 'meeting', id: messageId ? `${meetingId}/${messageId}` : meetingId });
  }
  return html`<div class="ss-provenance">
    ${
      external &&
      html`<span class="ss-provenance__external"
        ><span class="ss-tag ss-tag--warn" data-rb-external>${t('外部来源')}</span
        ><${InfoTip}
          text=${t('这条候选包含网页或文献内容。来源标记会保留，接受不会将外部内容变为用户指令。')}
      /></span>`
    }
    ${evidence.map((entry, index) => {
      const ref = entry.ref ?? entry;
      return html`<div class="ss-provenance__item" key=${index}>
        ${entry.quote && html`<blockquote class="ss-quote">${entry.quote}</blockquote>`}
        <span class="ss-provenance__ref">
          <code
            >${ref.minutesRevisionId ?? ref.minutesRevision ?? ref.messageId ?? ref.id ?? ''}</code
          >
          ${
            (ref.meetingId || item.origin?.meetingId) &&
            html`<button
              type="button"
              class="ss-btn ss-btn--ghost ss-btn--sm"
              data-memory-source
              onClick=${() => actions.attempt(() => openSource(entry))}
            >
              ${t('定位到消息')}
            </button>`
          }
        </span>
      </div>`;
    })}
  </div>`;
}
