// The "i" info tip: the one place explanations live (old `desktop/info-tip.mjs`).
// Hover or focus previews the text, a click pins it, Esc or a click elsewhere
// closes it.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';

/** @param {{ text: string, label?: string }} props */
export function InfoTip({ text, label }) {
  const [open, setOpen] = useState(/** @type {'' | 'hover' | 'pinned'} */ (''));
  const [position, setPosition] = useState({ left: 0, top: 0, side: 'below' });
  const anchor = useRef(null);
  const pop = useRef(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !pop.current) return;
    const box = anchor.current.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = pop.current;
    const below = box.bottom + 6 + height <= innerHeight - 8 || box.top - 6 - height < 8;
    setPosition({
      side: below ? 'below' : 'above',
      top: below ? box.bottom + 6 : box.top - 6 - height,
      left: Math.max(8, Math.min(box.left + box.width / 2 - 20, innerWidth - width - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (open !== 'pinned') return undefined;
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && anchor.current?.contains(event.target)) return;
      setOpen('');
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close);
    addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close);
      removeEventListener('scroll', close, true);
    };
  }, [open]);

  return html`<button
      type="button"
      class="info-tip"
      ref=${anchor}
      aria-label=${label ?? t('说明')}
      aria-expanded=${Boolean(open)}
      onMouseEnter=${() => !open && setOpen('hover')}
      onMouseLeave=${() => open === 'hover' && setOpen('')}
      onFocus=${() => !open && setOpen('hover')}
      onBlur=${() => open === 'hover' && setOpen('')}
      onClick=${(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOpen(open === 'pinned' ? '' : 'pinned');
      }}
    >
      <span aria-hidden="true">i</span>
    </button>
    ${
      open &&
      html`<div
        class="info-pop"
        role="tooltip"
        ref=${pop}
        data-side=${position.side}
        style=${{ position: 'fixed', top: `${position.top}px`, left: `${position.left}px` }}
      >
        ${text
          .split('\n')
          .filter(Boolean)
          .map((line, index) => html`<p key=${index}>${line}</p>`)}
      </div>`
    }`;
}
