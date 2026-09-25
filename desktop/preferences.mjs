import {infoTip} from './info-tip.mjs';
import {hostRequest} from './host-client.mjs';
import {settingsContent,settingsNavigation,settingsEntries} from './settings.mjs';

// UI identity is deliberately separate from research/runtime context.
let profile = {displayName:'用户', bio:''};
const profileChannel=new BroadcastChannel('sciencescope-local-profile');
const baseQuickPage=quickPage;
quickPage=(...args)=>baseQuickPage(...args).replace('Joy，继续吧',`${esc(profile.displayName)}，继续吧`);
function refreshIdentity() {
  const label=document.querySelector('.userbar > .grow');if(label)label.textContent=profile.displayName;
  const avatar=document.querySelector('.userbar > .avatar');if(avatar)avatar.textContent=[...profile.displayName][0]||'用';
  for(const greeting of document.querySelectorAll('.profile-greeting'))greeting.textContent=`${profile.displayName}，从一个问题开始，和你的研究小组一起推进。`;
  for(const head of document.querySelectorAll('.message.user .messagehead')) {
    const name=[...head.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim());
    if(name)name.textContent=profile.displayName+' ';
  }
}
profileChannel.onmessage=async()=>{try{profile=await hostRequest('profile');refreshIdentity();}catch{}};
settingsPage = function() {
  const shell=content=>`<div class="settings">${settingsNavigation()}<div class="settingscontent"><div class="settingform">${content}</div></div></div>`;
  if (route !== 'general') return shell(settingsContent(route));
  const form = `<section class="card profile-settings"><h2>个人资料${infoTip('仅用于本机界面显示，不会自动发送给专家或写入研究上下文。',{label:'个人资料说明'})}</h2>
    <form id="local-profile-form"><div class="field"><label for="profile-name">显示名称</label><input id="profile-name" maxlength="80" required value="${esc(profile.displayName)}"></div>
    <div class="field"><label for="profile-bio">个人简介</label><textarea id="profile-bio" maxlength="2000">${esc(profile.bio)}</textarea></div>
    <p id="profile-feedback" role="status"></p><button class="btn primary" type="submit">保存个人资料</button></form></section>`;
  return shell(form+settingsContent('general'));
};
const baseSidebar = sidebar;
sidebar = function() {
  return baseSidebar().replace('<span class="avatar">J</span>', `<span class="avatar">${esc([...profile.displayName][0]||'用')}</span>`)
    .replace('<span class="grow" style="font-size:12px">Joy</span>', `<button class="grow profile-entry" data-profile-open title="编辑个人资料">${esc(profile.displayName)}</button>`);
};
window.addEventListener('click',event=>{if(event.target.closest('[data-profile-open]')){event.preventDefault();event.stopImmediatePropagation();go('general');document.getElementById('profile-name')?.focus();}},true);
window.ScienceScopeProfile = {name:()=>profile.displayName};
window.addEventListener('submit', async event => {
  if (event.target.id !== 'local-profile-form') return;
  event.preventDefault(); event.stopImmediatePropagation();
  const form = event.target, button = form.querySelector('button');
  const input = {displayName:form.querySelector('#profile-name').value.trim(),bio:form.querySelector('#profile-bio').value};
  if (!input.displayName) {form.querySelector('#profile-feedback').textContent='请填写显示名称。';return;}
  button.disabled=true;
  try {profile=await hostRequest('profile',input);profileChannel.postMessage('changed');render();toast('个人资料已保存到本机。');}
  catch {form.querySelector('#profile-feedback').textContent='保存失败，内容仍保留在表单中，请重试。';button.disabled=false;}
},true);
window.ScienceScopeProfile.ready = hostRequest('profile').then(value=>{profile=value;render();}).catch(()=>{});

const basePaletteItems = paletteItems;
paletteItems = () => [...settingsEntries.map(([target,label])=>({label,category:'设置',act:()=>go(target)})),
  ...basePaletteItems().filter(item=>item.label!=='模型与 API 设置')];
let searchTicket=0,searchTimer;
updatePalette = function(query) {
  const ticket=++searchTicket;clearTimeout(searchTimer);
  const q=query.trim().toLocaleLowerCase();
  paletteMatches=paletteItems().filter(item=>q ? (item.label+' '+item.category).toLocaleLowerCase().includes(q) : item.category==='设置')
    .sort((a,b)=>Number(b.category==='设置')-Number(a.category==='设置'));
  V.paletteIndex=Math.min(V.paletteIndex,Math.max(0,paletteMatches.length-1));
  const paint=()=>{const box=document.querySelector('#command-results');if(!box)return;box.innerHTML=paletteMatches.map((item,index)=>vbtn(
    `${ic(item.category==='设置'?'gear':'search')}<span class="grow">${esc(item.label)}<small style="display:block;margin-top:4px">${esc(item.category)}</small></span>`,
    'command-run',`data-i="${index}" role="option" aria-selected="${index===V.paletteIndex}"`,index===V.paletteIndex?'sel':'')).join('')||'<div class="empty">没有匹配项</div>';};
  paint();
  if(q)searchTimer=setTimeout(async()=>{try{
    const found=await hostRequest('chat/search?q='+encodeURIComponent(query.trim()));
    if(ticket!==searchTicket||!document.querySelector('#command-results'))return;
    paletteMatches.push(...found.results.map(item=>({label:item.excerpt,category:'对话 · '+item.title,act:()=>window.ScienceScopeWorkspace.openMessage(item.chatId,item.messageId)})));
    paint();
  }catch{if(ticket===searchTicket)toast('聊天记录搜索暂不可用。');}},180);
};
