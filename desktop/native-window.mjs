// Only the bundled Tauri page receives these scoped native window permissions.
import {hostRequest} from './host-client.mjs';
// The prototype still owns its browser-window fallback; this bridge only asks
// the desktop host for a bounded, same-origin native surface.
const SECONDARY_SURFACES = new Set(['assistant', 'map', 'browser', 'quick']);
const surface = new URLSearchParams(location.search).get('surface');
const invoke = (...args) => window.__TAURI__.core.invoke(...args);
let suppressClickUntil = 0;

function applyAssistantMode(mode) {
  if (surface === 'assistant-orb')document.querySelector('.assistant-orb')?.setAttribute('aria-expanded',String(mode==='expanded'));
}

async function toggleAssistant() {
  const mode = await invoke('get_assistant_mode');
  applyAssistantMode(await invoke('set_assistant_mode', {mode:mode==='orb'?'expanded':'orb'}));
}

async function openNativeSurface({surface, projectId, toggle = false, collapsed = false} = {}) {
  if (!SECONDARY_SURFACES.has(surface)) throw new Error(`Unsupported window surface: ${surface}`);
  if (surface === 'quick' && (typeof projectId !== 'string' || !projectId)) {
    throw new Error('projectId is required for a quick window');
  }
  if (projectId !== undefined && !['map', 'quick'].includes(surface)) {
    throw new Error('projectId is only supported for map or quick windows');
  }
  if (projectId !== undefined && typeof projectId !== 'string') {
    throw new Error('projectId must be a string');
  }
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke !== 'function') return false;
  return invoke('open_secondary_window', {
    request: {surface, project_id: projectId ?? null, toggle:surface==='assistant' && toggle, collapsed:surface==='assistant' && collapsed},
  });
}

window.ScienceScopeWindows = Object.freeze({
  open: openNativeSurface,
  async hideAssistant(){if(typeof window.__TAURI__?.core?.invoke!=='function')throw new Error('请在桌面客户端操作。');await invoke('hide_assistant');},
  isNative: () => typeof window.__TAURI__?.core?.invoke === 'function',
});

// Apply launch preference once in the main WebView, never in a secondary window.
if(!surface&&window.__TAURI__?.core?.invoke){
  void hostRequest('assistant-window/preferences').then(async ({startup})=>{
    if(startup==='orb'||startup==='expanded')await openNativeSurface({surface:'assistant',collapsed:startup==='orb'});
  }).catch(()=>{console.warn('Assistant launch preference could not be applied.');});
}

window.addEventListener('mousedown', async event => {
  if (event.button !== 0 || !window.__TAURI__?.window) return;
  const bar = event.target.closest('.topbar,.detached-shell > .panelhead,.temporary-chat-shell > .mainhead');
  if (!bar || event.target.closest('button,a,input,select,textarea')) return;
  event.preventDefault();
  try { await window.__TAURI__.window.getCurrentWindow().startDragging(); } catch { /* Window may be closing. */ }
},true);
// Drag begins only after movement: a click expands, a drag never does.
window.addEventListener('pointerdown', event => {
  if (event.button!==0 || !event.target.closest('.assistant-orb') || !window.__TAURI__) return;
  const {screenX:x,screenY:y}=event;
  const move=async next=>{
    if(Math.hypot(next.screenX-x,next.screenY-y)<5)return;
    cleanup();suppressClickUntil=Date.now()+600;
    try {await window.__TAURI__.window.getCurrentWindow().startDragging();}catch{}
    suppressClickUntil=Date.now()+300;
  };
  const cleanup=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',cleanup);};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',cleanup,{once:true});
},true);
window.addEventListener('contextmenu',event=>{
  if(!event.target.closest('.assistant-orb')||!window.__TAURI__)return;
  event.preventDefault();event.stopImmediatePropagation();
  void invoke('show_assistant_menu').catch(()=>toast('菜单打开失败。'));
},true);
window.addEventListener('click',async event=>{
  if(!window.__TAURI__)return;
  const target=event.target.closest('[data-v="toggle-orb"]');
  if(!target)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(Date.now()<suppressClickUntil)return;
  try {await toggleAssistant();}catch{toast('助手窗口切换失败。');}
},true);
if(window.__TAURI__ && ['assistant','assistant-orb'].includes(surface)) {
  window.__TAURI__.event.listen('assistant-mode', event=>applyAssistantMode(event.payload));
  invoke('get_assistant_mode').then(applyAssistantMode).catch(()=>{});
}
window.addEventListener('dblclick', async event => {
  if (!window.__TAURI__?.window || !event.target.closest('.topbar') || event.target.closest('button,a,input,select,textarea')) return;
  try { await window.__TAURI__.window.getCurrentWindow().toggleMaximize(); } catch { /* Window may be closing. */ }
},true);
window.addEventListener('click', async event => {
  const button = event.target.closest('[data-v="window-info"]');
  const closeButton = event.target.closest('[data-v="close-window"]');
  const native = window.__TAURI__?.window;
  if ((!button && !closeButton) || !native) return;
  event.preventDefault(); event.stopImmediatePropagation();
  try {
    const current = native.getCurrentWindow();
    // Dispatch on the glyph, not the title: the title is translated in the
    // English interface (the × did nothing there, found 2026-09-26).
    const glyph = button?.textContent.trim();
    if (closeButton || glyph === '×') await current.close();
    else if (glyph === '−') await current.minimize();
    else if (glyph === '□') await current.toggleMaximize();
  } catch { toast('窗口操作未完成，请重试。'); }
}, true);
