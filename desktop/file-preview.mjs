import {infoTip} from './info-tip.mjs';
import {hostRequest} from './host-client.mjs';
import {renderMarkdown} from './markdown.mjs';
import './research-input.mjs';

// Real right-side file preview (replaces the prototype's demo 'preview' panel).
// Shows the text the research-input compiler extracts for a library resource;
// selecting text there adds an annotation mark to the main composer's draft.
const state={resourceId:null,resources:[],listKey:null,listPromise:null,doc:null,docPromise:null,error:'',pendingVersion:null,lastVersion:S.selectedVersion,highlight:null};
const MARKDOWN_KINDS=['md','markdown'];
const research=()=>window.ScienceScopeResearchInput;
const projectOf=()=>activeThread()?.projectId||(S.projectId&&S.projectId!=='default'?S.projectId:null);

function docHTML(){
  if(state.error)return `<div class="file-preview-empty" role="alert">${esc(state.error)}</div>`;
  if(!state.resourceId)return `<div class="file-preview-empty">${state.listPromise?'正在读取资料…':'当前项目还没有可预览的资料。可在输入框添加附件，或在数据库导入材料。'}</div>`;
  const doc=state.doc;
  if(!doc||doc.id!==state.resourceId)return '<div class="file-preview-empty">正在读取…</div>';
  if(typeof doc.text!=='string')return `<div class="file-preview-empty"><p>此格式的文本尚未提取（${esc(doc.kind||'文件')}），暂不能在此选择文字。</p><p>可打开原件查看，或在输入框中点击该附件，手动添加文本标记。</p><button type="button" class="btn tiny" data-preview-open>打开原件</button></div>`;
  const body=MARKDOWN_KINDS.includes(String(doc.kind).toLowerCase())?`<div class="rendered-markdown">${renderMarkdown(doc.text)}</div>`:`<pre class="file-preview-plain">${esc(doc.text)}</pre>`;
  return `${doc.truncated?'<p class="hint file-preview-note">仅显示前 64000 字，与发送给模型的提取范围一致。</p>':''}<div class="docpaper file-preview-doc" data-preview-doc data-resource-id="${esc(doc.id)}">${body}</div>`;
}
function bodyHTML(){
  const options=state.resources.map(r=>`<option value="${esc(r.id)}" ${r.id===state.resourceId?'selected':''}>${esc(r.title)}</option>`).join('');
  return `<div class="file-preview-toolbar"><select data-preview-resource aria-label="选择要预览的资料" ${state.resources.length?'':'disabled'}>${options||'<option>暂无资料</option>'}</select><button type="button" class="btn tiny" data-preview-open ${state.resourceId?'':'disabled'}>打开原件</button></div><div class="file-preview-content">${docHTML()}</div>`;
}
const panelHTML=()=>`<aside class="rightpanel file-preview-panel"><div class="panel-resizer" data-v-resize></div><div class="panelhead between"><h2>文件预览与标记${infoTip('选中文字即可添加标记，可连续添加；标记随下一条消息一起发送。',{label:'标记说明'})}</h2>${vib('close','close-panel','关闭侧栏')}</div><div class="panelbody file-preview-body">${bodyHTML()}</div></aside>`;

const baseRightPanel=rightPanel;
rightPanel=function(type){
  if(type!=='preview')return baseRightPanel(type);
  // Prototype flyout actions select a workbench version; map it to its library resource.
  if(S.selectedVersion!==state.lastVersion){state.lastVersion=S.selectedVersion;state.pendingVersion=S.selectedVersion;}
  queueMicrotask(()=>void hydrate());
  return panelHTML();
};

