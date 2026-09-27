import {infoTip} from './info-tip.mjs';
import {hostRequest} from './host-client.mjs';

// Research input drafts: attachments, message quotes and file annotations per
// composer ({scope, owner}). Quotes and annotations are shown to the user as
// "标记" (marks): one "标记 N" button in the composer opens a popover listing
// them; selecting text in a message or in the file preview adds one.
const drafts=new Map(),writes=new Map(),loading=new Map();
const titles=new Map();
const channel=new BroadcastChannel('sciencescope-research-input');
const MAX_SELECTED=8000,MAX_QUOTES=16,MAX_ANNOTATIONS=32;
const MARK_KINDS=['messageQuotes','annotations'];
const SCOPE_LABEL={main:'主对话',secretary:'任务秘书',global:'全局助手'};

const empty=()=>({attachmentIds:[],messageQuotes:[],annotations:[],contextRefs:[]});
const key=(scope,owner)=>JSON.stringify([scope,owner]);
const get=(scope,owner)=>drafts.get(key(scope,owner))||empty();
async function load(scope,owner){
  const id=key(scope,owner);if(drafts.has(id))return get(scope,owner);
  if(!loading.has(id))loading.set(id,hostRequest('research-input/draft?'+new URLSearchParams({scope,ownerId:owner})).then(value=>{drafts.set(id,value);rememberTitles(value.labels);return value;}).finally(()=>loading.delete(id)));
  return loading.get(id);
}
function save(scope,owner){
  const id=key(scope,owner),snapshot=structuredClone(get(scope,owner));
  const work=(writes.get(id)||Promise.resolve()).catch(()=>{}).then(()=>hostRequest('research-input/draft',{scope,ownerId:owner,snapshot})).then(value=>{channel.postMessage({scope,owner});return value;});
  writes.set(id,work);return work;
}
channel.onmessage=async({data})=>{try{await writes.get(key(data.scope,data.owner));const value=await hostRequest('research-input/draft?'+new URLSearchParams({scope:data.scope,ownerId:data.owner}));drafts.set(key(data.scope,data.owner),value);rememberTitles(value.labels);paint();}catch(error){toast(error.message);}};

// ---- resource titles (for annotation sources and receipts) -------------------
function rememberTitles(map){for(const [id,title] of Object.entries(map||{}))if(title)titles.set(id,title);}
let titleFetch=null;
function titleOf(id){
  if(titles.has(id))return titles.get(id);
  // Receipts render synchronously; fetch the library once and patch in place.
  titleFetch??=hostRequest('library').then(({resources})=>{for(const r of resources)titles.set(r.id,r.title);for(const node of document.querySelectorAll('[data-resource-title]'))if(titles.has(node.dataset.resourceTitle))node.textContent=titles.get(node.dataset.resourceTitle);}).catch(()=>{});
  return '资料 '+String(id).slice(0,8);
}
const titleSpan=id=>`<span data-resource-title="${esc(id)}">${esc(titleOf(id))}</span>`;

