import {hostRequest} from './host-client.mjs';
import {infoTip} from './info-tip.mjs';
import {composerMenu} from './composer-menu.mjs';

let snapshot=null,error='',busy=false,selected=null,logs=[],feedback='',exportPath='',refreshing=false;
const drafts=new Map();
const names={ready:'就绪',partial:'已部分安装',creating:'正在创建',installing:'正在安装',error:'失败',failed:'失败',pending:'等待安装',missing:'不可用'};
const options=(value,inherit=false)=>`${inherit?'<option value="">跟随项目</option>':''}<option value="system" ${value==='system'?'selected':''}>系统 Python</option>${(snapshot?.envs||[]).map(env=>`<option value="${esc(env.id)}" ${value===env.id?'selected':''}>${esc(env.name)} · ${esc(env.version||'')}</option>`).join('')}`;
function body(){
  if(!snapshot)return `<p role="${error?'alert':'status'}">${esc(error||'正在读取 Python 环境…')}</p>`;
  const settings=snapshot.settings||{};
  const env=snapshot.envs.find(item=>item.id===selected);
  return `${error?`<p role="alert">${esc(error)}</p>`:''}<p role="status" data-python-feedback>${esc(busy?'正在处理环境操作…':feedback)}</p>
    <form data-python-settings><label>新任务默认环境<select name="defaultEnvId">${options(snapshot.defaultEnvId||'system')}</select></label>
    <label>软件包镜像源<input name="indexUrl" type="url" value="${esc(settings.indexUrl||'https://pypi.org/simple')}" required></label>
    <label><input type="checkbox" name="autoApproveFull" ${settings.autoApproveFull?'checked':''}>完全接管时自动批准安装${infoTip('默认关闭。开启后，完全接管模式下可不逐次确认便安装软件包；软件包可能执行代码。询问模式仍必须审批。',{label:'安装审批说明'})}</label>
    <button class="btn" ${busy?'disabled':''}>保存环境设置</button></form>
    <p role="status">${snapshot.system?.available?`<span>系统 Python</span> · ${esc(snapshot.system.version||'')} · <code>${esc(snapshot.system.path||snapshot.system.executable||'')}</code>`:'未检测到系统 Python'}</p>
    <form data-python-create><label>环境名称<input name="name" required maxlength="100"></label><label>Python 版本<input name="version" value="3.14" required></label>
    <label>复制已有环境<select name="templateId"><option value="">创建空环境</option>${snapshot.envs.map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></label><button class="btn" ${busy?'disabled':''}>新建环境</button></form>
    <div>${snapshot.envs.map(item=>`<div class="settingrow"><div class="grow"><strong>${esc(item.name)}</strong><p>${esc(item.version||'')} · ${esc(names[item.status]||item.status||'')} · <span data-python-count="${esc(item.id)}">${(item.lock||item.packages||[]).length}</span> <span>个软件包</span> · ${Number(item.usageCount||0)} <span>处绑定</span>${item.sizeBytes!=null?` · ${(item.sizeBytes/1048576).toFixed(1)} MiB`:''}</p>${item.error?`<p role="alert">${esc(item.error)}</p>`:''}</div><button class="btn tiny" data-python-action="inspect" data-env="${esc(item.id)}">管理</button><button class="btn tiny" data-python-action="remove" data-env="${esc(item.id)}" ${busy?'disabled':''}>删除</button></div>`).join('')}</div>
    ${env?`<section><h3 data-i18n-skip>${esc(env.name)}</h3><form data-python-rename><input name="name" aria-label="环境名称" value="${esc(env.name)}" required><button class="btn">重命名环境</button></form>
    <label>查找已安装的包<input type="search" data-python-search name="packageSearch"></label><div data-python-installed>${(env.lock||env.packages||[]).map(item=>`<div data-python-package data-i18n-skip>${esc(typeof item==='string'?item:JSON.stringify(item))}</div>`).join('')}</div>
    <label>软件包清单${infoTip('每行填写一个包名或版本约束。只安装到所选受管环境，不接受网址、本地路径或命令行参数。同步会使环境与此清单一致。',{label:'软件包清单说明'})}<textarea data-python-packages rows="7">${esc((env.packages||[]).map(item=>typeof item==='string'?item:`${item.name}${item.version?'=='+item.version:''}`).join('\n'))}</textarea></label>
    <div class="saverow"><button class="btn" data-python-action="add" ${busy?'disabled':''}>安装清单中的包</button><button class="btn" data-python-action="sync" ${busy?'disabled':''}>同步到清单</button><button class="btn" data-python-action="remove-packages" ${busy?'disabled':''}>移除清单中的包</button><button class="btn" data-python-action="export">导出清单</button></div>
    <button class="btn" data-python-action="import">导入清单</button><input type="file" data-python-import accept=".txt,.in,.lock" hidden>
    ${exportPath?`<p><span>清单已导出</span> · <code>${esc(exportPath)}</code></p>`:''}
    ${env.failedPackages?.length?`<p role="alert">${esc(env.failedPackages.map(item=>item.package).join(', '))}</p>`:''}
    <details data-python-logs><summary>安装记录</summary>${logs.map(log=>`<p>${esc(log.createdAt||log.created||'')} · ${esc(log.actor||'')} · ${esc(log.action||'')} · ${esc(log.status||'')}</p><pre>${esc(log.output||log.error||JSON.stringify(log.detail||{}))}</pre>`).join('')}</details></section>`:''}
    <p><span>共享缓存</span> · ${((snapshot.cacheSizeBytes||0)/1048576).toFixed(1)} MiB</p>
    <div class="saverow"><button class="btn" data-python-action="builtin" ${busy?'disabled':''}>安装或重试内置环境</button><button class="btn" data-python-action="prune" ${busy?'disabled':''}>清理共享缓存</button><button class="btn" data-python-action="refresh" ${busy?'disabled':''}>刷新环境列表</button></div>`;
}
export function pythonSettingsContent(){queueMicrotask(()=>void refresh());return `<section><h2>Python 环境${infoTip('使用 uv 管理独立环境和共享缓存。环境选择在下一轮开始前生效，运行中的轮次保持不变，DSH 历史保留。专家子代理继承主会话环境；秘书和全局助手使用各自选择。',{label:'Python 环境说明'})}</h2><div data-python-root>${body()}</div></section>`;}
function draftKey(input){return input.matches('[data-python-packages]')?`packages:${selected}`:`${input.closest('form')?.getAttributeNames().find(name=>name.startsWith('data-python-'))}:${input.name}:${input.closest('[data-python-rename]')?selected:''}`;}
function remember(input){if(input.type==='file')return;drafts.set(draftKey(input),input.type==='checkbox'?input.checked:input.value);}
function paint(){const root=document.querySelector('[data-python-root]');if(!root)return;const focused=root.contains(document.activeElement)?draftKey(document.activeElement):null;const start=document.activeElement?.selectionStart,end=document.activeElement?.selectionEnd,logsOpen=root.querySelector('[data-python-logs]')?.open;root.innerHTML=body();if(logsOpen&&root.querySelector('[data-python-logs]'))root.querySelector('[data-python-logs]').open=true;for(const input of root.querySelectorAll('input,select,textarea')){const key=draftKey(input);if(drafts.has(key)){if(input.type==='checkbox')input.checked=drafts.get(key);else input.value=drafts.get(key);}if(key===focused){input.focus({preventScroll:true});if(typeof start==='number'&&typeof input.setSelectionRange==='function')try{input.setSelectionRange(start,end);}catch{}}}}
document.addEventListener('input',event=>{if(event.target.closest('[data-python-root]'))remember(event.target);if(event.target.matches('[data-python-search]'))filterPackages(event.target.value);});
function filterPackages(value){const query=value.toLowerCase();document.querySelectorAll('[data-python-package]').forEach(row=>row.hidden=!row.textContent.toLowerCase().includes(query));}
document.addEventListener('change',async event=>{if(!event.target.closest('[data-python-root]'))return;const input=event.target;if(!input.matches('[data-python-import]')){remember(input);return;}const file=input.files?.[0];if(!file)return;if(file.size>262144){error='清单不能超过 256 KB。';paint();return;}const text=await file.text();drafts.set(`packages:${selected}`,text);paint();});
async function refresh(){if(refreshing)return;refreshing=true;try{snapshot=await hostRequest('python/envs');if(selected)logs=(await hostRequest('python/logs?envId='+encodeURIComponent(selected))).logs||[];paint();}catch(caught){error=caught.message;paint();}finally{refreshing=false;}}
setInterval(()=>{if(!document.hidden&&document.querySelector('[data-python-root]')&&(busy||snapshot?.envs.some(env=>['creating','installing'].includes(env.status))))void refresh();},3000);
async function perform(fn){if(busy)return;busy=true;error='';feedback='';paint();try{const result=await fn();if(result===false)return;await refresh();feedback='环境操作已完成';}catch(caught){error=caught.message;}finally{busy=false;paint();}}
document.addEventListener('submit',event=>{
  const form=event.target;if(!form.matches('[data-python-settings],[data-python-create],[data-python-rename]'))return;
  event.preventDefault();event.stopImmediatePropagation();const data=Object.fromEntries(new FormData(form));
  if(form.matches('[data-python-settings]'))void perform(()=>hostRequest('python/settings',{...data,autoApproveFull:form.elements.autoApproveFull.checked}));
  else if(form.matches('[data-python-rename]'))void perform(()=>hostRequest('python/envs',{action:'rename',envId:selected,name:data.name}));
  else void perform(()=>hostRequest('python/envs',{action:data.templateId?'copy':'create',...data,envId:data.templateId||undefined}));
},true);
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-python-action]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();
  const action=button.dataset.pythonAction,envId=button.dataset.env||selected;
  if(action==='import'){document.querySelector('[data-python-import]')?.click();return;}
  if(action==='inspect'){selected=envId;exportPath='';void refresh();return;}
  if(action==='refresh'){void refresh();return;}
  const packages=(document.querySelector('[data-python-packages]')?.value||'').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
  void perform(async()=>{
    if(['remove','prune','sync','remove-packages'].includes(action)&&!await window.ScienceScopeWorkspace.confirmAction('确认环境操作','此操作会更改受管 Python 环境或共享缓存，不会删除研究文件。','继续'))return false;
    if(action==='remove')await hostRequest('python/envs',{action:'remove',envId});
    else if(action==='prune')await hostRequest('python/cache/prune',{});
    else if(action==='builtin')await hostRequest('python/envs',{action:'builtin'});
    else if(action==='export'){const result=await hostRequest('python/export',{envId});exportPath=result.path||'';drafts.set(`packages:${envId}`,result.text);}
    else await hostRequest('python/envs/packages',{envId,action:action==='remove-packages'?'remove':action,packages});
  });
},true);

