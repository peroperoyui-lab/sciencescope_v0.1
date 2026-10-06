import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { InfoTip } from './info-tip.js';

/** Anchored composer menu in the approved legacy markup. @param {{label:string,items:any[],className?:string,disabled?:boolean,children:any}} props */
export function DiscussionMenu({ label, items, className = '', disabled = false, children }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 300 });
  const trigger = useRef(null);
  const popup = useRef(null);
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = trigger.current.getBoundingClientRect();
    const height = popup.current.offsetHeight;
    const above = anchor.top - 16;
    const below = innerHeight - anchor.bottom - 16;
    const up = height <= above || above >= below;
    setPosition({
      left: Math.max(8, Math.min(anchor.left, innerWidth - popup.current.offsetWidth - 8)),
      top: up ? Math.max(8, anchor.top - Math.min(height, above) - 8) : anchor.bottom + 8,
      maxHeight: Math.max(100, up ? above : below),
    });
  }, [open, items.length]);
  useEffect(() => {
    if (!open) return;
    const close = (event) => {
      if (event.type === 'keydown') {
        if (event.key === 'Escape') setOpen(false);
        return;
      }
      if (!trigger.current?.contains(event.target) && !popup.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return html`<button
      type="button"
      ref=${trigger}
      class=${className}
      data-v=${className ? '' : 'mode-menu'}
      data-panel-reviewer-menu=${className ? '' : undefined}
      aria-label=${label}
      aria-expanded=${open}
      aria-haspopup="menu"
      disabled=${disabled}
      onClick=${() => setOpen(!open)}
    >
      ${children}<${Icon} name="down" />
    </button>
    ${
      open &&
      html`<div
        ref=${popup}
        class="menu-popup composer-choice-menu"
        role="menu"
        aria-label=${label}
        style=${{ position: 'fixed', left: position.left + 'px', top: position.top + 'px', maxHeight: position.maxHeight + 'px', overflowY: 'auto' }}
      >
        <div class="menu-label">${label}</div>
        ${items.map((item) =>
          item.heading
            ? html`<div class="menu-label" role="presentation">${item.text}</div>`
            : html`<div class="menu-line">
                <button
                  type="button"
                  style="display:flex;align-items:center;gap:9px;flex:1;border:0;background:none;color:inherit;text-align:left;padding:0"
                  role="menuitemcheckbox"
                  aria-checked=${item.selected}
                  onClick=${() => {
                    setOpen(false);
                    item.run();
                  }}
                >
                  <span class="menu-check">${item.selected ? '✓' : ''}</span
                  ><span class="menu-text">${item.text}</span></button
                >${item.description && html`<${InfoTip} text=${item.description} label=${t('{name}说明', { name: item.text })} />`}
              </div>`,
        )}
      </div>`
    }`;
}
