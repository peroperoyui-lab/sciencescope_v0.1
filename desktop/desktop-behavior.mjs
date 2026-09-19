// Suppress browser chrome, not the application's own project/orb context menus.
window.addEventListener('contextmenu', event => event.preventDefault(), true);
window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if (key === 'f12' || ((event.ctrlKey || event.metaKey) &&
      ((event.shiftKey && ['i', 'j', 'c'].includes(key)) || key === 'u'))) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);