export async function showPythonChoice(trigger,{scope,targetId,onChoose}){
  const current=await hostRequest('python/envs');
  let resolved=null;
  if(targetId)try{resolved=await hostRequest('python/resolve?'+new URLSearchParams({[scope==='project'?'projectId':'chatId']:targetId}));}catch(caught){toast(caught.message);}
  const choices=[{id:null,name:scope==='project'?'跟随新任务默认':'跟随项目'},{id:'system',name:'系统 Python'},...current.envs.filter(env=>['ready','partial'].includes(env.status))];
  composerMenu(trigger,'Python 环境',choices.map(env=>({label:env.name,userLabel:!!env.id&&env.id!=='system',selected:resolved?env.id===(resolved.envId||'system'):false,action:'python-choice',attrs:`data-python-choice="${esc(env.id??'')}"`,description:'下一轮生效，保留会话历史。'})));
  document.querySelectorAll('[data-python-choice]').forEach(button=>{button.removeAttribute('data-v');button.addEventListener('click',async event=>{
    event.preventDefault();event.stopImmediatePropagation();
    try{const envId=button.dataset.pythonChoice||null;if(onChoose)await onChoose(envId);else await hostRequest('python/bind',{scope,targetId,envId});closeMenu();toast('Python 环境将在下一轮生效。');}catch(caught){toast(caught.message);}
  },true);});
}
if(typeof menu==='function'){
  const baseMenu=menu;
  menu=function(items,trigger,...rest){
    if(trigger?.dataset?.v==='workspace-menu'&&S.threads.some(chat=>chat.id===V.chat))items=[...items,{text:'Python 环境',act:'python-chat-env',attrs:`data-python-chat="${esc(V.chat)}"`}];
    return baseMenu(items,trigger,...rest);
  };
}
if(typeof objectMenu==='function'){
  const baseObjectMenu=objectMenu;
  objectMenu=function(kind,id,trigger,...rest){baseObjectMenu(kind,id,trigger,...rest);if(kind!=='project')return;const button=document.createElement('button');button.className='menu-line';button.dataset.pythonProject=id;button.textContent='Python 环境';document.getElementById('v-menu')?.append(button);};
}
window.addEventListener('click',event=>{const button=event.target.closest('[data-python-chat],[data-python-project]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();void showPythonChoice(button,{scope:button.dataset.pythonProject?'project':'chat',targetId:button.dataset.pythonProject||button.dataset.pythonChat}).catch(caught=>toast(caught.message));},true);
