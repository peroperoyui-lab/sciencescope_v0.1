import './workspace.mjs';
import {hostRequest,streamChat} from './host-client.mjs';
import {renderMarkdown} from './markdown.mjs';
import {composerMenu} from './composer-menu.mjs';
import {recordTool,activityHTML} from './turn-activity.mjs';
import {infoTip} from './info-tip.mjs';

const entries=new Map();
const navigation=new BroadcastChannel('sciencescope-navigation');
navigation.onmessage=async({data})=>{
  if(V.surface||!data||data.type!=='navigate')return;
  await window.ScienceScopeWorkspace.ready;
  if(data.projectId){if(S.projects.some(p=>p.id===data.projectId&&!p.archived))window.SSV2.selectProject(data.projectId);}
  else if(['workbench','database','project-new'].includes(data.route))go(data.route);
};
const label=scope=>scope==='global'?'全局助手':'任务秘书';
function entry(scope,ownerId=scope==='global'?'global':V.chat){
  const key=JSON.stringify([scope,ownerId]);
  if(!entries.has(key))entries.set(key,{key,scope,ownerId,messages:[],draft:'',loaded:false,loading:false,sending:false,running:false,model:null,contextChatId:'',before:null,error:'',draftWrites:Promise.resolve()});
  const value=entries.get(key);value.attachments??=[];value.executionMode??='ask';value.approvals??=[];return value;
}
function visible(e){return [...document.querySelectorAll('.assistant-surface')].find(el=>el.dataset.scope===e.scope&&el.dataset.owner===e.ownerId);}
function bubble(m,scope){
  return `<article class="assistant-message ${m.role==='user'?'user':''}" data-assistant-message="${esc(m.id)}"><small>${esc(m.role==='user'?(window.ScienceScopeProfile?.name()||'用户'):m.role==='system'?'状态':label(scope))}</small><div class="turn-activity-host">${activityHTML(m)}</div><div class="message-text rendered-markdown">${renderMarkdown(m.text)}</div></article>`;
}
function surfaceHTML(scope){
  const e=entry(scope);queueMicrotask(()=>void load(e));
  return `<section class="assistant-surface" data-scope="${scope}" data-owner="${esc(e.ownerId)}">
    <div class="assistant-messages" aria-label="${label(scope)}对话记录" tabindex="0"></div>
    <div class="assistant-feedback" role="status"></div>
<div class="assistant-controls"><button class="btn tiny" data-assistant-action="history">较早记录</button><button class="btn tiny" data-assistant-action="latest">最新</button><span class="grow"></span>${scope==='global'?'<button class="btn tiny" data-assistant-action="context">以此对话为准</button>':''}</div>
    ${scope==='secretary'?`<div class="assistant-follow-up"><span data-follow-up></span>${infoTip('发送前自动跟进主对话的新消息与工作站状态；回复失败或被停止时不推进位置。仍可选中文字添加标记。')}</div>`:''}
    <div class="assistant-approvals"></div>
    <div class="assistant-proposals"></div>
    <div class="composer assistant-composer"><div class="assistant-attachments"></div><textarea data-assistant-input aria-label="${label(scope)}输入" placeholder="${scope==='global'?'哪些项目还有待办？也可以指定项目查阅。':'先问清楚，再决定下一步…'}"></textarea>
    <div class="composerbar"><button data-assistant-action="upload" class="iconbtn" title="添加文件">${ic('plus')}</button><button data-assistant-action="policy" class="btn tiny">询问</button><span class="spacer"></span><button data-assistant-action="model" class="btn assistant-model">选择模型</button><button data-assistant-action="effort" class="btn tiny">模型默认</button><button data-assistant-action="send" class="sendbtn" aria-label="发送给${label(scope)}">${ic('arrow')}</button><button data-assistant-action="stop" class="sendbtn" aria-label="停止回复" hidden>■</button></div></div>
  </section>`;
}
function paint(e,{messages=true,bottom=false}={}){
  const surface=visible(e);if(!surface)return;
  const box=surface.querySelector('.assistant-messages'),nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;
  if(messages){box.innerHTML=e.messages.map(m=>bubble(m,e.scope)).join('')||`<div class="hint">${e.loading?'正在读取…':''}</div>`;if(bottom||nearBottom)box.scrollTop=box.scrollHeight;}
  const input=surface.querySelector('[data-assistant-input]');if(input.value!==e.draft)input.value=e.draft;
  surface.querySelector('.assistant-feedback').textContent=e.error||((e.running||e.sending)?'正在回复…':e.loaded?'已保存到本机':'');
  surface.querySelector('[data-assistant-action="model"]').textContent=e.model?.modelId||'选择模型';
  const policy=surface.querySelector('[data-assistant-action="policy"]');policy.textContent=e.executionMode==='full'?'完全接管':'询问';policy.classList.toggle('policy-caution',e.executionMode==='full');
  surface.querySelector('[data-assistant-action="effort"]').textContent=e.reasoningEffort||'模型默认';
  surface.querySelector('.assistant-attachments').innerHTML=e.attachments.map(file=>`<span class="ref-chip">${esc(file.title)}<button data-assistant-action="remove-attachment" data-id="${esc(file.id)}" aria-label="移除附件">×</button></span>`).join('');
  const approvalHTML=e.approvals.map(a=>`<div class="assistant-approval"><strong>需要确认：${esc(a.toolName||'工具')}</strong><p>${esc(a.reason||'运行时请求操作授权。')}</p><button data-assistant-action="approve" data-request="${esc(a.requestId)}" class="btn tiny">允许这次</button> <button data-assistant-action="reject" data-request="${esc(a.requestId)}" class="btn tiny">拒绝</button></div>`).join('');
  const approvalBox=surface.querySelector('.assistant-approvals');if(approvalBox._html!==approvalHTML){approvalBox.innerHTML=approvalHTML;approvalBox._html=approvalHTML;}
  const proposals=(e.proposals||[]).filter(p=>p.status==='pending');
  const proposalBox=surface.querySelector('.assistant-proposals'),proposalKey=proposals.map(p=>p.id).join(',');
  if(proposalBox.dataset.ids!==proposalKey){proposalBox.dataset.ids=proposalKey;proposalBox.innerHTML=proposals.map(p=>`<details open class="assistant-proposal" data-proposal="${esc(p.id)}"><summary>秘书提案 · 请审阅</summary><textarea aria-label="编辑秘书提案">${esc(p.text)}</textarea><button class="btn tiny" data-assistant-action="apply-proposal" data-id="${esc(p.id)}">确认填入主对话草稿</button> <button class="btn tiny" data-assistant-action="dismiss-proposal" data-id="${esc(p.id)}">忽略</button></details>`).join('');}
  surface.querySelector('[data-assistant-action="send"]').hidden=e.running||e.sending;
  surface.querySelector('[data-assistant-action="stop"]').hidden=!(e.running||e.sending);
  const focusButton=surface.querySelector('[data-assistant-action="context"]');if(focusButton)focusButton.textContent=e.contextChatId?'已指定对话 · 点击取消':'以此对话为准';
  const followUp=surface.querySelector('[data-follow-up]');if(followUp)followUp.textContent=`已跟进到主对话第 ${e.followUp?.seenOrdinal??0} 条 · 纪要第 ${e.followUp?.minutesRevision??0} 版`;
  surface.querySelector('[data-assistant-action="history"]').disabled=!e.before||e.running||e.sending;
}
async function load(e,force=false){
  if(e.loading)return;
  if(e.loaded&&!force){paint(e);return;}
  e.loading=true;paint(e,{messages:false});
  try{
    const snapshot=await hostRequest('assistant?'+new URLSearchParams({scope:e.scope,ownerId:e.ownerId}));
    e.messages=snapshot.messages;e.before=snapshot.before;e.running=snapshot.running;e.chat=snapshot.chat;
    e.followUp=snapshot.followUp;
    if(!e.loaded&&!e.edited)e.draft=snapshot.draft||'';
    e.model=snapshot.chat?.model||e.model||snapshot.roleDefaults?.model||window.ScienceScopeModels?.selected()||null;
    if(!e.loaded){e.attachments=snapshot.attachments||[];e.executionMode=snapshot.settings?.executionMode||'ask';e.reasoningEffort=snapshot.settings?.reasoningEffort||(!snapshot.chat?snapshot.roleDefaults?.reasoningEffort:undefined)||undefined;}
    e.approvals=snapshot.approvals||[];
    e.proposals=snapshot.proposals||[];
    e.loaded=true;e.error='';
  }catch(error){e.error=error.message;}finally{e.loading=false;paint(e,{bottom:!e.loaded});}
}
function saveDraft(e){
  const text=e.draft;
  const attachmentIds=e.attachments.map(file=>file.id);
  e.draftWrites=e.draftWrites.catch(()=>{}).then(()=>hostRequest('assistant/draft',{scope:e.scope,ownerId:e.ownerId,text,attachmentIds}));
  e.draftWrites.catch(()=>{e.error='草稿未保存，请暂时保留窗口。';paint(e,{messages:false});});
  return e.draftWrites;
}
async function send(e){
  if(e.sending||e.running||!e.draft.trim())return;
  if(!e.model){e.error='请先选择模型。';paint(e,{messages:false});return;}
  const text=e.draft,userId='msg-'+crypto.randomUUID(),attachmentIds=e.attachments.map(file=>file.id);let answer,accepted=false;
  e.sending=true;e.error='';paint(e,{messages:false});
  let timer;
  const incremental=()=>{
    timer=null;const surface=visible(e);if(!surface||!answer)return;
    const box=surface.querySelector('.assistant-messages'),follow=box.scrollHeight-box.scrollTop-box.clientHeight<80;
    const body=[...box.querySelectorAll('[data-assistant-message]')].find(el=>el.dataset.assistantMessage===answer.id)?.querySelector('.message-text');
    if(body)body.innerHTML=renderMarkdown(answer.text);
    if(follow)box.scrollTop=box.scrollHeight;
  };
  try{
    await saveDraft(e);
    const researchInput=await window.ScienceScopeResearchInput?.capture(e.scope,e.ownerId);
    await streamChat({scope:e.scope,ownerId:e.ownerId,model:e.model,text,userMessageId:userId,researchInput,contextChatId:e.contextChatId||undefined,executionMode:e.executionMode,reasoningEffort:e.reasoningEffort,attachmentIds},event=>{
      if(event.type==='accepted'){
        accepted=true;e.running=true;
        answer={id:event.assistantMessageId,role:'assistant',text:''};
        e.messages=[...e.messages,{id:userId,role:'user',text},answer].slice(-60);
        if(e.draft===text)e.draft='';e.attachments=e.attachments.filter(file=>!attachmentIds.includes(file.id));paint(e,{bottom:true});
      }
      if(event.type==='text-delta'&&answer){answer.text+=event.delta;timer??=setTimeout(incremental,50);}
      if(['text-replace','text-reset'].includes(event.type)&&answer){answer.text=event.text||'';timer??=setTimeout(incremental,50);}
      if(event.type==='completed'&&answer&&typeof event.text==='string')answer.text=event.text;
      if(event.type==='main-draft-proposal'){e.proposals??=[];e.proposals.push({id:event.proposalId,text:event.text,status:'pending'});paint(e,{messages:false});}
      if(['tool-call','tool-result'].includes(event.type)&&answer){recordTool(answer,event);const node=[...visible(e)?.querySelectorAll('[data-assistant-message]')||[]].find(node=>node.dataset.assistantMessage===answer.id)?.querySelector('.turn-activity-host');if(node)node.innerHTML=activityHTML(answer);}
    },'/api/assistant/chat');
  }catch(error){e.error=error.message;if(!accepted)e.draft=text;for(const id of attachmentIds)if(!e.attachments.some(file=>file.id===id))e.attachments.push({id,title:id});}
  finally{
    clearTimeout(timer);e.sending=false;e.running=false;
    const error=e.error;if(accepted)await load(e,true);if(error)e.error=error;
    paint(e);
  }
}