// ---- mark presentation (shared by composer popover and sent receipts) -------
const locationLabel=location=>!location?'':typeof location.description==='string'?location.description:JSON.stringify(location);
function ordered(value){
  const items=[];for(const kind of MARK_KINDS)for(const item of value[kind]||[])items.push({kind,item});
  // Keep creation order across both kinds; legacy items without createdAt keep their stored order.
  return items.map((entry,index)=>({...entry,index})).sort((a,b)=>(a.item.createdAt||0)-(b.item.createdAt||0)||a.index-b.index);
}
function sourceHTML(kind,item,chatId){
  if(kind==='annotations'){const where=locationLabel(item.location);return `${item.resourceTitle?esc(item.resourceTitle):titleSpan(item.resourceId)}${where?` <span class="mark-where">· ${esc(where)}</span>`:''}`;}
  let speaker=item.sourceLabel;
  if(!speaker){const message=(S.messages||[]).find(m=>m.id===item.sourceMessageId);speaker=item.speaker==='user'||message?.role==='user'?'你':message?.expert?.label||message?.name||(item.speaker==='system'?'系统':'主专家');}
  const other=item.sourceChatId&&chatId&&item.sourceChatId!==chatId?(item.sourceChatTitle||S.threads?.find(t=>t.id===item.sourceChatId)?.title):'';
  return `${esc(speaker)}${other?` <span class="mark-where">· ${esc(other)}</span>`:''}`;
}
function markHTML({kind,item},index,{chatId,actions=false,editing=false}={}){
  const note=item.comment||'';
  const noteHTML=editing
    ?`<textarea class="mark-edit" data-mark-note maxlength="${MAX_SELECTED}" rows="3" aria-label="修改备注" placeholder="备注（可选）">${esc(note)}</textarea><div class="mark-actions"><button type="button" class="btn tiny primary" data-mark-action="save">保存</button><button type="button" class="btn tiny" data-mark-action="cancel">取消</button></div>`
    :`<div class="mark-note${note?'':' is-empty'}">${note?esc(note):'无备注'}</div>${actions?`<div class="mark-actions"><button type="button" data-mark-action="locate">定位</button><button type="button" data-mark-action="edit">修改</button><button type="button" class="danger" data-mark-action="remove">移除</button></div>`:''}`;
  return `<li class="mark-item${editing?' is-editing':''}" data-mark-kind="${kind}" data-mark-id="${esc(item.id||'')}"><div class="mark-source"><span class="mark-index">${index+1}</span><span class="mark-kind">${kind==='annotations'?'文件':'对话'}</span><span class="mark-origin">${sourceHTML(kind,item,chatId)}</span></div><blockquote class="mark-text" tabindex="0" title="点击展开或收起原文">${esc(item.selectedText)}</blockquote>${noteHTML}</li>`;
}

// Sent user messages: readable receipt instead of a JSON dump.
const baseMessage=messageHTML;
messageHTML=function(message){
  const html=baseMessage(message),value=message.researchInput;
  if(!value||![value.attachmentIds,value.messageQuotes,value.annotations,value.contextRefs].some(items=>items?.length))return html;
  const marks=ordered({messageQuotes:value.messageQuotes||[],annotations:value.annotations||[]});
  const ids=[...new Set([...(value.attachmentIds||[]),...(value.contextRefs||[]).map(r=>r.resourceId)])];
  const summary=[marks.length?`标记 ${marks.length} 条`:'',ids.length?`材料 ${ids.length} 份`:''].filter(Boolean).join(' · ');
  const details=`<details class="research-receipt"><summary>${summary}</summary>${marks.length?`<ol class="mark-list">${marks.map((entry,i)=>markHTML(entry,i,{chatId:V.chat})).join('')}</ol>`:''}${ids.length?`<div class="receipt-materials">${ids.map(id=>`<span class="ref-chip">${titleSpan(id)}</span>`).join('')}</div>`:''}</details>`;
  return html.replace('<div class="msg-actions">',details+'<div class="msg-actions">');
};

// ---- composer chips and the marks popover ------------------------------------
const markCount=value=>MARK_KINDS.reduce((n,kind)=>n+(value[kind]?.length||0),0);
const composerOwner=composer=>{const surface=composer.closest('.assistant-surface');return {scope:surface?.dataset.scope||'main',owner:surface?.dataset.owner||V.chat};};
function composerFor(scope,owner){for(const composer of document.querySelectorAll('[data-composer="main"],.assistant-composer')){const at=composerOwner(composer);if(at.scope===scope&&at.owner===owner)return composer;}return null;}
let open=null;// {scope,owner,editing:{kind,id}|null}

