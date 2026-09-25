import { hostRequest } from './host-client.mjs';
import './workspace-layout.mjs';

// Expert discussion answers carry their real author and model from the host.
const authorOf=(m,chatModel)=>m.role!=='assistant'?{}:m.expert?{name:m.expert.label,label:m.expert.model?.modelId||chatModel,expert:m.expert}:{name:'主专家',...(chatModel===undefined?{}:{label:chatModel})};
const CHAT_ROUTES=new Set(['work','free','ordered','secretary','compose','preview','diff','context','browser','overview']);
const PROJECT_ROUTES=new Set(['workbench','journal','versions','files','changes','map','map-rich','map-history']);
const PAGE_LIMIT=60;
const state={ready:false,draft:null,drafts:new Map(),pages:new Map(),load:0,saving:0,lastSaved:'',saveError:false,paging:false,scrollLock:false};
const params=new URLSearchParams(location.search);
const temporary=V.surface==='quick';
const baseActiveThread=activeThread;
const baseChat=chat;
const designHome=home;
const baseDetached=detachedContent;
const baseMainhead=mainhead;
const baseThreadRow=threadRow;
const baseObjectMenu=objectMenu;
const baseGo=go;
// The in-app browser (T08) and runtime branching (T12) are optional features:
// their entry points stay hidden until the host enables them (features.mjs).
// Never present the prototype article as a website or fake an inherited history.
browserPanel=()=>`<aside class="rightpanel browser-panel"><div class="panel-resizer" data-v-resize></div><div class="panelhead between"><h2>浏览器</h2>${vib('close','close-panel','关闭浏览器')}</div></aside>`;
branchAt=()=>{};
const historyNav=page=>page&&(page.before||page.after)?`<div class="history-navigation"><button data-ws="history" data-direction="before" ${!page.before?'disabled':''}>向上加载 30 条</button><span>滚动加载 · 共 ${Number(page.total)} 条</span><button data-ws="history" data-direction="after" ${!page.after?'disabled':''}>向下加载 30 条</button><button data-ws="history" data-direction="latest">回到最新</button></div>`:'';
function scrollLatest(){state.scrollLock=true;requestAnimationFrame(()=>{const box=document.querySelector('.messages');if(box)box.scrollTop=box.scrollHeight;requestAnimationFrame(()=>{state.scrollLock=false;});});}

function focusedProject() {
  if(temporary)return params.get('projectId');
  if(CHAT_ROUTES.has(route))return activeThread()?.projectId || null;
  return PROJECT_ROUTES.has(route)?S.projectId || null:null;
}
activeThread=()=>state.draft?.id===V.chat?state.draft:baseActiveThread();
threadRow=(thread,...rest)=>baseThreadRow(thread,...rest).replace('<div ',`<div draggable="${!thread.projectId}" `);

