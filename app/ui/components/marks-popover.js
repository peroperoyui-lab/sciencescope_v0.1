import { useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { usePopover } from './popover.js';
import { navigate } from '../route.js';
import { findMarkRange, markHighlight } from '../mark-ranges.js';

/**
 * @param {{owner:string,marks:any[]}} props
 */
export function MarksPopover({ owner, marks }) {
  const actions = useActions();
  const [editing, setEditing] = useState(null),
    [comment, setComment] = useState('');
  const [expanded, setExpanded] = useState({});
  const pop = usePopover({ placement: 'top-start' });
  async function locate(mark) {
    pop.setOpen(false);
    if (!mark.messageId) {
      actions.openPreview({
        ...mark.target,
        id: mark.sourceId ?? mark.target?.id,
        page: mark.location?.page,
        highlight: mark.text,
        owner,
      });
      return;
    }
    const element = document.querySelector(
      `[data-message-id="${mark.messageId}"],[data-assistant-message="${mark.messageId}"]`,
    );
    if (!element) {
      navigate({ view: 'meeting', id: `${mark.meetingId}/${mark.messageId}` });
      await actions.openMeeting(mark.meetingId);
      return;
    }
    element.scrollIntoView({ block: 'center' });
    element.setAttribute('data-target', '');
    const range = findMarkRange(element.querySelector('.message-text'), mark.text);
    if (range) markHighlight('research-focus', [range]);
    setTimeout(() => element.removeAttribute('data-target'), 1800);
  }
  if (!marks.length) return null;
  const toggle = (id) => setExpanded({ ...expanded, [id]: !expanded[id] });
  return html`<button
      type="button"
      ref=${pop.trigger}
      class="ss-file-chip ss-marks__toggle"
      data-marks-toggle
      aria-expanded=${pop.open}
      onClick=${pop.toggle}
    >
      <${Lucide} name="highlighter" />${t('标记 {count}', { count: marks.length })}
    </button>
    ${
      pop.open &&
      html`<div
        ref=${pop.layer}
        class="ss-pop ss-marks"
        data-marks-popover
        role="dialog"
        aria-label=${t('标记')}
      >
        <div class="ss-pop__head">
          <span>${t('标记 {count}', { count: marks.length })}</span>
          <button
            type="button"
            class="ss-btn ss-btn--ghost ss-btn--sm"
            onClick=${() => actions.attempt(() => actions.changeInput(owner, { op: 'marks-clear' }))}
          >
            ${t('全部清除')}
          </button>
          <button
            type="button"
            class="ss-icon-btn ss-icon-btn--sm"
            aria-label=${t('关闭')}
            onClick=${() => pop.setOpen(false)}
          >
            <${Lucide} name="x" />
          </button>
        </div>
        <ol class="ss-marks__list">
          ${marks.map(
            (mark) =>
              html`<li class="ss-marks__item" key=${mark.id}>
                <div class="ss-marks__source">
                  ${mark.speaker ?? mark.title}
                  ${mark.location?.page ? t('第 {page} 页', { page: mark.location.page }) : (mark.location?.description ?? '')}
                </div>
                <blockquote
                  class="ss-quote ss-marks__text"
                  data-expanded=${expanded[mark.id] ? '' : undefined}
                  tabindex="0"
                  onClick=${() => toggle(mark.id)}
                  onKeyDown=${(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggle(mark.id);
                    }
                  }}
                >
                  ${mark.text}
                </blockquote>
                ${
                  editing === mark.id
                    ? html`<div class="ss-marks__edit">
                        <textarea
                          class="ss-textarea"
                          rows="2"
                          aria-label=${t('修改标记备注')}
                          value=${comment}
                          onInput=${(event) => setComment(event.currentTarget.value)}
                        ></textarea>
                        <button
                          type="button"
                          class="ss-btn ss-btn--primary ss-btn--sm"
                          onClick=${() =>
                            actions.attempt(async () => {
                              await actions.changeInput(owner, {
                                op: 'mark-edit',
                                id: mark.id,
                                comment,
                              });
                              setEditing(null);
                            })}
                        >
                          ${t('保存')}
                        </button>
                      </div>`
                    : mark.comment && html`<p class="ss-marks__comment">${mark.comment}</p>`
                }
                <div class="ss-marks__actions">
                  <button
                    type="button"
                    class="ss-btn ss-btn--ghost ss-btn--sm"
                    onClick=${() => locate(mark)}
                  >
                    ${t('定位')}
                  </button>
                  <button
                    type="button"
                    class="ss-btn ss-btn--ghost ss-btn--sm"
                    onClick=${() => {
                      setEditing(mark.id);
                      setComment(mark.comment ?? '');
                    }}
                  >
                    ${t('修改备注')}
                  </button>
                  <button
                    type="button"
                    class="ss-btn ss-btn--ghost ss-btn--sm"
                    onClick=${() =>
                      actions.attempt(() =>
                        actions.changeInput(owner, { op: 'mark-remove', id: mark.id }),
                      )}
                  >
                    ${t('移除')}
                  </button>
                </div>
              </li>`,
          )}
        </ol>
      </div>`
    }`;
}
