// The design system Splitter: drag the edge of a side panel to resize it,
// double-click to restore the default, ← → in 16px steps (Shift: 64px).
// The width is applied to the parent while dragging and saved once at the end.
import { useRef } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';

/**
 * @param {{ side: 'start' | 'end', width: number, min: number, max: number,
 *   defaultWidth: number, onCommit: (width: number) => void }} props
 */
export function Splitter({ side, width, min, max, defaultWidth, onCommit }) {
  const drag = useRef(/** @type {{ x: number, width: number, next: number } | null} */ (null));
  // A panel on the right grows when the pointer moves left.
  const direction = side === 'start' ? -1 : 1;
  const clamp = (value) => Math.max(min, Math.min(max, Math.round(value)));
  /** @param {HTMLElement} handle @param {number} value */
  const apply = (handle, value) => {
    /** @type {HTMLElement} */ (handle.parentElement).style.width = `${value}px`;
    handle.setAttribute('aria-valuenow', String(value));
  };
  return html`<div
    class=${`ss-splitter ss-splitter--${side}`}
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    aria-label=${t('调整宽度')}
    aria-valuemin=${min}
    aria-valuemax=${max}
    aria-valuenow=${width}
    data-tip=${t('拖动调整宽度，双击恢复默认')}
    onPointerDown=${(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      handle.setAttribute('data-dragging', '');
      document.documentElement.setAttribute('data-resizing', '');
      const start = handle.parentElement.getBoundingClientRect().width;
      drag.current = { x: event.clientX, width: start, next: start };
    }}
    onPointerMove=${(event) => {
      if (!drag.current) return;
      drag.current.next = clamp(drag.current.width + direction * (event.clientX - drag.current.x));
      apply(event.currentTarget, drag.current.next);
    }}
    onPointerUp=${(event) => {
      if (!drag.current) return;
      event.currentTarget.removeAttribute('data-dragging');
      document.documentElement.removeAttribute('data-resizing');
      const { next } = drag.current;
      drag.current = null;
      if (next !== width) onCommit(next);
    }}
    onDblClick=${(event) => {
      apply(event.currentTarget, defaultWidth);
      onCommit(defaultWidth);
    }}
    onKeyDown=${(event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const step = (event.shiftKey ? 64 : 16) * (event.key === 'ArrowRight' ? 1 : -1);
      const next = clamp(width + direction * step);
      apply(event.currentTarget, next);
      onCommit(next);
    }}
  ></div>`;
}