function setProject(id) {
  const project=S.projects.find(p=>p.id===id);
  if(!project)return;
  if(S.projectId!==id) {
    saveProject();
    projectBuckets[id] ??= {journals:[],versions:[],changes:[],nodes:[],collapsed:{},mapHistory:[],messages:[],annotations:[],submitted:[],contextRefs:[]};
    Object.assign(S,clone(projectBuckets[id]));
  }
  S.projectId=id;S.project=project.name;
}
function restoreChat(id,data) {
  V.chat=id;
  chatFields.forEach(key=>S[key]=clone(data[key] || []));
  S.drafts.main=data.draft || '';S.drafts.secretary=data.secretaryDraft || '';
  S.promptDraft=null;S.promptAnnotations=[];
  V.panel=null;V.overview=false;V.find=false;
}
function capMemory() {
  for(const [id,data] of Object.entries(chatData)) {
    if(id!==V.chat&&!V.pending.has(id)) { data.messages=[]; state.pages.delete(id); }
  }
}
newThread=function(projectId=focusedProject(),title='新对话') {
  saveThread();
  if(projectId&&!S.projects.some(p=>p.id===projectId&&!p.archived))projectId=null;
  const draftKey=projectId||'independent';
  let draft=state.drafts.get(draftKey);
  if(!draft) {
    draft={id:'chat-'+crypto.randomUUID(),projectId,title,updated:vtime(),temporary};
    state.drafts.set(draftKey,draft);
  }
  state.draft=draft;
  if(projectId)setProject(projectId);
  restoreChat(draft.id,chatData[draft.id] || {});S.chatName=draft.title;
  if(!S.drafts.main)queueMicrotask(()=>window.ScienceScopeRoleSettings?.applyNewDraft(draft.id));
  go('work');render();capMemory();
  document.querySelector('[data-draft="main"]')?.focus();
  return draft;
};
selectProject=function(id,navigate=true) {
  if(!S.projects.some(p=>p.id===id))return;
  saveThread();setProject(id);V.panel=null;V.overview=false;
  if(navigate)go('workbench');render();
};
loadThread=async function(id,navigate=true) {
  const thread=S.threads.find(t=>t.id===id);if(!thread)return;
  const ticket=++state.load;
  saveThread();
  try {
    const page=V.pending.has(id)?null:await hostRequest(`chats/${encodeURIComponent(id)}/messages?limit=${PAGE_LIMIT}`);
    if(ticket!==state.load)return;
    state.draft=null;
    if(thread.projectId)setProject(thread.projectId);
    const data=chatData[id] || {};
    if(page) {data.messages=page.messages.map(m=>({...m,time:m.time||m.created,...authorOf(m,thread.model?.modelId)}));state.pages.set(id,page);}
    chatData[id]=data;restoreChat(id,data);S.chatName=thread.title;
    if(thread.model)window.ScienceScopeModels?.select(thread.model);
    if(navigate)go('work');render();capMemory();scheduleSave();scrollLatest();
  } catch {toast('读取聊天失败，原对话未被覆盖。');}
};
async function pageHistory(direction) {
  if(state.paging||V.pending.has(V.chat))return;
  const id=V.chat,paging=state.pages.get(id);if(!paging)return;
  if(direction!=='latest'&&paging[direction]===null)return;
  state.paging=true;
  const box=document.querySelector('.messages'),rect=box?.getBoundingClientRect();
  const visible=[...(box?.querySelectorAll(':scope > .message')||[])].find(el=>el.getBoundingClientRect().bottom>(rect?.top||0)+1);
  const anchor=visible?{id:visible.id,offset:visible.getBoundingClientRect().top-rect.top}:null;
  const previous=S.messages.slice();
  try {
  const cursor=direction==='latest'?'':`${direction}=${encodeURIComponent(paging[direction])}&`;
  const page=await hostRequest(`chats/${encodeURIComponent(id)}/messages?${cursor}limit=${direction==='latest'?PAGE_LIMIT:30}`);
  if(id!==V.chat)return;
  const thread=activeThread();
  const incoming=page.messages.map(m=>({...m,time:m.time||m.created,...authorOf(m,thread.model?.modelId)}));
  S.messages=direction==='latest'?incoming:direction==='before'?[...incoming,...previous].slice(0,PAGE_LIMIT):[...previous,...incoming].slice(-PAGE_LIMIT);
  const start=direction==='before'?Number(page.before??0):direction==='after'?Number(page.after??page.total)-S.messages.length:Math.max(0,page.total-S.messages.length);
  const end=start+S.messages.length;
  state.pages.set(id,{...page,messages:S.messages,before:start>0?String(start):null,after:end<page.total?String(end):null,hasMoreBefore:start>0,hasMoreAfter:end<page.total});
  state.scrollLock=true;saveThread();render();
  requestAnimationFrame(()=>{
    const next=document.querySelector('.messages'),retained=anchor&&document.getElementById(anchor.id);
    if(next){if(direction==='latest')next.scrollTop=next.scrollHeight;else if(retained)next.scrollTop+=retained.getBoundingClientRect().top-next.getBoundingClientRect().top-anchor.offset;}
    requestAnimationFrame(()=>{state.scrollLock=false;});
  });
  }catch {toast('历史消息加载失败，可以继续滚动重试。');}finally{state.paging=false;}
}

