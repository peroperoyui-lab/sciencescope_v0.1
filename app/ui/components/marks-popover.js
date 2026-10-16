import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { navigate } from '../route.js';
import { findMarkRange, markHighlight } from '../mark-ranges.js';

/**
 * @param {{owner:string,marks:any[]}} props
 */
export function MarksPopover({ owner, marks }) {
  const actions = useActions();
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState(null),
    [comment, setComment] = useState('');
  const [expanded, setExpanded] = useState({});
  const anchor = useRef(null),
    pop = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event) => {
      if (!pop.current?.contains(event.target) && !anchor.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  async function locate(mark) {
    setOpen(false);
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
  const rect = anchor.current?.getBoundingClientRect();
  return html`<button
      ref=${anchor}
      class="ref-chip marks-toggle"
      aria-expanded=${open}
      onClick=${() => setOpen(!open)}
    >
      ${t('标记 {count}', { count: marks.length })}
    </button>
    ${
      open &&
      html`<div
        ref=${pop}
        class="marks-popover"
        role="dialog"
        aria-label=${t('标记')}
        style=${{ left: Math.max(8, Math.min(rect?.left ?? 8, innerWidth - 568)) + 'px', bottom: Math.max(8, innerHeight - (rect?.top ?? innerHeight) + 8) + 'px', width: 'min(560px,calc(100vw - 16px))' }}
      >
        <div class="marks-popover-head">
          <strong>${t('标记 {count}', { count: marks.length })}</strong><span class="spacer"></span
          ><button
            class="marks-clear"
            onClick=${() => actions.attempt(() => actions.changeInput(owner, { op: 'marks-clear' }))}
          >
            ${t('全部清除')}</button
          ><button class="marks-close" aria-label=${t('关闭')} onClick=${() => setOpen(false)}>
            ×
          </button>
        </div>
        <ol class="mark-list">
          ${marks.map(
            (mark) =>
              html`<li class="mark-item" key=${mark.id}>
                <div class="mark-source">
                  ${mark.speaker ?? mark.title}
                  ${mark.location?.page ? t('第 {page} 页', { page: mark.location.page }) : (mark.location?.description ?? '')}
                </div>
                <blockquote
                  class=${`mark-text ${expanded[mark.id] ? 'is-expanded' : ''}`}
                  tabindex="0"
                  onClick=${() => setExpanded({ ...expanded, [mark.id]: !expanded[mark.id] })}
                  onKeyDown=${(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setExpanded({ ...expanded, [mark.id]: !expanded[mark.id] });
                    }
                  }}
                >
                  ${mark.text}
                </blockquote>
                ${
                  editing === mark.id
                    ? html`<textarea
                          aria-label=${t('修改标记备注')}
                          value=${comment}
                          onInput=${(event) => setComment(event.currentTarget.value)}
                        ></textarea
                        ><button
                          class="btn tiny"
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
                        </button>`
                    : html`<p class="mark-comment">${mark.comment}</p>`
                }
                <div class="mark-actions">
                  <button onClick=${() => locate(mark)}>${t('定位')}</button
                  ><button
                    onClick=${() => {
                      setEditing(mark.id);
                      setComment(mark.comment ?? '');
                    }}
                  >
                    ${t('修改备注')}</button
                  ><button
                    onClick=${() => actions.attempt(() => actions.changeInput(owner, { op: 'mark-remove', id: mark.id }))}
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
