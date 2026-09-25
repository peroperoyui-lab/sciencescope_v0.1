// Info tips: the single way to show explanatory text (user request 2026-09-25).
// Pages keep only labels, values, status and errors; explanations sit behind a
// small "i" beside the heading, label or option they explain. Hover or focus
// previews the tip, a click pins it, Esc / outside click / scroll closes it.
// Loaded first so its capture listener runs before menu and action handlers:
// clicking an "i" inside a menu item or a <label> never activates that item.

const escText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[ch]);

/** HTML for an info tip. Use `tag:'span'` inside another button (menu items). */
export function infoTip(text, {label = '说明', tag = 'button'} = {}) {
  const attrs = `class="info-tip" data-info-tip="${escText(text)}" aria-label="${escText(label)}" aria-expanded="false"`;
  return tag === 'span'
    ? `<span ${attrs} role="button" tabindex="0"><span aria-hidden="true">i</span></span>`
    : `<button type="button" ${attrs}><span aria-hidden="true">i</span></button>`;
}

let pop = null, owner = null, pinned = false, hoverTimer = 0, restoring = false;

function place() {
  if (!pop || !owner?.isConnected) return close();
  const anchor = owner.getBoundingClientRect(), gap = 6;
  const width = pop.offsetWidth, height = pop.offsetHeight;
  const below = anchor.bottom + gap + height <= innerHeight - 8 || anchor.top - gap - height < 8;
  pop.dataset.side = below ? 'below' : 'above';
  const top = below ? anchor.bottom + gap : anchor.top - gap - height;
  const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - 20, innerWidth - width - 8));
  pop.style.top = `${top}px`; pop.style.left = `${left}px`;
  // Inside a transformed container (an animating <dialog>) fixed is not viewport-relative.
  const actual = pop.getBoundingClientRect();
  if (Math.abs(actual.top - top) > 1 || Math.abs(actual.left - left) > 1) {
    pop.style.top = `${2 * top - actual.top}px`; pop.style.left = `${2 * left - actual.left}px`;
  }
}

function open(target, pin) {
  clearTimeout(hoverTimer);
  if (owner !== target) close();
  owner = target; pinned = pinned || pin;
  if (!pop) {
    pop = document.createElement('div');
    pop.className = 'info-pop'; pop.id = 'info-pop'; pop.setAttribute('role', 'tooltip');
  }
  // A modal <dialog> sits in the top layer; the tip must live inside it to show.
  const host = target.closest('dialog[open]') || document.body;
  if (pop.parentElement !== host) host.append(pop);
  pop.replaceChildren(...String(target.dataset.infoTip).split('\n').filter(Boolean).map(line => { const p = document.createElement('p'); p.textContent = line; return p; }));
  target.setAttribute('aria-expanded', 'true'); target.setAttribute('aria-describedby', 'info-pop');
  place();
}

function close() {
  clearTimeout(hoverTimer);
  pop?.remove(); pop = null; pinned = false;
  if (owner) { owner.setAttribute('aria-expanded', 'false'); owner.removeAttribute('aria-describedby'); }
  owner = null;
}

// Pure HTML rendering above also serves Node unit tests; wiring needs a page.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const tipOf = event => event.target.closest?.('[data-info-tip]');

  for (const type of ['pointerdown', 'mousedown']) {
    window.addEventListener(type, event => {
      if (tipOf(event)) { event.stopImmediatePropagation(); if (type === 'mousedown') event.preventDefault(); return; }
      if (pinned && !event.target.closest?.('.info-pop')) close();
    }, true);
  }
  window.addEventListener('click', event => {
    const tip = tipOf(event); if (!tip) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (owner === tip && pinned) close(); else open(tip, true);
  }, true);
  window.addEventListener('keydown', event => {
    const tip = tipOf(event);
    if (tip && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (owner === tip && pinned) close(); else open(tip, true);
    } else if (event.key === 'Escape' && pop && !event.isComposing) {
      event.preventDefault(); event.stopImmediatePropagation();
      const back = owner; close(); restoring = true; back?.focus?.(); restoring = false;
    }
  }, true);
  document.addEventListener('pointerover', event => {
    const tip = tipOf(event); if (!tip || pinned) return;
    clearTimeout(hoverTimer); hoverTimer = setTimeout(() => open(tip, false), 250);
  });
  document.addEventListener('pointerout', event => {
    const tip = tipOf(event); if (!tip || pinned) return;
    if (tip.contains(event.relatedTarget)) return;
    clearTimeout(hoverTimer); if (owner === tip) close();
  });
  document.addEventListener('focusin', event => { const tip = tipOf(event); if (tip && !pinned && !restoring && event.target.matches(':focus-visible')) open(tip, false); });
  document.addEventListener('focusout', event => { if (tipOf(event) && !pinned) close(); });
  window.addEventListener('scroll', () => { if (pop) close(); }, true);
  window.addEventListener('resize', () => { if (pop) close(); });
  // A tip whose owner re-rendered away closes itself.
  new MutationObserver(() => { if (owner && !owner.isConnected) close(); }).observe(document.documentElement, {childList: true, subtree: true});

  window.ScienceScopeInfoTip = Object.freeze({infoTip, close});
}