function paint(){
  const positions=[...document.querySelectorAll('.messages,.assistant-messages')].map(element=>[element,element.scrollTop]);
  for(const composer of document.querySelectorAll('[data-composer="main"],.assistant-composer')){
    const {scope,owner}=composerOwner(composer);if(!owner)continue;
    let box=composer.querySelector('.research-input-chips');if(!box){box=document.createElement('div');box.className='research-input-chips attachmentbar';composer.prepend(box);}
    const value=get(scope,owner),count=markCount(value),expanded=open?.scope===scope&&open?.owner===owner;
    const chips=value.attachmentIds.map(id=>`<button type="button" class="ref-chip" data-research-edit="attachmentIds" data-id="${esc(id)}" data-scope="${scope}" data-owner="${esc(owner)}" title="预览、批注或移除">${esc(value.labels?.[id]||titles.get(id)||'材料 '+id.slice(0,8))}</button>`);
    if(count)chips.push(`<button type="button" class="ref-chip marks-toggle" data-marks-toggle data-scope="${scope}" data-owner="${esc(owner)}" aria-haspopup="dialog" aria-expanded="${expanded}">标记 <b>${count}</b></button>`);
    const html=chips.join('');if(box.innerHTML!==html)box.innerHTML=html;
    box.style.display=chips.length?'':'none';
  }
  for(const [element,top]of positions)element.scrollTop=top;
  paintPopover();
  window.ScienceScopePreview?.refreshMarks?.();
}
function closeMarks(){open=null;document.querySelector('.marks-popover')?.remove();for(const b of document.querySelectorAll('[data-marks-toggle]'))b.setAttribute('aria-expanded','false');}
function paintPopover(){
  if(!open)return;
  const composer=composerFor(open.scope,open.owner),value=get(open.scope,open.owner),marks=ordered(value);
  if(!composer||!marks.length){closeMarks();return;}
  let pop=document.querySelector('.marks-popover');
  if(!pop){pop=document.createElement('div');pop.className='marks-popover';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','标记');pop.addEventListener('click',onPopoverClick);pop.addEventListener('keydown',onPopoverKey);document.body.append(pop);}
  const chatId=open.scope==='main'?open.owner:window.ScienceScopeAssistants?.entry?.(open.scope,open.owner)?.chat?.id;
  const html=`<div class="marks-popover-head"><strong>标记 ${marks.length}</strong>${infoTip('发送时，标记会与正文一起组成下一轮输入。',{label:'标记说明'})}<span class="spacer"></span><button type="button" class="marks-clear" data-mark-action="clear">全部清除</button><button type="button" class="marks-close" data-mark-action="close" aria-label="关闭">×</button></div><ol class="mark-list">${marks.map((entry,i)=>markHTML(entry,i,{chatId,actions:true,editing:open.editing?.kind===entry.kind&&open.editing?.id===entry.item.id})).join('')}</ol>`;
  if(pop._html!==html){const list=pop.querySelector('.mark-list'),top=list?.scrollTop||0,expandedIds=[...pop.querySelectorAll('.mark-text.is-expanded')].map(n=>n.closest('.mark-item').dataset.markId);pop.innerHTML=html;pop._html=html;const next=pop.querySelector('.mark-list');next.scrollTop=top;for(const node of next.querySelectorAll('.mark-item'))if(expandedIds.includes(node.dataset.markId))node.querySelector('.mark-text').classList.add('is-expanded');const edit=pop.querySelector('[data-mark-note]');if(edit){edit.focus({preventScroll:true});edit.setSelectionRange(edit.value.length,edit.value.length);}}
  const rect=composer.getBoundingClientRect(),width=Math.min(Math.max(rect.width,300),560);
  pop.style.width=width+'px';pop.style.left=Math.max(8,Math.min(rect.left,innerWidth-width-8))+'px';pop.style.bottom=Math.max(8,innerHeight-rect.top+8)+'px';
  for(const b of document.querySelectorAll('[data-marks-toggle]'))b.setAttribute('aria-expanded',String(b.dataset.scope===open.scope&&b.dataset.owner===open.owner));
}
function findItem(scope,owner,kind,id){return get(scope,owner)[kind]?.find(item=>item.id===id);}
async function onPopoverClick(event){
  const toggle=event.target.closest('.mark-text');if(toggle){toggle.classList.toggle('is-expanded');return;}
  const button=event.target.closest('[data-mark-action]');if(!button||!open)return;
  const {scope,owner}=open,action=button.dataset.markAction,node=button.closest('.mark-item'),kind=node?.dataset.markKind,id=node?.dataset.markId;
  try{
    if(action==='close')return closeMarks();
    if(action==='clear'){const value=get(scope,owner);value.messageQuotes=[];value.annotations=[];closeMarks();await save(scope,owner);paint();return;}
    const item=findItem(scope,owner,kind,id);if(!item)return;
    if(action==='edit'){open.editing={kind,id};paintPopover();}
    else if(action==='cancel'){open.editing=null;paintPopover();}
    else if(action==='save'){item.comment=node.querySelector('[data-mark-note]').value;item.revision=(item.revision||0)+1;open.editing=null;await save(scope,owner);paint();}
    else if(action==='remove'){const value=get(scope,owner);value[kind]=value[kind].filter(v=>v!==item);if(open?.editing?.id===id)open.editing=null;await save(scope,owner);paint();}
    else if(action==='locate'){closeMarks();await locate(kind,item);}
  }catch(error){toast(error.message);}
}
function onPopoverKey(event){
  if(event.isComposing||event.keyCode===229)return;
  if(event.target.matches('[data-mark-note]')&&event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.target.closest('.mark-item').querySelector('[data-mark-action="save"]').click();}
  else if(event.target.matches('.mark-text')&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.target.classList.toggle('is-expanded');}
}
async function locate(kind,item){
  if(kind==='annotations'){
    if(!window.ScienceScopePreview||V.surface)throw new Error('请在主窗口的文件预览中定位此标记。');
    await window.ScienceScopePreview.open(item.resourceId,{highlight:item.selectedText,page:item.location?.page,location:item.location});return;
  }
  const id=item.sourceMessageId,target=document.getElementById('message-'+id)||[...document.querySelectorAll('[data-assistant-message]')].find(n=>n.dataset.assistantMessage===id);
  if(!target){toast('来源消息不在当前页面：请切换到对应对话或加载更早记录后再定位。');return;}
  target.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  target.classList.remove('msg-target');void target.offsetWidth;target.classList.add('msg-target');setTimeout(()=>target.classList.remove('msg-target'),1800);
  const text=target.querySelector('.message-text');const range=text&&findTextRange(text,item.selectedText);if(range)flashRange(range);
}
window.addEventListener('click',event=>{
  const button=event.target.closest('[data-marks-toggle]');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  const {scope,owner}=button.dataset;
  if(open?.scope===scope&&open?.owner===owner)closeMarks();else{closeMarks();open={scope,owner,editing:null};paintPopover();}
},true);
window.addEventListener('pointerdown',event=>{
  if(!event.target.closest('[data-research-selection]'))closeSelection();
  if(open&&!event.target.closest('.marks-popover,[data-marks-toggle]'))closeMarks();
  if(!event.target.closest('[data-attachment-menu]'))document.querySelector('[data-attachment-menu]')?.remove();
},true);
window.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||event.isComposing)return;
  const selection=document.querySelector('[data-research-selection]'),menu=document.querySelector('[data-attachment-menu]');
  if(selection)closeSelection();
  else if(menu)menu.remove();
  else if(open?.editing){open.editing=null;paintPopover();}
  else if(open){const {scope,owner}=open;closeMarks();composerFor(scope,owner)?.querySelector('[data-marks-toggle]')?.focus();}
  else return;
  event.preventDefault();event.stopImmediatePropagation();
},true);
window.addEventListener('click',event=>{const text=event.target.closest('.research-receipt .mark-text');if(text)text.classList.toggle('is-expanded');});
window.addEventListener('resize',()=>paintPopover());
window.addEventListener('scroll',()=>paintPopover(),true);

