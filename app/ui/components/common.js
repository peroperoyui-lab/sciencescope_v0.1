// Small pieces used across views: a row menu, an inline name input and the
// "i" info tip that holds explanations.
import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../html.js';
import { Icon } from '../icons.js';

/**
 * A "…" button with a small menu.
 * @param {{ items: Array<{ label: string, run: () => void }>, label: string }} props
 */
export function RowMenu({ items, label }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return html`<span class="rowmenu" ref=${root}>
    <button
      class="iconbtn small"
      aria-label=${label}
      aria-expanded=${open}
      onClick=${(event) => {
        event.stopPropagation();
        setOpen(!open);
      }}
    >
      <${Icon} name="more" />
    </button>
    ${
      open &&
      html`<div class="menu" role="menu">
        ${items.map(
          (item) =>
            html`<button
              role="menuitem"
              onClick=${(event) => {
                event.stopPropagation();
                setOpen(false);
                item.run();
              }}
            >
              ${item.label}
            </button>`,
        )}
      </div>`
    }
  </span>`;
}

/**
 * A one-line text input that commits on Enter and cancels on Escape.
 * @param {{ value?: string, placeholder: string, onCommit: (text: string) => void,
 *   onCancel: () => void }} props
 */
export function InlineInput({ value = '', placeholder, onCommit, onCancel }) {
  const input = useRef(null);
  useEffect(() => input.current?.focus(), []);
  return html`<input
    class="inline-input"
    ref=${input}
    value=${value}
    placeholder=${placeholder}
    onKeyDown=${(event) => {
      if (event.key === 'Escape') onCancel();
      if (event.key === 'Enter' && !event.isComposing) {
        const text = event.currentTarget.value.trim();
        if (text) onCommit(text);
        else onCancel();
      }
    }}
    onBlur=${onCancel}
  />`;
}

/** @param {{ text: string }} props */
export function InfoTip({ text }) {
  return html`<span class="infotip" tabindex="0" aria-label=${text}>
    i<span class="infotip-body" role="tooltip">${text}</span>
  </span>`;
}

/** @param {{ name: string }} props */
export function Avatar({ name }) {
  return html`<span class="avatar">${(name || '?').trim().slice(0, 1).toUpperCase()}</span>`;
}
