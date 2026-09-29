import {infoTip} from './info-tip.mjs';
import {LANGUAGES,setLanguage} from './i18n.mjs';
import {hostRequest} from './host-client.mjs';
import {roleSettingsContent} from './role-settings.mjs';
import {extensionsContent} from './extensions.mjs';
import {secretaryPreferencesContent} from './secretary-settings.mjs';
import {shortcutsContent} from './shortcuts.mjs';
import {assistantWindowSettingsContent} from './assistant-window-settings.mjs';
import {expertSettingsContent} from './expert-settings.mjs';
import {semanticSettingsContent} from './semantic-settings.mjs';
import {pythonSettingsContent} from './python-settings.mjs';

let values={theme:'light',density:'standard',codeFontSize:14,chatFontSize:16,sendKey:'enter',reduceMotion:false,showScrollbars:false,uiFont:'default',language:'zh-CN'},loaded=false,diagnostics=null;
// Interface font: 'default' is the bundled 思源黑体; any installed family can be chosen.
let systemFonts=null,fontsLoading=null;
const BUNDLED_FONT='思源黑体（内置）';
const fontStack=name=>name&&name!=='default'?`"${name}", var(--ss-font-default)`:'var(--ss-font-default)';
function loadFonts(refresh=false){
  if(fontsLoading&&!refresh)return fontsLoading;
  fontsLoading=hostRequest('fonts'+(refresh?'?refresh=1':'')).then(result=>{systemFonts=result.fonts||[];paintFontChoices();}).catch(()=>{systemFonts=[];paintFontChoices();});
  return fontsLoading;
}
function fontOptions(selected){
  const names=[...(systemFonts||[])];
  if(selected!=='default'&&!names.includes(selected))names.unshift(selected); // saved but not (yet) listed
  return `<option value="default" ${selected==='default'?'selected':''}>${BUNDLED_FONT}</option>`+names.map(name=>`<option value="${esc(name)}" style="font-family:'${esc(name)}'" ${name===selected?'selected':''}>${esc(name)}</option>`).join('');
}
function fontControl(){
  if(!systemFonts)queueMicrotask(()=>void loadFonts());
  return `<div class="font-choice"><div class="font-choice-row"><select name="uiFont" aria-label="界面字体">${fontOptions(values.uiFont)}</select><button type="button" class="btn tiny" data-fonts-refresh title="重新读取本机字体">重新读取</button></div><span class="font-preview" data-font-preview style="font-family:${esc(fontStack(values.uiFont))}">研究 ScienceScope 0123 · 数据与方法</span><span class="font-status" data-font-status role="status">${systemFonts===null?'正在读取本机字体…':''}</span></div>`;
}
function paintFontChoices(){
  const select=document.querySelector('select[name="uiFont"]');if(!select)return;
  const current=select.value;select.innerHTML=fontOptions(current);select.value=current;
  const status=document.querySelector('[data-font-status]');if(status)status.textContent=systemFonts?.length?'':'没有读取到本机字体，可使用内置字体。';
}
const channel=new BroadcastChannel('sciencescope-desktop-preferences');
export const settingsEntries=[['general','个人资料与常规'],['models','模型与 API'],['persona','人格与记忆'],['experts','专家角色'],['behavior','执行策略'],['secretary-settings','任务秘书'],['assistant-settings','全局助手'],['library-settings','数据库与文件'],['environment','运行环境'],['shortcuts','快捷键'],['plugins','插件与技能'],['browser-settings','内置浏览器'],['usage','用量分析']];
export function settingsNavigation(){const groups=[['个人偏好',['general','shortcuts','usage']],['科研协作',['models','persona','experts','behavior','secretary-settings','assistant-settings']],['工具与环境',['library-settings','plugins','environment','browser-settings']]];return `<nav class="settingsnav"><button class="nav" data-route="home">${ic('back')}返回工作区</button>${groups.map(([name,ids])=>`<div class="navsection">${name}</div>${ids.map(id=>`<button class="nav ${route===id?'active':''}" data-route="${id}">${esc(settingsEntries.find(entry=>entry[0]===id)[1])}</button>`).join('')}`).join('')}</nav>`;}
// Explanations go behind an info tip; valueRow shows data (paths, versions) as text.
const row=(name,tip,control)=>`<div class="settingrow"><div class="description"><h3>${name}${tip?infoTip(tip,{label:`${name}说明`}):''}</h3></div><div class="control">${control}</div></div>`;
const valueRow=(name,value,control)=>`<div class="settingrow"><div class="description"><h3>${name}</h3><p>${value}</p></div><div class="control">${control}</div></div>`;
const select=(name,options)=>`<select name="${name}">${options.map(([value,label])=>`<option value="${value}" ${String(values[name])===String(value)?'selected':''}>${label}</option>`).join('')}</select>`;
function appearanceControls(){return `${row('界面语言','界面文字、菜单和提示的语言。对话内容、资料和你输入的名称保持原样。',select('language',LANGUAGES))}${row('界面字体','全局界面字体。默认使用随客户端安装的思源黑体；也可以选择这台电脑已安装的任何字体。字体不含中文时，中文会显示为替代字形。',fontControl())}${row('主题','浅色保留原设计；跟随系统会响应系统主题变化。',select('theme',[['light','浅色'],['dark','深色'],['system','跟随系统']]))}${row('界面密度','调整导航和设置间距，不缩放聊天正文。',select('density',[['standard','标准'],['compact','紧凑']]))}${row('代码字号','仅调整消息里的代码块，不改变正文。',select('codeFontSize',[12,13,14,15,16,18].map(size=>[size,`${size}px`])))}<button class="btn tiny" type="button" data-preferences-reset>恢复阅读与操作默认设置</button>`;}
function paths(){return diagnostics?Object.entries(diagnostics.paths).map(([id,item])=>valueRow(esc(item.label),`<code class="settings-path">${esc(item.path)}</code>`,`<button class="btn tiny" data-settings-open="${id}">打开文件夹</button>`)).join(''):'<p role="status">正在读取本机路径…</p>';}
export function settingsContent(target){
  if(target==='shortcuts')return shortcutsContent();
  if(target==='general'&&loaded)return `<form id="desktop-preferences-form"><h2>阅读与操作</h2>${appearanceControls()}${row('聊天正文字号','主对话、任务秘书及全局助手统一生效。',select('chatFontSize',[14,15,16,18,20].map(size=>[size,`${size}px`])))}${row('发送快捷键','Shift + Enter 始终换行；不改变导图编辑键位。',select('sendKey',[['enter','Enter 发送'],['ctrl-enter','Ctrl + Enter 发送']]))}${row('减少过渡动画','即时生效。',select('reduceMotion',[[false,'关闭'],[true,'开启']]))}${row('显示滚动条','聊天和设置滚动区域。',select('showScrollbars',[[false,'自动隐藏'],[true,'始终显示']]))}<p data-settings-feedback role="status"></p><div class="saverow"><button class="btn primary" type="submit">保存并应用</button></div></form>`;
  if(target==='plugins'||target==='plugin')return extensionsContent();
  if(target==='experts')return expertSettingsContent();
  if(['persona','secretary-settings','assistant-settings'].includes(target))return roleSettingsContent(target)+(target==='secretary-settings'?secretaryPreferencesContent():target==='assistant-settings'?assistantWindowSettingsContent():'');
  if(target==='general')return '<p>正在读取设置…</p>';
  if(target==='models')return modelsPage();
  if(target==='provider')return providerPage();
  if(target==='environment'||target==='library-settings')return `<h2>${target==='environment'?'运行环境':'数据库与文件'}${infoTip('以下是此客户端实际使用的位置。\nSQLite 保存应用记录，DSH 保存运行历史；原始材料保存在资料库。此处不提供清空历史或索引的一键操作。',{label:'位置说明'})}</h2>${paths()}${diagnostics?valueRow('运行时',`Node ${esc(diagnostics.node)} · ${esc(diagnostics.platform)} · ${esc(diagnostics.arch)}`,`<span>${diagnostics.runtimeAvailable?'DSH 已加载':'DSH 不可用'}</span>`):''}${target==='library-settings'?semanticSettingsContent():pythonSettingsContent()}`;
  if(target==='behavior')return `<h2>执行策略${infoTip('执行权限在每个对话的输入框中选择，不由角色名称或人格提示词授予。',{label:'执行策略说明'})}</h2>${row('询问','运行时对需要额外授权的操作请求确认；不意味着每个读取操作都弹窗。','默认策略')}${row('完全接管','工具按当前用户与运行时能力执行，不逐次询问。','输入框显式启用')}${row('自动化','主专家依据目标继续执行；助手与秘书不提供此选项。','仅主对话')}<button class="btn" data-settings-chat>返回当前对话</button>`;
  // Pages of optional features are unreachable until enabled (features.mjs).
  return settingsContent('general');
}
const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');
function apply(){const root=document.documentElement;root.dataset.theme=values.theme==='system'?(systemTheme.matches?'dark':'light'):values.theme;root.dataset.density=values.density;root.style.setProperty('--chat-font-size',values.chatFontSize+'px');root.style.setProperty('--code-font-size',values.codeFontSize+'px');root.toggleAttribute('data-reduce-motion',values.reduceMotion);root.toggleAttribute('data-show-scrollbars',values.showScrollbars);root.style.setProperty('--ss-font',fontStack(values.uiFont));setLanguage(values.language);try{localStorage.setItem('sciencescope-language',values.language);}catch{}}
systemTheme.addEventListener('change',()=>{if(values.theme==='system')apply();});
window.ScienceScopePreferences={get:()=>({...values})};
channel.onmessage=async()=>{try{values=await hostRequest('preferences');loaded=true;apply();}catch{}};
window.addEventListener('submit',async event=>{
  if(event.target.id!=='desktop-preferences-form')return;
  event.preventDefault();event.stopImmediatePropagation();const form=event.target,button=form.querySelector('button[type="submit"]'),data=new FormData(form);
  button.disabled=true;
  try{values=await hostRequest('preferences',{theme:data.get('theme'),density:data.get('density'),codeFontSize:Number(data.get('codeFontSize')),chatFontSize:Number(data.get('chatFontSize')),sendKey:data.get('sendKey'),reduceMotion:data.get('reduceMotion')==='true',showScrollbars:data.get('showScrollbars')==='true',uiFont:data.get('uiFont')||'default',language:data.get('language')||'zh-CN'});forget(form.id);apply();channel.postMessage('changed');form.querySelector('[data-settings-feedback]').textContent='已保存并应用；其它窗口同步生效。';}
  catch{form.querySelector('[data-settings-feedback]').textContent='未保存，请重试。';}finally{button.disabled=false;}
},true);
window.addEventListener('change',event=>{
  if(event.target.name!=='uiFont')return;
  const preview=document.querySelector('[data-font-preview]');if(preview)preview.style.fontFamily=fontStack(event.target.value);
});
window.addEventListener('click',event=>{
  if(!event.target.closest('[data-fonts-refresh]'))return;
  event.preventDefault();event.stopImmediatePropagation();
  const status=document.querySelector('[data-font-status]');if(status)status.textContent='正在读取本机字体…';
  void loadFonts(true);
},true);
window.addEventListener('click',async event=>{
  if(!event.target.closest('[data-preferences-reset]'))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!await window.ScienceScopeWorkspace.confirmAction('恢复阅读与操作默认设置','仅恢复界面字体、主题、密度、字号、发送方式和动画设置；保留个人资料、模型、对话与材料。','恢复默认'))return;
  try{values=await hostRequest('preferences/reset',{});forget('desktop-preferences-form');apply();channel.postMessage('changed');render();toast('已恢复阅读与操作默认设置。');}catch{toast('恢复失败，设置未更新。');}
},true);
window.addEventListener('click',async event=>{
  const button=event.target.closest('[data-settings-open],[data-settings-chat],[data-settings-role]');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  try{if(button.dataset.settingsOpen){await hostRequest('settings/open-folder',{id:button.dataset.settingsOpen});return;}
    if(button.dataset.settingsRole==='global'){await window.ScienceScopeWindows.open({surface:'assistant'});return;}
    if(!S.threads.some(t=>t.id===V.chat)){toast('请先打开或创建一个对话。');return;}
    go('work');if(button.dataset.settingsRole==='secretary')openPanel('secretary');
  }catch{toast('操作未完成，请检查客户端状态。');}
},true);
// Any module finishing a load calls render(), which rebuilds the settings page
// from saved values. Keep the user's unsaved choices across such re-renders
// (lost mid-edit on a slow first Windows run, 2026-09-26); saving or leaving
// the page drops them.
const unsaved=new Map();
function forget(formId){for(const key of [...unsaved.keys()])if(key.startsWith(formId+'\u0000'))unsaved.delete(key);}
function noteEdit(event){const el=event.target,form=el?.form;if(!form?.id||!el.name||!settingsEntries.some(([id])=>id===route))return;unsaved.set(form.id+'\u0000'+el.name,el.type==='checkbox'?el.checked:el.value);}
window.addEventListener('input',noteEdit,true);window.addEventListener('change',noteEdit,true);
if(typeof render==='function'){
  const baseRender=render;
  render=function(...args){
    const before=route,result=baseRender.apply(this,args);
    if(route!==before){unsaved.clear();return result;}
    for(const [key,value] of unsaved){
      const [formId,name]=key.split('\u0000'),el=document.getElementById(formId)?.elements?.[name];
      if(!el)continue;
      if(el.type==='checkbox')el.checked=value;else el.value=value;
      if(name==='uiFont'){const preview=document.querySelector('[data-font-preview]');if(preview)preview.style.fontFamily=fontStack(el.value);}
    }
    return result;
  };
}
window.ScienceScopePreferences.ready=Promise.all([hostRequest('preferences').then(result=>{values=result;loaded=true;apply();}),hostRequest('settings/info').then(result=>{diagnostics=result;})]).then(()=>{if(settingsEntries.some(([id])=>id===route))render();}).catch(()=>{loaded=false;});
