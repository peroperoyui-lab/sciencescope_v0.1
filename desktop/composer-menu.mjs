import {infoTip} from './info-tip.mjs';
// One small anchored menu for composer choices. No route change or chat remount.
export function composerMenu(trigger, label, items) {
  closeMenu();
  menu(items.map(item => ({text:item.label, act:item.action, attrs:item.attrs || '', check:item.selected})), trigger, label);
  const popup = document.getElementById('v-menu');
  popup.classList.add('composer-choice-menu');
  for (const [index, button] of [...popup.querySelectorAll('.menu-line')].entries()) {
    const item = items[index];
    if(item.userLabel)button.querySelector('.menu-text')?.setAttribute('data-i18n-skip','');
    if (item.heading) {
      const heading=document.createElement('div');heading.className='menu-label';heading.setAttribute('role','presentation');heading.textContent=item.label;
      if(item.headingId)heading.dataset.reviewerGroup=item.headingId;
      button.replaceWith(heading);continue;
    }
    if (item.caution) button.classList.add('policy-caution');
    if (item.description) {
      button.insertAdjacentHTML('beforeend', infoTip(item.description, {label: `${item.label}说明`, tag: 'span'}));
    }
  }
  const anchor = trigger.getBoundingClientRect();
  // Open above the trigger (composer menus) unless there is less room there
  // than below (e.g. the reviewer picker in the discussion bar at the top);
  // the menu scrolls rather than letting items spill outside its box.
  const above = anchor.top - 16, below = innerHeight - anchor.bottom - 16;
  const up = popup.scrollHeight <= above || above >= below;
  popup.style.maxHeight = `${Math.max(100, up ? above : below)}px`;
  popup.style.overflowY = 'auto';
  popup.style.top = up ? `${Math.max(8, anchor.top - popup.offsetHeight - 8)}px` : `${anchor.bottom + 8}px`;
  popup.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - popup.offsetWidth - 8))}px`;
}