function loadList(){
  const key=projectOf()||'*';
  if(state.listKey===key&&(state.listPromise||state.resources.length))return state.listPromise||Promise.resolve();
  state.listKey=key;
  const promise=hostRequest('library'+(key==='*'?'':'?'+new URLSearchParams({projectId:key}))).then(({resources})=>{
    if(state.listPromise!==promise)return;
    state.resources=resources;for(const r of resources)research()?.rememberTitle(r.id,r.title);
  }).catch(error=>{state.error=error.message;}).finally(()=>{if(state.listPromise===promise)state.listPromise=null;});
  state.listPromise=promise;return promise;
}
function loadDoc(id){
  if(state.doc?.id===id)return Promise.resolve();
  if(state.docPromise?.id===id)return state.docPromise;
  const promise=hostRequest('library/preview?'+new URLSearchParams({id})).then(doc=>{
    if(state.resourceId!==id)return;
    state.doc=doc;research()?.rememberTitle(doc.id,doc.title);
    if(!state.resources.some(r=>r.id===doc.id))state.resources=[{id:doc.id,title:doc.title,kind:doc.kind},...state.resources];
  }).catch(error=>{if(state.resourceId===id)state.error=error.message;}).finally(()=>{if(state.docPromise===promise)state.docPromise=null;});
  promise.id=id;state.docPromise=promise;return promise;
}
async function defaultResource(){
  if(state.pendingVersion){const r=state.resources.find(r=>r.metadata?.versionId===state.pendingVersion);state.pendingVersion=null;if(r)return r.id;}
  if(state.resourceId)return state.resourceId;
  const attached=V.chat?(await research()?.capture('main',V.chat).catch(()=>null))?.attachmentIds||[]:[];
  return attached[0]||state.resources[0]?.id||null;
}
function paintBody(){
  const body=document.querySelector('.file-preview-panel .file-preview-body');if(!body)return;
  const html=bodyHTML();if(body._html===html)return refreshMarks();
  const scroller=body,top=scroller.scrollTop,same=body.querySelector('[data-preview-doc]')?.dataset.resourceId===state.resourceId;
  body.innerHTML=html;body._html=html;if(same)scroller.scrollTop=top;
  refreshMarks();
}
async function hydrate(){
  if(!document.querySelector('.file-preview-panel'))return;
  paintBody();
  await loadList();
  state.resourceId=await defaultResource();
  if(state.resourceId){state.error='';paintBody();await loadDoc(state.resourceId);}
  paintBody();
  if(state.highlight&&state.doc?.id===state.resourceId){const needle=state.highlight;state.highlight=null;focusText(needle);}
}
function focusText(needle){
  const doc=document.querySelector('.file-preview-panel [data-preview-doc]'),api=research();if(!doc||!api)return false;
  const range=api.findTextRange(doc,needle);
  if(!range){toast('在当前预览文本中找不到这段原文（可能超出提取范围或文件已变更）。');return false;}
  const target=range.startContainer.parentElement;target?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  api.flashRange(range);return true;
}
// Persistent soft highlight for every current annotation on this resource.
function refreshMarks(){
  const api=research(),doc=document.querySelector('.file-preview-panel [data-preview-doc]');if(!api)return;
  if(!doc||!V.chat){api.setHighlight('ss-marks',[]);return;}
  const {annotations}=api.marks('main',V.chat);
  api.setHighlight('ss-marks',annotations.filter(a=>a.resourceId===doc.dataset.resourceId).map(a=>api.findTextRange(doc,a.selectedText)));
}

async function open(resourceId,{highlight}={}){
  if(V.surface){toast('请在主窗口中预览文件。');return;}
  state.resourceId=resourceId||state.resourceId;state.highlight=highlight||null;state.pendingVersion=null;state.lastVersion=S.selectedVersion;state.error='';
  if(V.panel!=='preview'||!document.querySelector('.file-preview-panel'))openPanel('preview');
  await hydrate();
}

window.addEventListener('change',event=>{
  if(!event.target.matches('[data-preview-resource]'))return;
  event.stopImmediatePropagation();state.resourceId=event.target.value;state.highlight=null;state.error='';void hydrate();
},true);
window.addEventListener('click',event=>{
  const button=event.target.closest('.file-preview-panel [data-preview-open]');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  hostRequest('library/open',{id:state.resourceId}).catch(error=>toast(error.message));
},true);

// Paragraph (rendered markdown) or line (plain text) of the selection start.
function locationOf(doc,range){
  const pre=doc.querySelector('.file-preview-plain');
  if(pre){const before=document.createRange();before.setStart(pre,0);before.setEnd(range.startContainer,range.startOffset);return {description:`第 ${before.toString().split('\n').length} 行`};}
  const selector='p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,tr';
  const start=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
  const block=start?.closest(selector);const index=block?[...doc.querySelectorAll(selector)].indexOf(block):-1;
  return {description:index>=0?`第 ${index+1} 段`:'选中位置'};
}
window.addEventListener('mouseup',event=>{
  if(event.target.closest('[data-research-selection],dialog,.marks-popover'))return;
  const selection=getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount||!selection.toString().trim())return;
  const range=selection.getRangeAt(0),doc=(range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement)?.closest('[data-preview-doc]');
  if(!doc||!doc.closest('.file-preview-panel'))return;
  const api=research(),selectedText=selection.toString(),resourceId=doc.dataset.resourceId,owner=V.chat;
  if(!api)return;
  if(!owner){toast('请先打开一个对话，再添加标记。');return;}
  const location=locationOf(doc,range),resourceTitle=state.doc?.id===resourceId?state.doc.title:undefined;
  api.selectionPopover(range.cloneRange(),selectedText,{onAdd:async comment=>{
    if(!window.ScienceScopeWorkspace.resolveThread(owner))throw new Error('请先在主窗口选择目标对话，再添加标记。');
    await api.addMark('main',owner,'annotations',{id:crypto.randomUUID(),revision:0,resourceId,resourceTitle,selectedText,location,...(comment.trim()?{comment}:{})});
  }});
},true);

window.ScienceScopePreview=Object.freeze({open,refreshMarks,current:()=>state.resourceId});