// ---- text ranges and highlights ------------------------------------------------
// Whitespace-insensitive search so a multi-paragraph selection still matches
// the rendered DOM text.
export function findTextRange(root,needle){
  const wanted=String(needle||'').replace(/\s+/g,'');if(!wanted)return null;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.parentElement?.closest('.code-copy')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  let compact='';const map=[];
  for(let node=walker.nextNode();node;node=walker.nextNode()){const text=node.nodeValue;for(let i=0;i<text.length;i++)if(!/\s/.test(text[i])){compact+=text[i];map.push([node,i]);}}
  const at=compact.indexOf(wanted);if(at<0)return null;
  const range=document.createRange(),[startNode,startOffset]=map[at],[endNode,endOffset]=map[at+wanted.length-1];
  range.setStart(startNode,startOffset);range.setEnd(endNode,endOffset+1);return range;
}
const highlights=globalThis.CSS?.highlights&&typeof Highlight==='function';
export function setHighlight(name,ranges){if(!highlights)return;ranges=ranges.filter(Boolean);if(ranges.length)CSS.highlights.set(name,new Highlight(...ranges));else CSS.highlights.delete(name);}
let flashTimer;
export function flashRange(range){
  if(!highlights){const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return;}
  setHighlight('ss-mark-focus',[range]);clearTimeout(flashTimer);flashTimer=setTimeout(()=>setHighlight('ss-mark-focus',[]),2400);
}

