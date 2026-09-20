import {hostRequest} from './host-client.mjs';
import './workspace.mjs';

const activities=new Map();
const acknowledged=new Map();
const terminal=new Set(['completed','failed','stopped']);
const labels={running:'运行中','waiting-approval':'待处理',queued:'排队中',paused:'已暂停',completed:'已完成',failed:'失败',stopped:'已停止'};
let polling=false;
let stale=false;

function visibleActivity(id) {
  const activity=activities.get(id);
  if(!activity)return null;
  if(terminal.has(activity.state)&&acknowledged.get(id)===activity.updatedAt)return null;
  return activity;
}
function description(activity) {
  return `${labels[activity.state] || '处理中'}${activity.toolName?' · '+activity.toolName:''}${activity.queuedCount?' · 待发 '+activity.queuedCount:''}`;
}
function paint() {
  if(['assistant','assistant-orb'].includes(V.surface))return;
  for(const row of document.querySelectorAll('[data-object="chat"][data-object-id]')) {
    const activity=visibleActivity(row.dataset.objectId);
    let badge=row.querySelector('.chat-activity-badge');
    if(!activity){badge?.remove();continue;}
    if(!badge){badge=document.createElement('span');badge.className='chat-activity-badge';(row.querySelector('.tree-name,.table-title')||row).append(badge);}
    badge.dataset.state=activity.state;
    badge.textContent=stale?'状态待更新':labels[activity.state] || '处理中';
    badge.title=(stale?'连接暂不可用；最后已知状态：':'')+description(activity);
    badge.setAttribute('aria-label',description(activity));
  }
  const viewingChat=!!document.querySelector('.messages');
  const background=[...activities.values()].filter(activity=>(!viewingChat||activity.chatId!==V.chat)&&!terminal.has(activity.state));
  const sidebar=document.querySelector('.sidebar .navscroll');
  let summary=document.querySelector('.background-activity-summary');
  if(!background.length||!sidebar){summary?.remove();return;}
  if(!summary){summary=document.createElement('button');summary.className='background-activity-summary';summary.type='button';sidebar.prepend(summary);}
  summary.textContent=`后台任务 ${background.length} · 查看状态`;
  summary.onclick=()=>menu(background.map(activity=>({
    text:`${S.threads.find(thread=>thread.id===activity.chatId)?.title || '对话'} · ${description(activity)}`,
    act:'select-chat',attrs:`data-id="${esc(activity.chatId)}"`,icon:'chat',
  })),summary,'后台对话');
}
async function poll() {
  if(polling||document.hidden||['assistant','assistant-orb'].includes(V.surface))return;
  polling=true;
  try{
    const result=await hostRequest('chat/activity');
    stale=false;
    activities.clear();
    for(const activity of result.activities || [])activities.set(activity.chatId,activity);
    // A terminal result already being read does not need an unread completion badge.
    const current=activities.get(V.chat);
    if(current&&terminal.has(current.state)&&document.querySelector('.messages'))acknowledged.set(V.chat,current.updatedAt);
    while(acknowledged.size>200)acknowledged.delete(acknowledged.keys().next().value);
    paint();
  }catch{stale=true;paint();}
  finally{polling=false;}
}
const afterRender=window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender=(...args)=>{
  afterRender?.(...args);
  const current=activities.get(V.chat);
  if(current&&terminal.has(current.state)&&document.querySelector('.messages'))acknowledged.set(V.chat,current.updatedAt);
  paint();void poll();
};
window.ScienceScopeActivity={refresh:poll};
setInterval(poll,1500);
