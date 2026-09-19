// Live layout changes use the existing DOM: no composer remount during animations.
const baseFlyout = showFlyout;
const baseRender = render;
let closeTimer;
let renderedPanel=null;

export function syncWorkspaceLayout() {
  const layout = document.querySelector('.chatlayout');
  const column = layout?.querySelector('.chatcol');
  if (!column) return;
  const panel = layout.querySelector(':scope > .rightpanel');
  if (panel) {
    const slot = document.createElement('div');
    slot.className = 'workspace-panel-slot'+(renderedPanel===V.panel?' is-open':'');
    panel.replaceWith(slot); slot.append(panel);
    if(!slot.classList.contains('is-open'))requestAnimationFrame(()=>{void slot.offsetWidth;slot.classList.add('is-open');});
  }
  column.classList.toggle('summary-docked', !!V.overview && !V.panel);
  renderedPanel=V.panel;
  document.getElementById('overview-trigger')?.setAttribute('aria-expanded',String(!!V.overview));
  for (const kind of ['browser','secretary']) document.querySelector(`.mainhead [data-v="${kind}"]`)?.setAttribute('aria-expanded',String(V.panel===kind));
}

showFlyout = function() {
  document.getElementById('project-flyout')?.remove();
  if (V.overview && !window.ScienceScopeWorkspace?.focusedProject()) V.overview = false;
  if (V.overview) {
    baseFlyout();
    const flyout = document.getElementById('project-flyout');
    const column = document.querySelector('.chatcol');
    if (column && flyout) { column.append(flyout); flyout.classList.add('workspace-summary'); }
  }
  syncWorkspaceLayout();
};

export function toggleSummary(force) {
  V.overview = force ?? !V.overview;
  showFlyout();
}

openPanel = function(type) {
  const next = V.panel === type ? null : type;
  const layout = document.querySelector('.chatlayout');
  if (!layout) {
    V.panel=next; if(next) V.overview=false;
    go('work'); render(); return;
  }
  clearTimeout(closeTimer);
  if (next) {
    // Opening a sidebar dismisses the existing summary. Reopening the summary
    // while that sidebar is visible overlays the chat without reserving width.
    V.overview=false; V.panel=next; showFlyout();
    let slot=layout.querySelector('.workspace-panel-slot');
    if (!slot) { slot=document.createElement('div'); slot.className='workspace-panel-slot'; layout.append(slot); }
    slot.innerHTML=rightPanel(next);
    void slot.offsetWidth;
    slot.classList.add('is-open');
    bindResize();
  } else {
    V.panel=null;
    const slot=layout.querySelector('.workspace-panel-slot');
    slot?.classList.remove('is-open');
    closeTimer=setTimeout(()=>{if(!V.panel)slot?.remove();},230);
    // A reopened overlay survives closing the sidebar and becomes docked.
    syncWorkspaceLayout();
  }
  syncWorkspaceLayout();
};

render=function() {
  baseRender();
  syncWorkspaceLayout();
  window.ScienceScopeWorkspace?.afterRender();
};
window.removeEventListener('hashchange',baseRender);
window.addEventListener('hashchange',()=>render());
window.SS.render=()=>render();

window.addEventListener('click',event=>{
  const button=event.target.closest('[data-v],[data-action]');
  const action=button?.dataset.v || button?.dataset.action;
  if (!['overview','overview-close','close-panel','browser','secretary'].includes(action)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if(action==='overview')toggleSummary();
  else if(action==='overview-close')toggleSummary(false);
  else if(action==='close-panel') { if(V.panel)openPanel(V.panel); }
  else openPanel(action);
},true);
window.addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(event.altKey&&event.key.toLowerCase()==='s') { event.preventDefault();event.stopImmediatePropagation();toggleSummary(); }
  else if(event.key==='Escape'&&V.overview&&!V.menu&&!V.palette&&!V.editor&&!document.querySelector('dialog[open]')) {
    event.preventDefault();event.stopImmediatePropagation();toggleSummary(false);
  }
},true);
// The legacy outside-click handler can dismiss the flyout; release reserved space.
window.addEventListener('click',()=>syncWorkspaceLayout());