const basePanel=rightPanel;
rightPanel=function(type){
  if(!['secretary','compose'].includes(type))return basePanel(type);
  return `<aside class="rightpanel assistant-rightpanel"><div class="panel-resizer" data-v-resize></div><div class="panelhead between"><strong>任务秘书</strong>${vib('close','close-panel','关闭秘书')}</div>${surfaceHTML('secretary')}</aside>`;
};
const baseDetached=detachedContent;
detachedContent=function(){
  if(V.surface!=='assistant')return baseDetached();
  document.documentElement.classList.add('assistant-panel');
  const links=`<div class="assistant-home-links"><small>最近项目</small>${S.projects.filter(p=>!p.archived).slice(0,5).map(p=>`<button class="assistant-entry" data-assistant-nav="project" data-project="${esc(p.id)}">${ic('folder')}<span class="grow">${esc(p.name)}</span>${ic('right')}</button>`).join('')}<div class="detached-nav"><button class="btn tiny" data-assistant-nav="workbench">工作站</button><button class="btn tiny" data-assistant-nav="database">数据库</button><button class="btn tiny" data-assistant-nav="project-new">新建项目</button></div></div>`;
  document.body.innerHTML=`<div class="detached-shell">${links}${surfaceHTML('global')}</div>`;
};
window.addEventListener('click',event=>{
  const button=event.target.closest('[data-assistant-nav]');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  navigation.postMessage({type:'navigate',route:button.dataset.assistantNav,projectId:button.dataset.project});
  toast('已请求主窗口打开。');
},true);
window.addEventListener('input',event=>{
  if(!event.target.matches('[data-assistant-input]'))return;
  const root=event.target.closest('.assistant-surface'),e=entry(root.dataset.scope,root.dataset.owner);
  e.draft=event.target.value;e.edited=true;clearTimeout(e.saveTimer);e.saveTimer=setTimeout(()=>void saveDraft(e),250);
},true);
window.addEventListener('keydown',event=>{
  if(!event.target.matches('[data-assistant-input]')||event.isComposing||event.keyCode===229)return;
  if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.stopImmediatePropagation();const root=event.target.closest('.assistant-surface');void send(entry(root.dataset.scope,root.dataset.owner));}
},true);
window.addEventListener('click',async event=>{
  const button=event.target.closest('[data-assistant-action]');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  const root=button.closest('.assistant-surface');
  const e=root?entry(root.dataset.scope,root.dataset.owner):entries.get(button.dataset.entry);
  if(!e)return;
  const action=button.dataset.assistantAction;
  try{
    if(action==='send')return await send(e);
    if(action==='apply-proposal'||action==='dismiss-proposal'){
      if(action==='apply-proposal'){
        if(V.chat!==e.ownerId)return toast('请先打开此秘书对应的主对话。');
        const text=button.closest('[data-proposal]').querySelector('textarea').value;
        if(!text.trim())return;
        if(S.drafts.main&&!await window.ScienceScopeWorkspace.confirmAction('替换主对话草稿','现有草稿会被这份提案替换，不会自动发送。','替换'))return;
        S.drafts.main=text;saveThread();const field=document.querySelector('[data-draft="main"]');if(field){field.value=text;field.focus();}
      }
      await hostRequest('assistant/proposal/resolve',{scope:e.scope,ownerId:e.ownerId,id:button.dataset.id});
      e.proposals=e.proposals.filter(p=>p.id!==button.dataset.id);paint(e,{messages:false});return;
    }
    if(action==='stop'){await hostRequest('assistant/stop',{scope:e.scope,ownerId:e.ownerId});return;}
    if(action==='model'){
      if(e.running||e.sending)return toast('请先停止或等待本轮回复完成。');
      const {providers}=await hostRequest('providers');
      if(!providers.some(p=>p.models.length))return toast('请先在主窗口的模型与 API 设置中添加服务。');
      composerMenu(button,'助手模型',providers.flatMap(p=>p.models.map(id=>({label:p.name+' / '+id,action:'assistant-choice',attrs:`data-assistant-action="choose-model" data-entry="${esc(e.key)}" data-provider="${esc(p.id)}" data-model="${esc(id)}"`}))));return;
    }
    if(action==='choose-model'){const model={providerId:button.dataset.provider,modelId:button.dataset.model};await hostRequest('assistant/model',{scope:e.scope,ownerId:e.ownerId,model});e.model=model;e.reasoningEffort=undefined;closeMenu();paint(e,{messages:false});return;}
    if(action==='policy'){
      if(e.running||e.sending)return toast('请先等待本轮结束。');
      composerMenu(button,'执行策略',[['ask','询问','需要额外授权的操作由运行时请求确认。'],['full','完全接管','允许工具按当前用户权限执行文件与命令操作，不逐次询问。']].map(([id,name,description])=>({label:name,description,caution:id==='full',action:'assistant-choice',attrs:`data-assistant-action="choose-policy" data-entry="${esc(e.key)}" data-mode="${id}"`})));return;
    }
    if(action==='choose-policy'){if(button.dataset.mode==='full'&&!await window.ScienceScopeWorkspace.confirmAction('完全接管','允许助手执行工具和文件操作，不逐次询问。','启用'))return;e.executionMode=button.dataset.mode;closeMenu();paint(e,{messages:false});return;}
    if(action==='effort'){
      if(e.running||e.sending||!e.model)return;
      const info=await hostRequest('model-info?'+new URLSearchParams(e.model));
      composerMenu(button,'思考强度',[{id:'',name:'模型默认'},...(info.reasoning?.efforts||[])].map(option=>({label:option.name,action:'assistant-choice',attrs:`data-assistant-action="choose-effort" data-entry="${esc(e.key)}" data-effort="${esc(option.id)}"`})));return;
    }
    if(action==='choose-effort'){const effort=button.dataset.effort||undefined;await hostRequest('assistant/model',{scope:e.scope,ownerId:e.ownerId,model:e.model,reasoningEffort:effort});e.reasoningEffort=effort;closeMenu();paint(e,{messages:false});return;}
    if(action==='approve'||action==='reject'){await hostRequest('assistant/approval',{scope:e.scope,ownerId:e.ownerId,requestId:button.dataset.request,allowed:action==='approve'});e.approvals=e.approvals.filter(a=>a.requestId!==button.dataset.request);paint(e,{messages:false});return;}
    if(action==='remove-attachment'){e.attachments=e.attachments.filter(file=>file.id!==button.dataset.id);await saveDraft(e);paint(e,{messages:false});return;}
    if(action==='upload'){
      const picker=document.createElement('input');picker.type='file';picker.multiple=true;
      picker.onchange=async()=>{try{for(const file of picker.files){if(e.attachments.length>=8)throw new Error('每次最多添加 8 个文件。');if(file.size>20*1024*1024)throw new Error('单个文件不能超过 20 MiB。');const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const resource=await hostRequest('library/import',{name:file.name,base64});e.attachments.push({id:resource.id,title:resource.title});await saveDraft(e);paint(e,{messages:false});}}catch(error){e.error=error.message;paint(e,{messages:false});}};picker.click();return;
    }
    if(action==='context'){
      if(e.scope!=='global')return;
      if(e.contextChatId){e.contextChatId='';paint(e,{messages:false});return;}
      const {chats}=await hostRequest('chats');
      composerMenu(button,'以此对话为准',chats.filter(chat=>!chat.deletedAt).map(chat=>({label:chat.title,action:'assistant-choice',attrs:`data-assistant-action="choose-context" data-entry="${esc(e.key)}" data-chat="${esc(chat.id)}"`})));
      return;
    }
    if(action==='choose-context'){e.contextChatId=button.dataset.chat;closeMenu();paint(e,{messages:false});return;}
    if(action==='history'){
      const page=await hostRequest('assistant?'+new URLSearchParams({scope:e.scope,ownerId:e.ownerId,before:e.before,limit:'30'}));
      e.messages=[...page.messages,...e.messages].slice(0,60);e.before=page.before;paint(e);return;
    }
    if(action==='latest'){await load(e,true);const box=visible(e)?.querySelector('.assistant-messages');if(box)box.scrollTop=box.scrollHeight;return;}
  }catch(error){e.error=error.message;paint(e,{messages:false});}
},true);
const after=window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender=(...args)=>{after?.(...args);for(const root of document.querySelectorAll('.assistant-surface'))void load(entry(root.dataset.scope,root.dataset.owner));};
setInterval(()=>{if(document.hidden)return;for(const e of entries.values())if(visible(e)&&e.running&&!e.sending)void load(e,true);},1500);
setInterval(()=>{if(document.hidden)return;for(const e of entries.values())if(visible(e)&&e.sending&&!e.polling){e.polling=true;hostRequest('assistant?'+new URLSearchParams({scope:e.scope,ownerId:e.ownerId})).then(snapshot=>{e.approvals=snapshot.approvals||[];paint(e,{messages:false});}).catch(()=>{}).finally(()=>{e.polling=false;});}},1200);
window.addEventListener('pagehide',()=>{for(const e of entries.values())if(e.loaded)void hostRequest('assistant/draft',{scope:e.scope,ownerId:e.ownerId,text:e.draft},{keepalive:true}).catch(()=>{});});
window.ScienceScopeAssistants={ready:()=>Promise.all([...entries.values()].map(e=>load(e))),entry};
render();
