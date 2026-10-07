import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { FieldForm } from './overlays.js';

/**
 * The legacy queue above the input; each item remains editable until sent.
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
  return html`<div class="main-outbox" data-outbox=${meetingId}>
    <div class="row">
      <small
        >${t('待发送 {count} 条', { count: state.items.length })}${state.paused ? ' · ' + t('已暂停') : ''}</small
      ><span class="spacer"></span>
      <button
        class="btn tiny"
        onClick=${() => actions.attempt(() => (state.paused ? actions.resumeOutbox(meetingId) : actions.pauseOutbox(meetingId)))}
      >
        ${state.paused ? t('继续队列') : t('暂停队列')}
      </button>
      <button
        class="btn tiny"
        onClick=${() => actions.attempt(() => actions.cancelOutbox(meetingId))}
      >
        ${t('全部取消')}
      </button>
    </div>
    ${state.items.map(
      (item) =>
        html`<div class="outbox-item" data-outbox-id=${item.id} key=${item.id}>
          <span title=${item.text}>${item.text}</span><small>${t('待发送')}</small>
          <button onClick=${() => edit(item)}>${t('编辑')}</button>
          <button
            aria-label=${t('取消待发消息')}
            onClick=${() => actions.attempt(() => actions.cancelOutbox(meetingId, item.id))}
          >
            ×
          </button>
        </div>`,
    )}
  </div>`;
}
