// A centred dialog in the design system's markup (`ss-scrim` > `ss-dialog`):
// title row with a close button, body, and a footer for the actions. Esc or a
// click on the scrim closes it; focus starts on the first field.
import { useEffect, useRef } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

let dialogs = 0;

/**
 * @param {{ title: string, onClose: () => void, children: any, foot: any,
 *   size?: 'sm' | 'md' | 'lg', onSubmit?: () => void }} props
 */
export function Dialog({ title, onClose, children, foot, size = 'md', onSubmit }) {
  const element = useRef(/** @type {HTMLElement | null} */ (null));
  const id = useRef(`ss-dialog-${(dialogs += 1)}`).current;
  useEffect(() => {
    const opener = /** @type {HTMLElement | null} */ (document.activeElement);
    /** @type {HTMLElement | null | undefined} */ (
      element.current?.querySelector('input, textarea, .ss-dialog__foot .ss-btn--primary')
    )?.focus();
    /** @param {KeyboardEvent} event */
    const key = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      opener?.focus?.();
    };
  }, []);
  const submit = (event) => {
    event.preventDefault();
    onSubmit?.();
  };
  return html`<div
    class="ss-scrim"
    onPointerDown=${(event) => event.target === event.currentTarget && onClose()}
  >
    <form
      ref=${element}
      class=${`ss-dialog ${size === 'md' ? '' : `ss-dialog--${size}`}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby=${id}
      onSubmit=${submit}
      novalidate
    >
      <div class="ss-dialog__head">
        <h2 class="ss-dialog__title" id=${id}>${title}</h2>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('关闭')}
          data-tip=${t('关闭')}
          data-kbd="Esc"
          onClick=${onClose}
        >
          <${Lucide} name="x" />
        </button>
      </div>
      <div class="ss-dialog__body">${children}</div>
      <div class="ss-dialog__foot">${foot}</div>
    </form>
  </div>`;
}