home=function() {
  const template=document.createElement('template');template.innerHTML=designHome();
  const project=S.projects.find(p=>p.id===activeThread()?.projectId);
  template.content.querySelector('.homehero h1').textContent=project?`要在 ${project.name} 里研究什么？`:'今天想研究什么？';
  const greeting=document.createElement('p');greeting.className='profile-greeting';
  greeting.textContent=`${window.ScienceScopeProfile?.name()||'用户'}，从一个问题开始，和你的研究小组一起推进。`;
  template.content.querySelector('.homehero').append(greeting);
  if(!S.threads.some(t=>!t.archived))template.content.querySelector('.recent').insertAdjacentHTML('beforeend','<div class="inline-empty">还没有最近工作，发送第一条消息开始。</div>');
  return template.innerHTML;
};
chat=function() {
  // One page in memory and one page in DOM. Loading older pages replaces, not
  // appends; DSH retains complete runtime history independently of this view.
  const text=baseChat();
  const template=document.createElement('template');template.innerHTML=text;
  const messages=template.content.querySelector('.messages');
  if(!messages)return text;
  if(!temporary&&!S.messages?.length) {
    const column=template.content.querySelector('.chatcol');
    column.classList.add('new-chat-home');column.innerHTML=home();
    return template.innerHTML;
  }
  const page=state.pages.get(V.chat);
  if(page&&(page.before||page.after)) {
    messages.insertAdjacentHTML('afterbegin',historyNav(page));
  }
  if(!S.messages?.length)messages.innerHTML=`<div class="chat-empty"><h2>${esc(state.draft?.projectId?S.projects.find(p=>p.id===state.draft.projectId)?.name || '项目对话':'开始一个新对话')}</h2><p>${temporary?'临时提问 · 独立会话，不进入主对话历史':state.draft?.projectId?'将在此项目内创建对话':'独立对话 · 之后可以加入项目'}</p><small>发送第一条消息后创建</small></div>`;
  return template.innerHTML;
};
mainhead=function() {
  const html=baseMainhead();
  if(focusedProject())return html;
  const template=document.createElement('template');template.innerHTML=html;
  template.content.querySelector('#overview-trigger')?.remove();
  return template.innerHTML;
};
go=function(destination) {
  if(destination==='quick')return newThread();
  return baseGo(destination);
};

function newChatMenu(trigger,point) {
  const project=focusedProject();
  const items=[{text:'创建新对话',act:'ws-new-chat',icon:'chat'},{text:'创建独立新对话',act:'ws-new-independent',icon:'plus'}];
  if(project)items.push({text:'创建独立窗口对话',act:'ws-new-window',attrs:`data-project="${esc(project)}"`,icon:'expand'});
  menu(items,trigger,'新对话',point);
}
objectMenu=function(kind,id,trigger,point) {
  baseObjectMenu(kind,id,trigger,point);
  if(kind==='chat'&&!S.threads.find(t=>t.id===id)?.projectId) {
    const item=document.createElement('button');item.className='menu-line';item.setAttribute('role','menuitem');
    item.dataset.ws='choose-project';item.dataset.id=id;item.textContent='加入项目…';
    document.getElementById('v-menu')?.insertBefore(item,document.querySelector('#v-menu .menu-sep'));
  }
};

export function confirmAction(title,description,confirmLabel='确认移除') {
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='workspace-confirm';
    dialog.innerHTML=`<h2>${esc(title)}</h2><p>${esc(description)}</p><form method="dialog"><div class="saverow"><button class="btn" value="cancel" autofocus>取消</button><button class="btn danger-confirm" value="confirm">${esc(confirmLabel)}</button></div></form>`;
    document.body.append(dialog);dialog.showModal();
    dialog.addEventListener('close',()=>{const accepted=dialog.returnValue==='confirm';dialog.remove();resolve(accepted);},{once:true});
  });
}
async function moveChat(id,projectId) {
  const thread=S.threads.find(t=>t.id===id),project=S.projects.find(p=>p.id===projectId);
  if(!thread||!project)return;
  if(V.pending.has(id))return toast('请等待这条对话的回复完成。');
  if(!await confirmAction('加入项目',`将“${thread.title}”加入“${project.name}”？\n保留原有聊天历史；之后的消息提供该项目的目标与目录。原有运行目录和文件不搬迁。`,'加入项目'))return;
  try {
    const moved=await hostRequest('chats/move',{chatId:id,projectId});
    Object.assign(thread,moved);S.projectExpanded[projectId]=true;
    if(V.chat===id)setProject(projectId);
    render();scheduleSave();
  }catch(error){toast(error.message);}
}
async function removeObject(kind,id) {
  const object=kind==='project'?S.projects.find(p=>p.id===id):S.threads.find(t=>t.id===id);
  if(!object)return;
  if(kind==='chat'&&V.pending.has(id))return toast('请等待回复完成后移除对话。');
  if(!await confirmAction(kind==='project'?'移除项目入口':'移除对话',kind==='project'?`移除“${object.name}”的项目入口？\n项目文件和聊天记录会保留，不会删除原始材料。`:`从列表移除“${object.title}”？\n本地历史仍保留，不会删除项目材料。`))return;
  try {
    if(kind==='chat') {
      await hostRequest('chats/delete',{chatId:id});S.threads=S.threads.filter(t=>t.id!==id);delete chatData[id];state.pages.delete(id);
      if(V.chat===id)newThread(object.projectId);
    } else {object.archived=true;if(S.projectId===id)go('home');}
    S.pins=S.pins.filter(pin=>!(pin.type===kind&&pin.id===id));render();scheduleSave();
  }catch(error){toast(error.message);}
}

