import {hostRequest} from './host-client.mjs';

const labels={search:'搜索与命令',browse:'浏览全部',newChat:'新建项目内对话',independentChat:'独立新对话'};
const defaults={search:'Ctrl+K',browse:'Ctrl+Shift+K',newChat:'Ctrl+N',independentChat:'Ctrl+Alt+N'};
let bindings={...defaults},loaded=false;
const channel=new BroadcastChannel('sciencescope-shortcuts');
function chord(event){return `${event.ctrlKey||event.metaKey?'Ctrl+':''}${event.altKey?'Alt+':''}${event.shiftKey?'Shift+':''}${event.key.toUpperCase()}`;}
export function shortcutsContent(){return `<form data-shortcut-form><h2>快捷键</h2><p>点击输入框后按下组合键。保留复制、粘贴、查找和浏览器保护按键；发送键在常规设置修改。仅在客户端窗口内生效。</p>${Object.entries(labels).map(([id,label])=>`<div class="settingrow"><label for="shortcut-${id}">${label}</label><input id="shortcut-${id}" name="${id}" data-shortcut-input value="${esc(bindings[id])}" readonly ${loaded?'':'disabled'} aria-label="${label}快捷键"></div>`).join('')}<p data-shortcut-feedback role="status"></p><div class="saverow"><button class="btn primary" type="submit" ${loaded?'':'disabled'}>保存并应用</button><button class="btn" type="button" data-shortcut-reset ${loaded?'':'disabled'}>恢复默认快捷键</button></div></form>`;}
function updateHints(){for(const [selector,action] of [['[data-v="command"] kbd','search'],['[data-v="all-chats"] kbd','browse'],['[data-v="new-chat"] kbd','newChat']])for(const element of document.querySelectorAll(selector))if(element.textContent!==bindings[action])element.textContent=bindings[action];for(const element of document.querySelectorAll('[data-v="open-quick"] kbd'))if(element.textContent)element.textContent='';}
new MutationObserver(updateHints).observe(document.body,{childList:true,subtree:true});
function handleKey(event){
  if(event.isComposing||event.keyCode===229)return false;
  if(event.target.matches('[data-shortcut-input]')){
    if(['Tab','Escape'].includes(event.key))return false;
    event.preventDefault();event.stopImmediatePropagation();
    if((event.ctrlKey||event.metaKey)&&/^[a-z]$/i.test(event.key))event.target.value=chord(event);
    return true;
  }
  const key=chord(event),action=Object.keys(bindings).find(id=>bindings[id]===key);
  // Retired defaults must not fall through into the prototype's fixed handlers.
  const legacy=(event.ctrlKey||event.metaKey)&&['k','n'].includes(event.key.toLowerCase());
  if(!action&&!legacy)return false;
  event.preventDefault();event.stopImmediatePropagation();
  if(!action||event.repeat||document.querySelector('dialog[open]'))return true;
  if(new URLSearchParams(location.search).has('surface'))return true;
  if(action==='search')openPalette();
  else if(action==='browse')go('projects');
  else if(action==='newChat')window.ScienceScopeCreation?window.ScienceScopeCreation.newChat(window.ScienceScopeWorkspace?.focusedProject?.()):window.SSV2?.newThread();
  else if(action==='independentChat')window.ScienceScopeCreation?window.ScienceScopeCreation.newChat(null):window.SSV2?.newThread(null);
  return true;
}
window.ScienceScopeShortcuts={handleKey,get:()=>({...bindings})};
async function refresh(){const result=await hostRequest('shortcuts');bindings=result.bindings;loaded=true;updateHints();}
channel.onmessage=()=>void refresh().catch(()=>{});
window.ScienceScopeShortcuts.ready=refresh().then(()=>{if(route==='shortcuts')render();}).catch(()=>{});
window.addEventListener('submit',async event=>{const form=event.target;if(!form.matches('[data-shortcut-form]'))return;event.preventDefault();event.stopImmediatePropagation();const button=form.querySelector('[type="submit"]');button.disabled=true;try{const next=Object.fromEntries(Object.keys(labels).map(id=>[id,form.elements[id].value]));bindings=(await hostRequest('shortcuts',{bindings:next})).bindings;updateHints();channel.postMessage('changed');form.querySelector('[data-shortcut-feedback]').textContent='已保存并应用到所有窗口。';}catch(error){form.querySelector('[data-shortcut-feedback]').textContent=error.message;}finally{button.disabled=false;}},true);
window.addEventListener('click',async event=>{if(!event.target.closest('[data-shortcut-reset]'))return;event.preventDefault();event.stopImmediatePropagation();if(!await window.ScienceScopeWorkspace.confirmAction('恢复默认快捷键','仅恢复此页四项快捷键，不改变发送键或其它设置。','恢复默认'))return;try{bindings=(await hostRequest('shortcuts/reset',{})).bindings;channel.postMessage('changed');render();updateHints();}catch(error){toast(error.message);}},true);
