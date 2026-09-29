import './workspace.mjs';
import {hostRequest} from './host-client.mjs';
import {renderMarkdown} from './markdown.mjs';
import {composerMenu} from './composer-menu.mjs';
import './context-meter.mjs';
const labels={ask:'询问',full:'完全接管',auto:'自动化'};
const modes=new Map();let currentId='',state={mode:'ask',goal:null,approvals:[]},fetching=false;
const mode=()=>modes.get(V.chat)||state.mode||'ask';
function paint(){
  window.ScienceScopeContext?.update(V.chat,state.contextUsage,state.expertContexts);
  S.settings.mode=labels[mode()];
  for(const el of document.querySelectorAll('[data-v="mode-menu"]'))el.textContent='◉ '+S.settings.mode;
  const column=document.querySelector('.chatcol');if(!column)return;
  let panel=column.querySelector('#execution-state');
  const goal=state.goal,approvals=state.approvals||[];
  if(!goal&&!approvals.length&&!state.error){panel?.remove();document.querySelector('#execution-preview')?.remove();return;}
  if(!panel){panel=document.createElement('div');panel.id='execution-state';panel.className='execution-state';column.prepend(panel);}
  const phases={active:goal?.activation==='armed'?'执行中':'等待继续',paused:'已暂停',blocked:'需要处理',complete:'已完成'};
  panel.innerHTML=`${goal?`<div class="row"><strong>自动化 · ${phases[goal.phase]||goal.phase}</strong><span class="grow">${goal.roundsStarted} / ${goal.maxGoalRounds} 轮</span>${goal.phase==='active'&&goal.activation==='armed'?'<button class="btn tiny" data-execution="pause">暂停</button>':goal.phase!=='complete'?'<button class="btn tiny" data-execution="resume">继续</button>':''}</div>${goal.blockedReason?`<p class="hint">${esc(goal.blockedReason.message)}</p>`:''}`:''}${approvals.map(a=>`<div class="execution-approval"><strong>需要确认：${esc(a.toolName||'工具操作')}</strong><p>${esc(a.reason||'运行时请求一次操作授权。')}</p><button class="btn tiny" data-execution="approve" data-request="${esc(a.requestId)}">仅允许这次</button> <button class="btn tiny" data-execution="reject" data-request="${esc(a.requestId)}">拒绝</button></div>`).join('')}${state.error?`<p role="alert">${esc(state.error)}</p>`:''}`;
  panel.querySelectorAll('.execution-approval strong').forEach((label,index)=>{const expert=approvals[index]?.expertLabel;if(expert)label.append(document.createTextNode(` · ${expert}`));});
  panel.querySelectorAll('.execution-approval').forEach((card,index)=>{const approval=approvals[index];if(!approval?.targetEnvironment)return;const target=document.createElement('p');const title=document.createElement('span');title.textContent='目标环境';target.append(title,document.createTextNode(' · '+approval.targetEnvironment));const packages=document.createElement('pre');packages.textContent=(approval.packages||[]).join('\n');card.insertBefore(target,card.querySelector('button'));card.insertBefore(packages,card.querySelector('button'));});
  if(goal)panel.querySelector('.row')?.insertAdjacentHTML('beforeend','<button class="btn tiny" data-execution="stop">结束目标</button>');
  let preview=document.querySelector('#execution-preview');
  if(state.preview){if(!preview){preview=document.createElement('div');preview.id='execution-preview';preview.className='execution-preview rendered-markdown';document.querySelector('.messages')?.append(preview);}preview.innerHTML='<small>自动化正在输出…</small>'+renderMarkdown(state.preview);}
  else preview?.remove();
}
async function poll(){
  if(fetching||!V.chat||['assistant','assistant-orb'].includes(V.surface))return;
  const id=V.chat;fetching=true;
  try{const value=await hostRequest('execution?chatId='+encodeURIComponent(id));if(V.chat!==id)return;state=value;currentId=id;paint();if(value.goal)await window.ScienceScopeWorkspace.refreshLive(id);}
  catch{}finally{fetching=false;}
}
function openMenu(trigger){
  if(V.pending.has(V.chat)||(state.goal?.phase==='active'&&state.goal.activation==='armed'))return toast('请先等待本轮完成，或暂停自动化，再切换策略。');
  composerMenu(trigger,'执行策略',[
    {id:'ask',description:'在项目范围内工作；运行时判定需要额外授权的操作会询问你。'},
    {id:'full',description:'取消逐次审批，允许当前进程权限内的文件和命令操作；不提升 Windows 权限。'},
    {id:'auto',description:'围绕目标持续迭代，保留风险询问。可暂停或结束；完成、阻塞或达到 256 轮上限即停止。关闭客户端不继续后台执行。'},
  ].map(item=>({...item,label:labels[item.id],selected:mode()===item.id,caution:item.id!=='ask',action:'execution-mode',attrs:`data-execution="mode" data-mode="${item.id}"`})));
}
window.addEventListener('click',async event=>{
  const el=event.target.closest('[data-execution]');if(!el)return;event.preventDefault();event.stopImmediatePropagation();
  const action=el.dataset.execution;
  try{
    if(action==='mode'){
      const next=el.dataset.mode;
      if(next==='full'&&!await window.ScienceScopeWorkspace.confirmAction('完全接管','此模式关闭逐次审批，工具可能读写项目外文件并运行命令。只在信任当前任务时开启；不更改 Windows 系统权限。','启用完全接管'))return;
      modes.set(V.chat,next);closeMenu();paint();toast('下次发送采用“'+labels[next]+'”。');
    }else if(action==='approve'||action==='reject')await hostRequest('execution/approval',{chatId:V.chat,requestId:el.dataset.request,allowed:action==='approve'});
    else {if(action==='stop'&&!await window.ScienceScopeWorkspace.confirmAction('结束自动化目标','停止当前目标，保留已有输出与研究文件。不把未完成工作标成成功。','结束目标'))return;await hostRequest('execution/goal',{chatId:V.chat,action});}
    await poll();
  }catch(error){toast(error.message);}
},true);
const after=window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender=(...args)=>{after?.(...args);if(currentId!==V.chat){state={mode:modes.get(V.chat)||'ask',goal:null,approvals:[]};currentId=V.chat;void poll();}paint();};
window.ScienceScopeExecution={mode,openMenu,refresh:()=>poll(),started(id,goal){if(id===V.chat){state={...state,goal,mode:'auto'};paint();}void poll();}};
setInterval(()=>{if(!document.hidden||state.goal||V.pending.has(V.chat))void poll();},1800);