function snapshot() {return {projects:S.projects.map(({id,name,desc,archived})=>({id,name,desc,archived})),pins:S.pins,projectExpanded:S.projectExpanded,lastChatId:S.threads.some(t=>t.id===V.chat)?V.chat:null};}
async function saveNow() {
  clearTimeout(state.saving);
  const payload=snapshot();await hostRequest('workspace',payload);state.lastSaved=JSON.stringify(payload);state.saveError=false;
}
function scheduleSave() {
  if(!state.ready||V.surface)return;
  clearTimeout(state.saving);
  state.saving=setTimeout(async()=>{
    const payload=snapshot(),signature=JSON.stringify(payload);if(signature===state.lastSaved)return;
    try {await hostRequest('workspace',payload);state.lastSaved=signature;state.saveError=false;}
    catch {if(!state.saveError)toast('工作区保存失败，请不要关闭应用。');state.saveError=true;}
  },200);
}
function afterRender() {
  scheduleSave();const box=document.querySelector('.messages');if(!box||box.dataset.paged)return;box.dataset.paged='true';
  let lastTop=box.scrollTop;
  const tryLoad=delta=>{if(state.scrollLock||state.paging||!delta)return;if(delta<0&&box.scrollTop<140)void pageHistory('before');else if(delta>0&&box.scrollHeight-box.scrollTop-box.clientHeight<140)void pageHistory('after');};
  box.addEventListener('scroll',()=>{const delta=box.scrollTop-lastTop;lastTop=box.scrollTop;tryLoad(delta);},{passive:true});
  box.addEventListener('wheel',event=>tryLoad(event.deltaY),{passive:true});
}

openDetached=async function(surface) {
  const projectId=focusedProject();
  if(surface==='quick'&&!projectId)return toast('临时窗口对话需要先进入一个项目；可选择“创建独立新对话”。');
  const options={surface,...(['quick','map'].includes(surface)&&projectId?{projectId}:{})};
  if(window.ScienceScopeWindows?.isNative()) {
    try {await window.ScienceScopeWindows.open({...options,toggle:surface==='assistant'});}catch {toast('辅助窗口打开失败。');}
    return;
  }
  toast('此操作需要桌面客户端的独立窗口。');
};
detachedContent=function() {
  if(V.surface==='assistant-orb') {
    document.documentElement.classList.add('native-orb');
    document.body.innerHTML=`<div class="orb-view"><button class="assistant-orb" data-v="toggle-orb" aria-label="展开或收起全局助手"><img src="${window.LOGO_SRC}" alt=""></button></div>`;
    return;
  }
  if(V.surface==='assistant') {
    V.orb=false;baseDetached();
    document.documentElement.classList.add('assistant-panel');
    document.querySelector('.detached-shell > .panelhead')?.remove();
    document.querySelector('.detach-foot')?.remove();
    return;
  }
  if(!temporary)return baseDetached();
  document.body.innerHTML=`<div class="temporary-chat-shell"><div class="mainhead"><strong>项目临时提问 · ${esc(S.projects.find(p=>p.id===params.get('projectId'))?.name || '加载中')}</strong><span class="spacer"></span>${vbtn(ic('close'),'close-window','aria-label="关闭窗口"','iconbtn')}</div><div class="temporary-context-note">读取项目名称与研究目标；独立上下文，不自动写入主对话或正式科研记录。窗口显示最近 60 条。</div>${chat()}</div>`;
};

