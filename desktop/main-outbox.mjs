import {hostRequest} from './host-client.mjs';

const views=new Map();
const draining=new Set();
const enqueuing=new Set();
let polling=false;
const isMain=()=>!['assistant','assistant-orb'].includes(V.surface);

function paint(chatId=V.chat) {
  if(chatId!==V.chat||!isMain())return;
  const composer=document.querySelector('[data-composer="main"]');
  if(!composer)return;
  const state=views.get(chatId);
  let list=composer.querySelector('.main-outbox');
  if(!state?.items?.length)list?.remove();
  else {
    if(!list){list=document.createElement('div');list.className='main-outbox';composer.prepend(list);}
    const html=`<div class="row"><small>待发送 ${state.items.length}${state.paused?' · 已暂停':''}</small><span class="spacer"></span>${state.paused?'<button class="btn tiny" data-outbox="resume">继续队列</button>':'<button class="btn tiny" data-outbox="pause">暂停队列</button>'}</div>${state.items.map(item=>`<div class="outbox-item"><span>${esc(item.input.text.slice(0,100))}</span><small>${item.status==='sending'?'发送中':item.status==='interrupted'?'状态待确认':'待发送'}</small>${item.status==='sending'?'':`<button data-outbox="restore" data-id="${esc(item.id)}" title="取回编辑">编辑</button><button data-outbox="cancel" data-id="${esc(item.id)}" title="移除待发消息">×</button>`}</div>`).join('')}`;
    if(list._content!==html){list.innerHTML=html;list._content=html;}
  }
  let add=composer.querySelector('[data-outbox="enqueue"]');
  if(V.pending.has(chatId)){
    if(!add){add=document.createElement('button');add.className='btn tiny';add.dataset.outbox='enqueue';add.textContent='加入队列';composer.querySelector('.sendbtn')?.before(add);}
  }else add?.remove();
}
async function refresh(chatId=V.chat) {
  if(!chatId)return;
  const state=await hostRequest('chat/outbox?chatId='+encodeURIComponent(chatId));
  views.set(chatId,state);if(views.size>20)views.delete(views.keys().next().value);
  paint(chatId);return state;
}
async function enqueue() {
  const chatId=V.chat,text=S.drafts.main || '';
  if(enqueuing.has(chatId))return;
  if(!text.trim())return;
  if(S.annotations?.length||getThreadData(chatId).contextRefs?.length)return toast('本轮队列先支持文本；请保留材料与批注，待材料发送接通。');
  if(activeThread()?.temporary)return toast('临时窗口暂不保存待发送队列。');
  const executionMode=window.ScienceScopeExecution?.mode() || 'ask';
  if(executionMode==='auto')return toast('请先暂停或结束自动化，再使用普通消息队列。');
  const model=window.ScienceScopeModels?.selected();
  enqueuing.add(chatId);
  try {
  await hostRequest('chat/outbox',{action:'enqueue',chatId,input:{chatId,projectId:activeThread()?.projectId||null,text,model,executionMode,reasoningEffort:window.ScienceScopeReasoning?.value(),userMessageId:uid('msg'),assistantMessageId:uid('msg')}});
  if(V.chat===chatId&&S.drafts.main===text){S.drafts.main='';const input=document.querySelector('[data-draft="main"]');if(input)input.value='';saveThread();}
  await refresh(chatId);
  }finally{enqueuing.delete(chatId);}
}
async function drain(chatId) {
  if(draining.has(chatId)||V.pending.has(chatId))return;
  draining.add(chatId);
  try{
    const state=await refresh(chatId);
    const item=state.items[0];
    if(state.paused||!item||item.status!=='queued')return;
    const success=await window.SS.submitMain(item.input.text,[],{targetChat:chatId,snapshot:item.input,outboxId:item.id});
    if(!success)await hostRequest('chat/outbox',{action:'pause',chatId});
    await refresh(chatId);
    if(success)queueMicrotask(()=>void drain(chatId));
  }catch(error){toast(error.message);}
  finally{draining.delete(chatId);}
}
window.addEventListener('click',async event=>{
  const button=event.target.closest('[data-outbox]');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  const chatId=V.chat,action=button.dataset.outbox;
  try{
    if(action==='enqueue')return await enqueue();
    if(action==='restore'){
      const item=views.get(chatId)?.items.find(item=>item.id===button.dataset.id);if(!item)return;
      if(S.drafts.main?.trim()&&!await window.ScienceScopeWorkspace.confirmAction('取回待发消息','替换当前未发送草稿？','替换'))return;
      await hostRequest('chat/outbox',{action:'cancel',chatId,id:item.id});
      S.drafts.main=item.input.text;
      const input=document.querySelector('[data-draft="main"]');if(input){input.value=S.drafts.main;input.focus();}saveThread();
    }else{
      if(action==='resume'&&views.get(chatId)?.items.some(item=>item.input.executionMode==='full')&&!await window.ScienceScopeWorkspace.confirmAction('继续完全接管队列','队列包含完全接管任务；继续后将按保存的策略执行。','继续'))return;
      await hostRequest('chat/outbox',{action,chatId,id:button.dataset.id});
    }
    await refresh(chatId);if(action==='resume')void drain(chatId);
  }catch(error){toast(error.message);}
},true);
window.addEventListener('keydown',event=>{
  if(event.isComposing||event.key!=='Enter'||event.shiftKey||!event.target.matches('[data-draft="main"]')||!V.pending.has(V.chat))return;
  event.preventDefault();event.stopImmediatePropagation();void enqueue().catch(error=>toast(error.message));
},true);
setInterval(async()=>{
  if(polling||document.hidden||!isMain()||!document.querySelector('[data-composer="main"]'))return;
  polling=true;try{await refresh();}catch{}finally{polling=false;}
},1500);
window.ScienceScopeOutbox={paint,settled:chatId=>drain(chatId)};
