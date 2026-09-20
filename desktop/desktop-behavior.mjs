// Suppress browser chrome, not the application's own project/orb context menus.
window.addEventListener('contextmenu', event => event.preventDefault(), true);
window.addEventListener('keydown', event => {
  if(window.ScienceScopeShortcuts?.handleKey(event))return;
  const key = event.key.toLowerCase();
  if(key==='enter'&&!event.isComposing&&event.target.matches('[data-draft="main"],[data-assistant-input]')&&window.ScienceScopePreferences?.get().sendKey==='ctrl-enter'&&!event.ctrlKey&&!event.metaKey){event.stopImmediatePropagation();return;}
  if (['f12','f5','f7'].includes(key) || (event.altKey&&['arrowleft','arrowright','home'].includes(key)) || ((event.ctrlKey || event.metaKey) &&
      ((event.shiftKey && ['i', 'j', 'c'].includes(key)) || ['u','r','p','s','l','o','j'].includes(key)))) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);
// A file dropped outside an application drop target must never navigate WebView.
window.addEventListener('dragover',event=>{
  if([...event.dataTransfer?.types||[]].includes('Files'))event.preventDefault();
});
window.addEventListener('drop',event=>{
  if([...event.dataTransfer?.types||[]].includes('Files'))event.preventDefault();
});
