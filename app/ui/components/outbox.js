import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { FieldForm } from './overlays.js';

/**
 * Messages queued while an answer runs, inside the composer; each stays
 * editable until it is sent.
 * @param {{meetingId:string}} props
 */
export function Outbox({ meetingId }) {
  const actions = useActions();
  const state = useAppState((current) => current.outboxes[meetingId]);
  if (!state?.items?.length) return null;
  const edit = (item) =>
    actions.openModal(
      t('编辑待发消息'),
      html`<${FieldForm}
        label=${t('消息内容')}
        value=${item.text}
        submitText=${t('保存')}
        onSubmit=${(text) => actions.editOutbox(meetingId, item.id, text)}
      />`,
    );
  return html`<div class="outbox" data-outbox=${meetingId}>
    <div class="outbox__head">
      <span
        >${t('待发送 {count} 条', { count: state.items.length })}${state.paused ? ' · ' + t('已暂停') : ''}</span
      >
      <button
        type="button"
        class="ss-btn ss-btn--ghost ss-btn--sm"
        onClick=${() => actions.attempt(() => (state.paused ? actions.resumeOutbox(meetingId) : actions.pauseOutbox(meetingId)))}
      >
        ${state.paused ? t('继续队列') : t('暂停队列')}
      </button>
      <button
        type="button"
        class="ss-btn ss-btn--ghost ss-btn--sm"
        onClick=${() => actions.attempt(() => actions.cancelOutbox(meetingId))}
      >
        ${t('全部取消')}
      </button>
    </div>
    ${state.items.map(
      (item) =>
        html`<div class="outbox__item" data-outbox-id=${item.id} key=${item.id}>
          <${Lucide} name="clock" small=${true} />
          <span class="ss-truncate" title=${item.text}>${item.text}</span>
          <button
            type="button"
            class="ss-icon-btn ss-icon-btn--sm"
            aria-label=${t('编辑')}
            data-tip=${t('编辑')}
            onClick=${() => edit(item)}
          >
            <${Lucide} name="pencil" />
          </button>
          <button
            type="button"
            class="ss-icon-btn ss-icon-btn--sm"
            aria-label=${t('取消待发消息')}
            data-tip=${t('取消待发消息')}
            onClick=${() => actions.attempt(() => actions.cancelOutbox(meetingId, item.id))}
          >
            <${Lucide} name="x" />
          </button>
        </div>`,
    )}
  </div>`;
}
