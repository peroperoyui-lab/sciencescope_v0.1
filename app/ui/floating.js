// Placement of floating layers and the shared tooltip, ported from the design
// system's gallery script (docs/design/system/build/bundle.src.js).
const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * Put a fixed element beside an anchor rectangle: the preferred side, flipped
 * when it does not fit, then shifted into the window.
 * @param {HTMLElement} element
 * @param {{ left: number, right: number, top: number, bottom: number, width: number, height: number }} anchor
 * @param {string} [placement] side-align, e.g. 'top-start'
 * @param {number} [gap]
 */
export function place(element, anchor, placement = 'bottom-start', gap = 4) {
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  const margin = 8;
  element.style.left = '0px';
  element.style.top = '0px';
  const box = element.getBoundingClientRect();
  const [preferred, align = 'center'] = placement.split('-');
  let side = preferred;
  const fits = {
    bottom: anchor.bottom + gap + box.height <= height - margin,
    top: anchor.top - gap - box.height >= margin,
    right: anchor.right + gap + box.width <= width - margin,
    left: anchor.left - gap - box.width >= margin,
  };
  if (!fits[side] && fits[OPPOSITE[side]]) side = OPPOSITE[side];
  let x;
  let y;
  if (side === 'top' || side === 'bottom') {
    y = side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - box.height;
    x =
      align === 'start'
        ? anchor.left
        : align === 'end'
          ? anchor.right - box.width
          : anchor.left + (anchor.width - box.width) / 2;
  } else {
    x = side === 'right' ? anchor.right + gap : anchor.left - gap - box.width;
    y =
      align === 'start'
        ? anchor.top
        : align === 'end'
          ? anchor.bottom - box.height
          : anchor.top + (anchor.height - box.height) / 2;
  }
  element.style.left = `${Math.round(Math.max(margin, Math.min(x, width - box.width - margin)))}px`;
  element.style.top = `${Math.round(Math.max(margin, Math.min(y, height - box.height - margin)))}px`;
  element.dataset.side = side;
}

/**
 * Tooltips for every element with `data-tip` (and optional `data-kbd`): after
 * 500 ms, at once while another tip was just shown, and on keyboard focus.
 */
export function installTooltips() {
  /** @type {HTMLElement | null} */
  let tip = null;
  /** @type {Element | null} */
  let owner = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let watch;
  let warmUntil = 0;
  const hide = (keepWarm = true) => {
    clearTimeout(timer);
    clearInterval(watch);
    if (tip) {
      tip.remove();
      tip = null;
      if (keepWarm) warmUntil = Date.now() + 400;
    }
    owner = null;
  };
  /** @param {Element} target */
  const show = (target) => {
    const text = target.getAttribute('data-tip');
    if (!text || target.getAttribute('aria-expanded') === 'true' || !target.isConnected) return;
    hide();
    tip = document.createElement('div');
    tip.className = 'ss-tip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;
    const kbd = target.getAttribute('data-kbd');
    if (kbd) {
      const key = document.createElement('span');
      key.className = 'ss-kbd';
      key.textContent = kbd;
      tip.append(key);
    }
    document.body.append(tip);
    place(tip, target.getBoundingClientRect(), target.getAttribute('data-tip-place') ?? 'top', 6);
    owner = target;
    // The owner can re-render away (send becomes stop) without a pointer event.
    watch = setInterval(() => {
      if (!owner?.isConnected) hide(false);
    }, 250);
  };
  /** @param {Event} event */
  const tipTarget = (event) =>
    event.target instanceof Element ? event.target.closest('[data-tip]') : null;
  document.addEventListener('pointerover', (event) => {
    const target = tipTarget(event);
    if (!target || target === owner) return;
    clearTimeout(timer);
    const delay = tip || Date.now() < warmUntil ? 0 : 500;
    timer = setTimeout(() => show(target), delay);
  });
  document.addEventListener('pointerout', (event) => {
    const target = tipTarget(event);
    if (target && !target.contains(/** @type {Node | null} */ (event.relatedTarget))) hide();
  });
  document.addEventListener('focusin', (event) => {
    const target = tipTarget(event);
    if (target?.matches(':focus-visible')) show(target);
  });
  document.addEventListener('focusout', () => hide());
  document.addEventListener('pointerdown', () => hide(false), true);
  addEventListener('scroll', () => hide(false), true);
}