// ---- selection popover ----------------------------------------------------------
function closeSelection(){document.querySelector('[data-research-selection]')?.remove();setHighlight('ss-pending',[]);}
// Anchored, non-modal: note (optional) + 添加标记; secondary targets as small buttons.
export function selectionPopover(range,selectedText,{onAdd,secondary=[]}){
  closeSelection();
  if(selectedText.length>MAX_SELECTED){toast(`选中文字超过 ${MAX_SELECTED} 字，请缩短后再标记。`);return null;}
  const rect=range.getBoundingClientRect(),pop=document.createElement('div');
  pop.dataset.researchSelection='';pop.className='mark-selection-popover';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','添加标记');
  pop.innerHTML=`<blockquote class="mark-text">${esc(selectedText)}</blockquote><textarea data-mark-comment rows="2" maxlength="${MAX_SELECTED}" aria-label="标记备注" placeholder="备注（可选）· Enter 添加，Shift+Enter 换行"></textarea><div class="mark-selection-actions">${secondary.map((item,i)=>`<button type="button" class="mark-secondary" data-secondary="${i}">${esc(item.label)}</button>`).join('')}<button type="button" class="mark-secondary" data-copy>复制</button><span class="spacer"></span><button type="button" class="btn tiny primary" data-add>添加标记</button></div>`;
  document.body.append(pop);setHighlight('ss-pending',[range.cloneRange()]);
  const width=pop.offsetWidth,height=pop.offsetHeight;
  pop.style.left=Math.max(8,Math.min(rect.left,innerWidth-width-8))+'px';
  const below=rect.bottom+8,above=rect.top-height-8;
  pop.style.top=Math.max(8,Math.min(below+height<innerHeight-8?below:above,innerHeight-height-8))+'px';
  const note=pop.querySelector('[data-mark-comment]');note.focus({preventScroll:true});
  let busy=false;
  const run=async task=>{if(busy)return;busy=true;try{const comment=note.value;await task(comment);closeSelection();getSelection()?.removeAllRanges();}catch(error){busy=false;toast(error.message);}};
  pop.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-add'))void run(onAdd);
    else if(button.hasAttribute('data-copy'))void run(()=>navigator.clipboard.writeText(selectedText).then(()=>toast('已复制')));
    else if(button.dataset.secondary)void run(secondary[+button.dataset.secondary].run);
  });
  note.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void run(onAdd);}});
  return pop;
}

// ---- adding -------------------------------------------------------------------------
async function add(scope,owner,field,value){
  await load(scope,owner);const draft=get(scope,owner);
  if(field==='messageQuotes'&&draft.messageQuotes.length>=MAX_QUOTES)throw new Error(`每条消息最多 ${MAX_QUOTES} 条对话引用。`);
  if(field==='annotations'&&draft.annotations.length>=MAX_ANNOTATIONS)throw new Error(`每条消息最多 ${MAX_ANNOTATIONS} 条文件标记。`);
  if(MARK_KINDS.includes(field))value.createdAt??=Date.now();
  draft[field].push(value);await save(scope,owner);paint();
  if(MARK_KINDS.includes(field)){const chip=composerFor(scope,owner)?.querySelector('[data-marks-toggle]');if(chip){chip.classList.remove('is-bumped');void chip.offsetWidth;chip.classList.add('is-bumped');}}
}
async function attachFiles(files,scope='main',owner=V.chat){for(const file of files){await load(scope,owner);if(get(scope,owner).attachmentIds.length>=8)throw new Error('每条消息最多附加 8 个材料。');if(file.size>20*1024*1024)throw new Error('文件上限 20 MiB。');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));const resource=await hostRequest('library/import',{name:file.name,base64:btoa(binary),projectId:activeThread()?.projectId||null});get(scope,owner).labels??={};get(scope,owner).labels[resource.id]=resource.title;titles.set(resource.id,resource.title);await add(scope,owner,'attachmentIds',resource.id);}}
vAttach=async(files,scope='main')=>{try{if(scope!=='main')throw new Error('请使用对应助手输入框的附件按钮。');await attachFiles(files,scope,V.chat);}catch(error){toast(error.message);}};

