import {hostRequest} from './host-client.mjs';
const drafts=new Map(),writes=new Map(),loading=new Map();
const channel=new BroadcastChannel('sciencescope-research-input');
window.addEventListener('pointerdown',event=>{if(!event.target.closest('[data-research-selection]'))document.querySelector('[data-research-selection]')?.remove();},true);
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector('[data-research-selection]')){document.querySelector('[data-research-selection]').remove();event.preventDefault();event.stopImmediatePropagation();}},true);
const baseMessage=messageHTML;
messageHTML=function(message){const html=baseMessage(message),value=message.researchInput;if(!value||![value.attachmentIds,value.messageQuotes,value.annotations,value.contextRefs].some(items=>items?.length))return html;const details=`<details class="research-receipt"><summary>已发送研究材料与引用</summary><pre style="white-space:pre-wrap;max-height:280px;overflow:auto">${esc(JSON.stringify(value,null,2))}</pre></details>`;return html.replace('<div class="msg-actions">',details+'<div class="msg-actions">');};
const empty=()=>({attachmentIds:[],messageQuotes:[],annotations:[],contextRefs:[]});
const key=(scope,owner)=>JSON.stringify([scope,owner]);
const get=(scope,owner)=>drafts.get(key(scope,owner))||empty();
async function load(scope,owner){const id=key(scope,owner);if(drafts.has(id))return get(scope,owner);if(!loading.has(id))loading.set(id,hostRequest('research-input/draft?'+new URLSearchParams({scope,ownerId:owner})).then(value=>{drafts.set(id,value);return value;}).finally(()=>loading.delete(id)));return loading.get(id);}
function save(scope,owner){const id=key(scope,owner),snapshot=structuredClone(get(scope,owner));const work=(writes.get(id)||Promise.resolve()).catch(()=>{}).then(()=>hostRequest('research-input/draft',{scope,ownerId:owner,snapshot})).then(value=>{channel.postMessage({scope,owner});return value;});writes.set(id,work);return work;}
channel.onmessage=async({data})=>{try{await writes.get(key(data.scope,data.owner));const value=await hostRequest('research-input/draft?'+new URLSearchParams({scope:data.scope,ownerId:data.owner}));drafts.set(key(data.scope,data.owner),value);paint();}catch(error){toast(error.message);}};
function paint(){
  const positions=[...document.querySelectorAll('.messages,.assistant-messages')].map(element=>[element,element.scrollTop]);
  for(const composer of document.querySelectorAll('[data-composer="main"],.assistant-composer')){
    const surface=composer.closest('.assistant-surface'),scope=surface?.dataset.scope||'main',owner=surface?.dataset.owner||V.chat;if(!owner)continue;
    let box=composer.querySelector('.research-input-chips');if(!box){box=document.createElement('div');box.className='research-input-chips attachmentbar';composer.prepend(box);}
    const value=get(scope,owner),items=[...value.attachmentIds.map(id=>({kind:'attachmentIds',id,label:value.labels?.[id]||'材料 '+id.slice(0,8)})),...value.messageQuotes.map(q=>({kind:'messageQuotes',id:q.id,label:'引用：'+q.selectedText.slice(0,24)})),...value.annotations.map(a=>({kind:'annotations',id:a.id,label:'批注：'+a.selectedText.slice(0,24)}))];
    const html=items.map(item=>`<button class="ref-chip" data-research-edit="${item.kind}" data-id="${esc(item.id)}" data-scope="${scope}" data-owner="${esc(owner)}">${esc(item.label)}</button>`).join('');if(box.innerHTML!==html)box.innerHTML=html;
    box.style.display=items.length?'':'none';
  }
  for(const [element,top]of positions)element.scrollTop=top;
}
async function refresh(){for(const [scope,owner] of [['main',V.chat],...Array.from(document.querySelectorAll('.assistant-surface'),s=>[s.dataset.scope,s.dataset.owner])])if(owner){await load(scope,owner);paint();}}
const after=window.ScienceScopeWorkspace.afterRender;window.ScienceScopeWorkspace.afterRender=(...args)=>{after?.(...args);void refresh().catch(error=>toast(error.message));};
async function add(scope,owner,field,value){await load(scope,owner);get(scope,owner)[field].push(value);await save(scope,owner);paint();}
async function attachFiles(files,scope='main',owner=V.chat){for(const file of files){await load(scope,owner);if(get(scope,owner).attachmentIds.length>=8)throw new Error('每条消息最多附加 8 个材料。');if(file.size>20*1024*1024)throw new Error('文件上限 20 MiB。');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));const resource=await hostRequest('library/import',{name:file.name,base64:btoa(binary),projectId:activeThread()?.projectId||null});get(scope,owner).labels??={};get(scope,owner).labels[resource.id]=resource.title;await add(scope,owner,'attachmentIds',resource.id);}}
vAttach=async(files,scope='main')=>{try{if(scope!=='main')throw new Error('请使用对应助手输入框的附件按钮。');await attachFiles(files,scope,V.chat);}catch(error){toast(error.message);}};
function editItem(scope,owner,kind,id){const value=get(scope,owner),item=value[kind].find(v=>typeof v==='string'?v===id:v.id===id);if(!item)return;
  const dialog=document.createElement('dialog');dialog.className='workspace-confirm';dialog.innerHTML=`<h2>${kind==='attachmentIds'?'研究材料':'引用与批注'}</h2>${kind==='attachmentIds'?'<p>原件已保存，移除附件不会删除文件。</p>':`<blockquote style="white-space:pre-wrap;max-height:220px;overflow:auto">${esc(item.selectedText)}</blockquote><textarea data-comment maxlength="8000" placeholder="可选批注">${esc(item.comment||'')}</textarea>`}<div class="saverow">${kind==='attachmentIds'?'<button class="btn" data-annotate>添加文本批注</button>':'<button class="btn primary" data-save>保存批注</button>'}<button class="btn" data-remove>移除此引用</button><button class="btn" data-close>关闭</button></div>`;document.body.append(dialog);dialog.showModal();
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
  dialog.querySelector('[data-remove]').onclick=async()=>{value[kind]=value[kind].filter(v=>v!==item);await save(scope,owner);dialog.close();paint();};
  if(kind!=='attachmentIds')dialog.querySelector('[data-save]').onclick=async()=>{item.comment=dialog.querySelector('textarea').value;item.revision=(item.revision||0)+1;await save(scope,owner);dialog.close();paint();};
  else dialog.querySelector('[data-annotate]').onclick=()=>{dialog.close();annotationEditor(scope,owner,id);};
}
function annotationEditor(scope,owner,resourceId){const dialog=document.createElement('dialog');dialog.className='workspace-confirm';dialog.innerHTML='<h2>材料文本批注</h2><p>粘贴原文片段并填写可获得的位置；不代表文件已自动解析。</p><textarea data-selected maxlength="8000" placeholder="原文片段"></textarea><input data-location placeholder="页码、行号或章节（可选）"><textarea data-comment maxlength="8000" placeholder="批注"></textarea><div class="saverow"><button class="btn primary" data-save>保存批注</button><button class="btn" data-close>取消</button></div>';document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-save]').onclick=async()=>{const selectedText=dialog.querySelector('[data-selected]').value;if(!selectedText.trim())return;await add(scope,owner,'annotations',{id:crypto.randomUUID(),revision:0,resourceId,selectedText,location:{description:dialog.querySelector('[data-location]').value},comment:dialog.querySelector('[data-comment]').value});dialog.close();};}
window.addEventListener('click',event=>{const button=event.target.closest('[data-research-edit]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();editItem(button.dataset.scope,button.dataset.owner,button.dataset.researchEdit,button.dataset.id);},true);
window.addEventListener('mouseup',event=>{
  if(event.target.closest('[data-research-selection],dialog'))return;
  const selection=window.getSelection();if(!selection||selection.isCollapsed||!selection.toString().trim())return;
  const node=selection.anchorNode?.parentElement?.closest('.message-text'),end=selection.focusNode?.parentElement?.closest('.message-text');if(!node||node!==end)return;
  const message=node.closest('[data-message-id],[data-assistant-message]');if(!message)return;
  const surface=node.closest('.assistant-surface');
  const sourceChatId=surface?window.ScienceScopeAssistants?.entry(surface.dataset.scope,surface.dataset.owner).chat?.id:V.chat;
  const targetMain=surface?.dataset.scope==='secretary'?surface.dataset.owner:V.chat;
  if(!sourceChatId)return;
  const selectedText=selection.toString();if(selectedText.length>8000)return;
  const quote={id:crypto.randomUUID(),revision:0,sourceChatId,sourceMessageId:message.dataset.messageId||message.dataset.assistantMessage,selectedText};
  document.querySelector('[data-research-selection]')?.remove();const popup=document.createElement('div');popup.dataset.researchSelection='';popup.className='contextmenu';popup.style.left=Math.min(event.clientX,innerWidth-240)+'px';popup.style.top=Math.min(event.clientY+8,innerHeight-210)+'px';
  popup.innerHTML='<button data-target="main">引用至主对话</button><button data-target="secretary">引用至任务秘书</button><button data-target="global">引用至全局助手</button><button data-copy>复制</button><button data-dismiss>取消</button>';document.body.append(popup);
  popup.onclick=async e=>{const button=e.target.closest('button');if(!button)return;popup.remove();if(button.hasAttribute('data-copy')){await navigator.clipboard.writeText(selectedText);return;}const scope=button.dataset.target;if(!scope)return;const owner=scope==='global'?'global':targetMain;try{if(scope!=='global'&&!window.ScienceScopeWorkspace.resolveThread(owner))throw new Error('请先在主窗口选择目标对话，再引用；不会自动改投其他任务。');await add(scope,owner,'messageQuotes',quote);if(scope==='secretary')openPanel('secretary');if(scope==='global')await window.ScienceScopeWindows.open({surface:'assistant'});editItem(scope,owner,'messageQuotes',quote.id);}catch(error){toast(error.message);}};
},true);
window.ScienceScopeResearchInput={
  async restore(scope,owner,snapshot){await writes.get(key(scope,owner));const current=get(scope,owner);for(const kind of ['annotations','messageQuotes'])for(const item of snapshot[kind])if(!current[kind].some(old=>old.id===item.id))current[kind].push(item);current.attachmentIds=[...new Set([...current.attachmentIds,...snapshot.attachmentIds])];for(const ref of snapshot.contextRefs)if(!current.contextRefs.some(old=>old.resourceId===ref.resourceId))current.contextRefs.push(ref);await save(scope,owner);paint();},
  async legacyAnnotations(items,projectId){if(!items.length)return [];if(!projectId)throw new Error('批注没有项目原件身份，原批注保留。');const {resources}=await hostRequest('library?'+new URLSearchParams({projectId}));return items.map(a=>{const resource=resources.find(r=>r.metadata?.versionId===a.version);if(!resource)throw new Error('批注所指原件不存在，原批注保留，请核对版本。');return {id:a.id,revision:a.rev,resourceId:resource.id,versionId:a.version,selectedText:a.quote,comment:a.note||'',...(a.location?{location:a.location}:{})};});},
  async capture(scope,owner){await load(scope,owner);await writes.get(key(scope,owner));return structuredClone(get(scope,owner));},
  has(scope,owner){return Object.values(get(scope,owner)).some(v=>v.length);},
  async accepted(scope,owner,snapshot){if(scope!=='main')return;const current=get(scope,owner);current.attachmentIds=current.attachmentIds.filter(id=>!snapshot.attachmentIds.includes(id));for(const field of ['annotations','messageQuotes'])current[field]=current[field].filter(item=>!snapshot[field].some(s=>s.id===item.id&&s.revision===item.revision));current.contextRefs=current.contextRefs.filter(r=>!snapshot.contextRefs.some(s=>s.resourceId===r.resourceId));await save(scope,owner);paint();},
  attachFiles,refresh,paint
};
void refresh();