window.addEventListener('click',async event=>{
  const target=event.target.closest('[data-ws],[data-v],[data-action],[data-route]');if(!target)return;
  const action=target.dataset.ws || target.dataset.v || target.dataset.action;
  const isNew=target.dataset.route==='quick'||['new-chat','ws-new-chat','ws-new-independent','ws-new-window'].includes(action);
  const actions=['choose-project','move-project','delete-object','save-rename','archive-object','unread-object','history','delete-record','reset-demo','create-project','create-project-v2','release-notes'];
  if(!isNew&&!actions.includes(action))return;
  event.preventDefault();event.stopImmediatePropagation();
  const id=target.dataset.id;
  try {
    if(action==='create-project'||action==='create-project-v2') {
      const name=document.getElementById('new-project-name')?.value.trim();if(!name)return toast('请输入项目名称。');
      // Working folder and Python environment come from the creation page
      // (creation-details.mjs); a folder the host rejects keeps the page open.
      const choice=window.ScienceScopeCreation?await window.ScienceScopeCreation.projectChoice():{folder:null,envId:null};
      if(!choice)return;
      const project={id:'project-'+crypto.randomUUID(),name,desc:document.getElementById('new-project-goal')?.value || ''};
      S.projects.push(project);S.projectExpanded[project.id]=true;selectProject(project.id);
      await saveNow();
      try{await window.ScienceScopeCreation?.applyProjectChoice(project,choice);}
      catch(error){toast('项目已创建，但工作文件夹或 Python 环境未能应用：'+error.message+'（可在工作站中重新绑定目录）');}
    } else if(action==='release-notes') {
      modal('本轮更新',`<ul><li>新建独立对话时选择工作文件夹与 Python 环境；新建项目可以绑定已有文件夹。</li><li>有序讨论：专家读取同一份前文并行作答，可指定审核专家；审核结论由你决定是否加入后续上下文。</li><li>工作模式中用 @ 邀请专家；工具调用前的说明归入工具记录。</li><li>聊天和文件预览中的文字可以添加为标记，随下一条消息一起发送。</li><li>界面中的说明统一收进"i"提示。</li></ul>`);
    } else if(isNew) {
      closeMenu();
      if(action==='ws-new-window')await openDetached('quick');
      else (window.ScienceScopeCreation?.newChat||newThread)(action==='ws-new-independent'?null:target.dataset.project || focusedProject());
    } else if(action==='history')await pageHistory(target.dataset.direction);
    else if(action==='choose-project')menu(S.projects.filter(p=>!p.archived).map(p=>({text:p.name,act:'ws-move',attrs:`data-id="${esc(id)}" data-project="${esc(p.id)}"`,icon:'folder'})),target,'加入项目');
    else if(action==='delete-object') {closeMenu();await removeObject(target.dataset.kind,id);}
    else if(action==='delete-record') {
      if(await confirmAction('删除记录','确定删除这条计划或日志？','删除'))deleteRecord(target.dataset.kind,id);
    } else if(action==='reset-demo'){/* prototype-only: the desktop never resets user data */}
    else if(action==='save-rename') {
      const title=document.getElementById('v-rename')?.value.trim();if(!title)return;
      if(target.dataset.kind==='chat') {const updated=await hostRequest('chats/update',{chatId:id,title});Object.assign(S.threads.find(t=>t.id===id),updated);}
      else {const project=S.projects.find(p=>p.id===id);project.name=title;if(S.projectId===id)S.project=title;}
      render();scheduleSave();
    } else if(['archive-object','unread-object'].includes(action)) {
      const object=target.dataset.kind==='project'?S.projects.find(p=>p.id===id):S.threads.find(t=>t.id===id);
      const field=action==='archive-object'?'archived':'unread';
      if(target.dataset.kind==='chat')Object.assign(object,await hostRequest('chats/update',{chatId:id,[field]:!object[field]}));
      else object[field]=!object[field];
      render();scheduleSave();
    }
  }catch(error){toast(error.message || '操作未完成。');}
},true);
window.addEventListener('click',event=>{
  const item=event.target.closest('[data-v="ws-move"]');if(!item)return;
  event.preventDefault();event.stopImmediatePropagation();const {id,project}=item.dataset;closeMenu();void moveChat(id,project);
},true);
window.addEventListener('contextmenu',event=>{
  const button=event.target.closest('[data-route="quick"]');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();newChatMenu(button,{x:event.clientX,y:event.clientY});
},true);
window.addEventListener('dragstart',event=>{
  const row=event.target.closest('[data-object="chat"][draggable="true"]');if(!row)return;
  event.dataTransfer.setData('application/x-sciencescope-chat',row.dataset.objectId);event.dataTransfer.effectAllowed='move';
});
window.addEventListener('dragover',event=>{
  if(![...event.dataTransfer.types].includes('application/x-sciencescope-chat'))return;
  const row=event.target.closest('[data-object="project"]');if(!row)return;
  event.preventDefault();event.stopImmediatePropagation();row.classList.add('drop-target');
},true);
window.addEventListener('dragleave',event=>event.target.closest('[data-object="project"]')?.classList.remove('drop-target'));
window.addEventListener('drop',event=>{
  const id=event.dataTransfer.getData('application/x-sciencescope-chat');const row=event.target.closest('[data-object="project"]');
  if(!id||!row)return;event.preventDefault();event.stopImmediatePropagation();row.classList.remove('drop-target');void moveChat(id,row.dataset.objectId);
},true);
window.addEventListener('keydown',event=>{
  if(event.isComposing)return;
  if(document.querySelector('dialog[open]')) {if(event.key==='Escape')event.stopImmediatePropagation();return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='n') {event.preventDefault();event.stopImmediatePropagation();newThread(event.altKey?null:focusedProject());}
},true);
window.addEventListener('pagehide',()=>{
  if(temporary&&V.chat)void hostRequest('chats/temporary-close',{chatId:V.chat},{keepalive:true}).catch(()=>{});
});