// Attachment chip: small anchored menu (preview/mark, manual text annotation, remove).
function attachmentMenu(button){
  document.querySelector('[data-attachment-menu]')?.remove();
  const {scope,owner,id}=button.dataset,menu=document.createElement('div');
  menu.dataset.attachmentMenu='';menu.className='contextmenu attachment-menu';menu.setAttribute('role','menu');
  menu.innerHTML=`${window.ScienceScopePreview&&!V.surface?'<button type="button" role="menuitem" data-do="preview">预览并标记</button>':''}<button type="button" role="menuitem" data-do="annotate">手动添加文本标记</button><button type="button" role="menuitem" class="danger" data-do="remove">移除附件（不删除原件）</button>`;
  document.body.append(menu);const rect=button.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(rect.left,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,rect.top-menu.offsetHeight-6)+'px';
  menu.querySelector('button')?.focus();
  menu.onclick=async event=>{const choice=event.target.closest('[data-do]')?.dataset.do;if(!choice)return;menu.remove();try{
    if(choice==='preview')await window.ScienceScopePreview.open(id);
    else if(choice==='annotate')annotationEditor(scope,owner,id);
    else{const value=get(scope,owner);value.attachmentIds=value.attachmentIds.filter(v=>v!==id);await save(scope,owner);paint();}
  }catch(error){toast(error.message);}};
}
// For formats whose text is not extracted (PDF, DOCX…), the excerpt is typed or pasted.
function annotationEditor(scope,owner,resourceId){const dialog=document.createElement('dialog');dialog.className='workspace-confirm';dialog.innerHTML=`<h2>材料文本标记${infoTip('粘贴原文片段并填写可获得的位置；不代表文件已自动解析。\n也可以直接在文件预览中选中文字添加。',{label:'材料文本标记说明'})}</h2><textarea data-selected maxlength="8000" placeholder="原文片段"></textarea><input data-location placeholder="页码、行号或章节（可选）"><textarea data-comment maxlength="8000" placeholder="备注"></textarea><div class="saverow"><button class="btn primary" data-save>保存标记</button><button class="btn" data-close>取消</button></div>`;document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-save]').onclick=async()=>{const selectedText=dialog.querySelector('[data-selected]').value;if(!selectedText.trim())return;try{await add(scope,owner,'annotations',{id:crypto.randomUUID(),revision:0,resourceId,resourceTitle:titles.get(resourceId),selectedText,location:{description:dialog.querySelector('[data-location]').value},comment:dialog.querySelector('[data-comment]').value});dialog.close();}catch(error){toast(error.message);}};}
window.addEventListener('click',event=>{const button=event.target.closest('[data-research-edit]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();attachmentMenu(button);},true);

// ---- message selection -> mark -------------------------------------------------------
function speakerOf(message,surface){
  if(message.classList.contains('user'))return '你';
  if(surface)return SCOPE_LABEL[surface.dataset.scope]||'助手';
  const head=message.querySelector('.messagehead')?.cloneNode(true);head?.querySelectorAll('.avatar,small,time').forEach(n=>n.remove());
  return head?.textContent.trim()||'主专家';
}
window.addEventListener('mouseup',event=>{
  if(event.target.closest('[data-research-selection],dialog,.marks-popover'))return;
  const selection=window.getSelection();if(!selection||selection.isCollapsed||!selection.toString().trim())return;
  const node=selection.anchorNode?.parentElement?.closest('.message-text'),end=selection.focusNode?.parentElement?.closest('.message-text');if(!node||node!==end)return;
  const message=node.closest('[data-message-id],[data-assistant-message]');if(!message)return;
  const surface=node.closest('.assistant-surface');
  const sourceChatId=surface?window.ScienceScopeAssistants?.entry(surface.dataset.scope,surface.dataset.owner).chat?.id:V.chat;
  const targetMain=surface?.dataset.scope==='secretary'?surface.dataset.owner:V.chat;
  if(!sourceChatId)return;
  const selectedText=selection.toString(),range=selection.getRangeAt(0).cloneRange();
  const primary=surface?{scope:surface.dataset.scope,owner:surface.dataset.owner}:{scope:'main',owner:V.chat};
  const speaker=speakerOf(message,surface),sourceChatTitle=surface?SCOPE_LABEL[surface.dataset.scope]:activeThread()?.title||'';
  const quoteFor=(scope,owner)=>({id:crypto.randomUUID(),revision:0,sourceChatId,sourceMessageId:message.dataset.messageId||message.dataset.assistantMessage,selectedText,sourceLabel:speaker,
    // Name the source conversation only when the mark lands in a different one.
    ...(scope===primary.scope&&owner===primary.owner?{}:{sourceChatTitle})});
  const deliver=async(scope,comment)=>{
    const owner=scope==='global'?'global':scope===primary.scope?primary.owner:targetMain;
    if(scope!=='global'&&!window.ScienceScopeWorkspace.resolveThread(owner))throw new Error('请先在主窗口选择目标对话，再引用；不会自动改投其他任务。');
    await add(scope,owner,'messageQuotes',{...quoteFor(scope,owner),...(comment.trim()?{comment}:{})});
    if(scope===primary.scope)return;
    if(scope==='secretary'&&!V.surface&&!['secretary','compose'].includes(V.panel))openPanel('secretary');
    if(scope==='global'&&V.surface!=='assistant')await window.ScienceScopeWindows?.open({surface:'assistant'});
    toast(`已添加至${SCOPE_LABEL[scope]}。`);
  };
  selectionPopover(range,selectedText,{onAdd:comment=>deliver(primary.scope,comment),secondary:['main','secretary','global'].filter(scope=>scope!==primary.scope&&!(scope==='main'&&V.surface==='assistant')).map(scope=>({label:'引用至'+SCOPE_LABEL[scope],run:comment=>deliver(scope,comment)}))});
},true);

async function refresh(){for(const [scope,owner] of [['main',V.chat],...Array.from(document.querySelectorAll('.assistant-surface'),s=>[s.dataset.scope,s.dataset.owner])])if(owner){await load(scope,owner);paint();}}
// Opening a side panel (secretary) inserts a composer without a full render.
const baseOpenPanel=openPanel;openPanel=function(...args){const result=baseOpenPanel.apply(this,args);if(V.panel)void refresh().catch(error=>toast(error.message));return result;};
const after=window.ScienceScopeWorkspace.afterRender;window.ScienceScopeWorkspace.afterRender=(...args)=>{after?.(...args);void refresh().catch(error=>toast(error.message));};

window.ScienceScopeResearchInput={
  async restore(scope,owner,snapshot){await writes.get(key(scope,owner));const current=get(scope,owner);for(const kind of ['annotations','messageQuotes'])for(const item of snapshot[kind])if(!current[kind].some(old=>old.id===item.id))current[kind].push(item);current.attachmentIds=[...new Set([...current.attachmentIds,...snapshot.attachmentIds])];for(const ref of snapshot.contextRefs)if(!current.contextRefs.some(old=>old.resourceId===ref.resourceId))current.contextRefs.push(ref);await save(scope,owner);paint();},
  async legacyAnnotations(items,projectId){if(!items.length)return [];if(!projectId)throw new Error('批注没有项目原件身份，原批注保留。');const {resources}=await hostRequest('library?'+new URLSearchParams({projectId}));return items.map(a=>{const resource=resources.find(r=>r.metadata?.versionId===a.version);if(!resource)throw new Error('批注所指原件不存在，原批注保留，请核对版本。');return {id:a.id,revision:a.rev,resourceId:resource.id,versionId:a.version,selectedText:a.quote,comment:a.note||'',...(a.location?{location:a.location}:{})};});},
  async capture(scope,owner){await load(scope,owner);await writes.get(key(scope,owner));return structuredClone(get(scope,owner));},
  has(scope,owner){return Object.values(get(scope,owner)).some(v=>Array.isArray(v)&&v.length);},
  async accepted(scope,owner,snapshot){if(scope!=='main')return;const current=get(scope,owner);current.attachmentIds=current.attachmentIds.filter(id=>!snapshot.attachmentIds.includes(id));for(const field of ['annotations','messageQuotes'])current[field]=current[field].filter(item=>!snapshot[field].some(s=>s.id===item.id&&s.revision===item.revision));current.contextRefs=current.contextRefs.filter(r=>!snapshot.contextRefs.some(s=>s.resourceId===r.resourceId));await save(scope,owner);paint();},
  // Marks API used by the file preview.
  addMark:(scope,owner,field,value)=>add(scope,owner,field,value),
  marks:(scope,owner)=>structuredClone({messageQuotes:get(scope,owner).messageQuotes,annotations:get(scope,owner).annotations}),
  load:(scope,owner)=>load(scope,owner).then(()=>undefined),
  rememberTitle:(id,title)=>{if(id&&title)titles.set(id,title);},
  selectionPopover,findTextRange,setHighlight,flashRange,
  attachFiles,refresh,paint
};
void refresh();
