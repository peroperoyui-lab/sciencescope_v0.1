// One small anchored menu for composer choices. No route change or chat remount.
export function composerMenu(trigger, label, items) {
  closeMenu();
  menu(items.map(item => ({text:item.label, act:item.action, attrs:item.attrs || '', check:item.selected})), trigger, label);
  const popup = document.getElementById('v-menu');
  popup.classList.add('composer-choice-menu');
  for (const [index, button] of [...popup.querySelectorAll('.menu-line')].entries()) {
    const item = items[index];
    if (item.caution) button.classList.add('policy-caution');
    if (item.description) {
      const info = document.createElement('span');
      info.className = 'choice-info'; info.textContent = 'ⓘ';
      info.tabIndex = 0; info.setAttribute('aria-label', item.description);
      const tip = document.createElement('span');
      tip.className = 'choice-tooltip'; tip.role = 'tooltip'; tip.textContent = item.description;
      info.append(tip); button.append(info);
    }
  }
  const anchor = trigger.getBoundingClientRect();
  popup.style.maxHeight = `${Math.max(100, anchor.top - 16)}px`;
  popup.style.top = `${Math.max(8, anchor.top - popup.offsetHeight - 8)}px`;
  popup.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - popup.offsetWidth - 8))}px`;
}
