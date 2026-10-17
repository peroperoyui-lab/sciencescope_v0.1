// Anchored layers in the design system's markup: a hook that opens a layer
// beside its trigger (flipping when it does not fit) and closes it on Esc or
// a click outside, and the choice menu built on it (`ss-menu`).
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { html } from '../html.js';
import { Lucide } from '../icons.js';
import { place } from '../floating.js';

/**
 * @param {{ placement?: string, onClose?: () => void }} [options]
 */
export function usePopover({ placement = 'top-start', onClose } = {}) {
  const [open, setOpen] = useState(false);
  /** @type {{ current: HTMLElement | null }} */
  const trigger = useRef(null);
  /** @type {{ current: HTMLElement | null }} */
  const layer = useRef(null);
  useLayoutEffect(() => {
    if (open && trigger.current && layer.current)
      place(layer.current, trigger.current.getBoundingClientRect(), placement, 4);
  });
  useEffect(() => {
    if (!open) return undefined;
    const close = (focus = false) => {
      setOpen(false);
      onClose?.();
      if (focus) trigger.current?.focus();
    };
    /** @param {PointerEvent} event */
    const outside = (event) => {
      const target = /** @type {Node} */ (event.target);
      if (!trigger.current?.contains(target) && !layer.current?.contains(target)) close();
    };
    /** @param {KeyboardEvent} event */
    const key = (event) => {
      if (event.key !== 'Escape') return;
      // Esc closes the topmost layer first; it must not also stop the answer.
      event.stopPropagation();
      event.preventDefault();
      close(true);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return { open, setOpen, trigger, layer, toggle: () => setOpen(!open) };
}

/** Arrow keys move between the enabled items of a menu or list. @param {KeyboardEvent} event */
export function moveFocus(event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const container = /** @type {HTMLElement} */ (event.currentTarget);
  const items = [
    ...container.querySelectorAll('[role^="menuitem"]:not([aria-disabled="true"]),[role="option"]'),
  ].filter((item) => !(/** @type {HTMLButtonElement} */ (item).disabled));
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(/** @type {Element} */ (document.activeElement));
  const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
  /** @type {HTMLElement} */ (items[(next + items.length) % items.length]).focus();
}

/**
 * @typedef {{ text: string, icon?: string, description?: string, selected?: boolean,
 *   disabled?: boolean, auto?: boolean, run: () => void } | { group: string }} Choice
 */

/**
 * A trigger button and its single-choice menu (`menuitemradio` items).
 * @param {{ label: string, items: Choice[], children: any, triggerClass?: string,
 *   tip?: string, disabled?: boolean, placement?: string, attrs?: Record<string, any> }} props
 */
export function ChoiceMenu({
  label,
  items,
  children,
  triggerClass = 'ss-btn ss-btn--ghost ss-btn--sm',
  tip,
  disabled = false,
  placement = 'top-start',
  attrs = {},
}) {
  const menu = usePopover({ placement });
  useEffect(() => {
    if (menu.open)
      /** @type {HTMLElement | null | undefined} */ (
        menu.layer.current?.querySelector('[aria-checked="true"]') ??
          menu.layer.current?.querySelector('[role="menuitemradio"]')
      )?.focus();
  }, [menu.open]);
  return html`<button
      type="button"
      ref=${menu.trigger}
      class=${triggerClass}
      aria-label=${label}
      aria-haspopup="menu"
      aria-expanded=${menu.open}
      data-tip=${tip ?? label}
      disabled=${disabled}
      onClick=${menu.toggle}
      ...${attrs}
    >
      ${children}<${Lucide} name="chevron-down" />
    </button>
    ${
      menu.open &&
      html`<div
        ref=${menu.layer}
        class="ss-menu"
        role="menu"
        aria-label=${label}
        onKeyDown=${moveFocus}
      >
        ${items.map((item) =>
          'group' in item
            ? html`<div class="ss-menu__label ss-truncate">${item.group}</div>`
            : html`<button
                type="button"
                role="menuitemradio"
                class=${`ss-menu__item ${item.description ? 'ss-menu__item--rich' : ''} ${item.auto ? 'ss-menu__item--auto' : ''}`}
                aria-label=${item.text}
                aria-description=${item.description}
                aria-checked=${String(Boolean(item.selected))}
                aria-disabled=${item.disabled ? 'true' : undefined}
                onClick=${() => {
                  if (item.disabled) return;
                  menu.setOpen(false);
                  menu.trigger.current?.focus();
                  item.run();
                }}
              >
                ${item.icon && html`<${Lucide} name=${item.icon} />`}
                ${
                  item.description
                    ? html`<span class="ss-menu__text"
                        ><span>${item.text}</span
                        ><span class="ss-menu__desc">${item.description}</span></span
                      >`
                    : html`<span>${item.text}</span>`
                }
                <${Lucide} name="check" class="ss-menu__check" />
              </button>`,
        )}
      </div>`
    }`;
}