window.ScienceScopeWorkspace={
  focusedProject,afterRender,confirmAction,
  async openMessage(chatId,messageId){
    await loadThread(chatId);
    if(V.chat!==chatId)return;
    if(V.pending.has(chatId)){toast('此对话正在运行，已打开最新进度。');return;}
    const page=await hostRequest(`chats/${encodeURIComponent(chatId)}/messages?around=${encodeURIComponent(messageId)}`);
    if(V.chat!==chatId||!page)return;
    S.messages=page.messages.map(m=>({...m,time:m.created,...authorOf(m)}));
    state.pages.set(chatId,page);saveThread();render();
    requestAnimationFrame(()=>{
      const element=document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)||document.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
      if(element){element.scrollIntoView({block:'center'});element.animate([{background:'#e6e9e2'},{background:'transparent'}],1800);}
    });
  },
  async appendNotice(message){
    if(!message)return;
    // A settings change must not eject the user from the history they are reading.
    // The durable receipt will be loaded when they explicitly return to latest.
    if(state.pages.get(V.chat)?.after)return;
    const previousBox=document.querySelector('.messages');
    const follow=previousBox&&previousBox.scrollHeight-previousBox.scrollTop-previousBox.clientHeight<90;
    const receipt={...message,time:message.created||vtime()};
    S.messages.push(receipt);S.messages=S.messages.slice(-PAGE_LIMIT);saveThread();
    const box=document.querySelector('.messages');
    box?.insertAdjacentHTML('beforeend',messageHTML(receipt));
    const nodes=[...(box?.querySelectorAll(':scope > .message')||[])];
    for(const node of nodes.slice(0,Math.max(0,nodes.length-PAGE_LIMIT)))node.remove();
    if(follow)scrollLatest();await window.ScienceScopeWorkspace.settled(V.chat);
  },
  async refreshLive(id){
    if(id!==V.chat||V.pending.has(id)||state.paging||state.pages.get(id)?.after)return;
    const page=await hostRequest(`chats/${encodeURIComponent(id)}/messages?limit=${PAGE_LIMIT}`);
    if(id!==V.chat||page.total===state.pages.get(id)?.total)return;
    const box=document.querySelector('.messages'),follow=box&&box.scrollHeight-box.scrollTop-box.clientHeight<100,top=box?.scrollTop||0;
    S.messages=page.messages.map(m=>({...m,time:m.created,...authorOf(m,activeThread()?.model?.modelId)}));
    state.pages.set(id,page);saveThread();render();if(follow)scrollLatest();else if(document.querySelector('.messages'))document.querySelector('.messages').scrollTop=top;
  },
  resolveThread:id=>state.draft?.id===id?state.draft:S.threads.find(t=>t.id===id),
  focusedProject:()=>focusedProject(),
  draftFor:key=>state.drafts.get(key)||null,
  async beforeSend(id) {
    await window.ScienceScopeWorkspace.ready;
    if(!state.ready)throw new Error('工作区尚未就绪，暂不能发送。');
    if(!V.surface) {const payload=snapshot();await hostRequest('workspace',payload);state.lastSaved=JSON.stringify(payload);}
    const page=state.pages.get(id);if(id===V.chat&&page?.after)await pageHistory('latest');
  },
  accepted(thread,text) {
    thread.title=thread.title==='新对话'?text.trim().slice(0,40):thread.title;
    if(!thread.temporary&&!S.threads.some(t=>t.id===thread.id))S.threads.unshift(thread);
    if(!thread.temporary) {state.drafts.delete(thread.projectId||'independent');if(state.draft?.id===thread.id)state.draft=null;}
    if(V.chat===thread.id)S.chatName=thread.title;
    scheduleSave();
  },
  async settled(id) {
    if(temporary) {
      S.messages=S.messages.slice(-PAGE_LIMIT);saveThread();
      const nodes=[...document.querySelectorAll('.messages > .message')];
      for(const node of nodes.slice(0,Math.max(0,nodes.length-PAGE_LIMIT)))node.remove();
      return;
    }
    try {
      const page=await hostRequest(`chats/${encodeURIComponent(id)}/messages?limit=${PAGE_LIMIT}`);
      const thread=S.threads.find(t=>t.id===id);if(thread)Object.assign(thread,page.chat);
      // Preserve the live DOM/selection; evict old memory after each turn.
      if(V.chat===id) {
        S.messages=S.messages.slice(-PAGE_LIMIT);state.pages.set(id,page);saveThread();
        const box=document.querySelector('.messages');
        const nodes=[...(box?.querySelectorAll(':scope > .message') || [])];
        for(const node of nodes.slice(0,Math.max(0,nodes.length-PAGE_LIMIT)))node.remove();
        box?.querySelector('.history-navigation')?.remove();box?.insertAdjacentHTML('afterbegin',historyNav(page));
      }
      else if(chatData[id])chatData[id].messages=[];
    }catch {toast('聊天记录状态未能刷新，请暂时保留窗口。');}
  },
};
window.SSV2={...window.SSV2,newThread:(...a)=>newThread(...a),loadThread:(...a)=>loadThread(...a),selectProject:(...a)=>selectProject(...a),openDetached:(...a)=>openDetached(...a)};
window.SS.navigate=(...a)=>go(...a);
window.ScienceScopeWorkspace.ready=(async()=>{
  const requestedSettings=[...settingsRoutes,'provider','plugin'].includes(route)?route:null;
  try {
    const [workspace,{chats}]=await Promise.all([hostRequest('workspace'),hostRequest('chats')]);
    S.projects=workspace.projects;S.pins=workspace.pins;S.projectExpanded=workspace.projectExpanded;S.threads=chats;
    S.messages=[];for(const id of Object.keys(chatData))delete chatData[id];
    // Prototype examples are not research facts in a real workspace.
    projectBuckets={};
    for(const project of S.projects)projectBuckets[project.id]={journals:[],versions:[],changes:[],nodes:[],collapsed:{},mapHistory:[],messages:[],annotations:[],submitted:[],contextRefs:[]};
    for(const field of projectFields)S[field]=['collapsed'].includes(field)?{}:[];
    S.projectId=S.projects[0]?.id || '';S.project=S.projects[0]?.name || 'ScienceScope';
    if(V.surface&&params.get('projectId'))setProject(params.get('projectId'));
    state.ready=true;
    if(temporary)newThread(params.get('projectId'));
    else if(!V.surface&&workspace.lastChatId&&chats.some(t=>t.id===workspace.lastChatId))await loadThread(workspace.lastChatId);
    else if(!V.surface)newThread(null);
    else render();
    if(requestedSettings&&!V.surface)go(requestedSettings);
  }catch {toast('本地工作区读取失败，未覆盖已有内容。');}
})();
