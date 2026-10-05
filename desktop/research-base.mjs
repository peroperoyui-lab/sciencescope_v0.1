import './library.mjs';
import './research-input.mjs';
import './file-preview.mjs';
import {hostRequest} from './host-client.mjs';
import {renderMarkdown} from './markdown.mjs';
import {infoTip} from './info-tip.mjs';

// Presentation only: sources, revisions and decisions stay in the Research Base.
const tabs = {sources:'文献与资料',knowledge:'知识',model:'模型与公式',claim:'主张与证据',memory:'记忆',inbox:'记忆收件箱',brief:'项目简报'};
const subtypes = {knowledge:['finding','definition','method','fact','dataset-note','other'],model:['theory','formula','algorithm','statistical-model','protocol'],claim:['hypothesis','claim','conclusion'],memory:['goal','decision','convention','preference','open-question','lesson','episode','profile']};
const names = {finding:'研究发现',definition:'定义',method:'方法',fact:'事实','dataset-note':'数据说明',other:'其他',theory:'理论',formula:'公式',algorithm:'算法','statistical-model':'统计模型',protocol:'研究方案',hypothesis:'假设',claim:'主张',conclusion:'结论',goal:'目标',decision:'决定',convention:'约定',preference:'偏好','open-question':'未决问题',lesson:'经验',episode:'阶段摘要',profile:'背景',active:'有效',archived:'已归档',superseded:'已取代',proposed:'待确认',rejected:'已拒绝',unread:'未读',reading:'阅读中',read:'已读',none:'未解析',queued:'等待解析',parsed:'已解析',partial:'部分解析',failed:'解析失败',unsupported:'不支持',paper:'论文',preprint:'预印本',book:'书籍',chapter:'章节',thesis:'学位论文',report:'报告',webpage:'网页',dataset:'数据集',software:'软件',file:'文件',note:'笔记',create:'新建',update:'修改',supersede:'取代',archive:'归档',link:'关联',supported:'有证据支持',contested:'有争议',refuted:'已反驳',uncertain:'不确定',retracted:'已撤回'};
const state={tab:'sources',key:'',ticket:0,loading:false,error:'',sources:[],items:[],proposals:[],brief:null,hits:null,query:'',offset:0,total:0,kind:'',readStatus:'',tag:'',sort:'addedAt',direction:'desc',subtype:'',status:'active',pinned:'',selected:new Set(),editingProposal:null};
let badgeCount=0,badgeRequest=null,lastBadgeKey='',lastBadgeAt=0;
const button=(label,action,id='',extra='')=>`<button type="button" class="btn tiny" data-rb-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
const option=(value,label,current)=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(label)}</option>`;
const label=value=>names[value]||value||'—';
const project=()=>route==='library'?null:(S.projectId&&S.projectId!=='default'?S.projectId:null);
const query=values=>new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>[k,String(v)])).toString();
const scopeQuery=()=>({projectId:project()||''});
const active=()=>['database','library'].includes(route);
const field=(name,title,value='',textarea=false)=>`<label class="field">${title}${textarea?`<textarea name="${name}" rows="5">${esc(value)}</textarea>`:`<input name="${name}" value="${esc(value)}">`}</label>`;
const select=(name,title,values,current)=>`<label class="field">${title}<select name="${name}">${values.map(v=>option(v,label(v),current)).join('')}</select></label>`;
const data=value=>`<span data-i18n-skip>${esc(value??'—')}</span>`;
function repaint(){if(active())render();}

async function reload(){
  const ticket=++state.ticket,scope=scopeQuery();state.loading=true;state.error='';
  try{
    const tasks=[hostRequest('research/proposals?'+query({...scope,status:'pending'}))];
    if(state.query.trim())tasks.push(hostRequest('research/search?'+query({...scope,q:state.query,k:50})));
    else if(state.tab==='sources')tasks.push(hostRequest('research/sources?'+query({...scope,kind:state.kind||undefined,readStatus:state.readStatus||undefined,tag:state.tag||undefined,sort:state.sort,direction:state.direction,limit:50,offset:state.offset})));
    else if(state.tab==='brief')tasks.push(hostRequest('research/brief?'+query(scope)));
    else if(state.tab==='inbox')tasks.push(Promise.resolve({}));
    else tasks.push(hostRequest('research/items?'+query({...scope,type:state.tab,subtype:state.subtype||undefined,status:state.status,pinned:state.pinned||undefined,limit:50,offset:state.offset})));
    const [inbox,result]=await Promise.all(tasks);if(ticket!==state.ticket)return;
    state.proposals=inbox.proposals;badgeCount=inbox.proposals.length;state.hits=state.query.trim()?result.hits:null;
    if(!state.hits){if(state.tab==='sources'){state.sources=result.sources;state.total=result.total??state.offset+result.sources.length;}else if(state.tab==='brief')state.brief=result;else if(state.tab!=='inbox')state.items=result.items;}
    updateBadge();
  }catch(error){if(ticket===state.ticket)state.error=error.message;}
  finally{if(ticket===state.ticket){state.loading=false;repaint();}}
}
function updateBadge(){
  const nav=document.querySelector('.sidebar [data-route="database"]');if(!nav)return;
  let badge=nav.querySelector('[data-rb-inbox-count]');if(!badge){badge=document.createElement('span');badge.dataset.rbInboxCount='';badge.className='badge';nav.append(badge);}
  badge.textContent=String(badgeCount);badge.hidden=!badgeCount;
}
async function refreshInbox(force=false){
  const key=project()||'';if(badgeRequest||(!force&&key===lastBadgeKey&&Date.now()-lastBadgeAt<10000))return;
  lastBadgeKey=key;lastBadgeAt=Date.now();badgeRequest=hostRequest('research/proposals?'+query({projectId:key,status:'pending'})).then(({proposals})=>{if(key===(project()||'')){badgeCount=proposals.length;updateBadge();}}).catch(()=>{}).finally(()=>{badgeRequest=null;});await badgeRequest;
}
function filters(){
  if(state.hits)return '';
  if(state.tab==='sources')return `<div class="rb-filters"><select data-rb-filter="kind" aria-label="类型">${option('','全部类型',state.kind)}${['paper','preprint','book','chapter','thesis','report','webpage','dataset','software','file','note'].map(v=>option(v,label(v),state.kind)).join('')}</select><select data-rb-filter="readStatus" aria-label="阅读状态">${option('','全部阅读状态',state.readStatus)}${['unread','reading','read'].map(v=>option(v,label(v),state.readStatus)).join('')}</select><input data-rb-filter="tag" value="${esc(state.tag)}" placeholder="按标签筛选"><select data-rb-filter="sort" aria-label="排序">${[['addedAt','导入时间'],['title','标题'],['year','年份']].map(([v,t])=>option(v,t,state.sort)).join('')}</select><select data-rb-filter="direction" aria-label="排序方向">${option('desc','降序',state.direction)}${option('asc','升序',state.direction)}</select></div>`;
  if(!subtypes[state.tab])return '';
  return `<div class="rb-filters"><select data-rb-filter="subtype" aria-label="子类型">${option('','全部子类型',state.subtype)}${subtypes[state.tab].map(v=>option(v,label(v),state.subtype)).join('')}</select><select data-rb-filter="status" aria-label="状态">${['active','archived','superseded','proposed','rejected'].map(v=>option(v,label(v),state.status)).join('')}</select><select data-rb-filter="pinned" aria-label="置顶">${option('','全部条目',state.pinned)}${option('true','仅置顶',state.pinned)}${option('false','未置顶',state.pinned)}</select></div>`;
}
function pages(length){const more=state.tab==='sources'?state.offset+length<state.total:length===50;return `<div class="rb-pagination">${button('上一页','prev','',state.offset===0?'disabled':'')}<span>${length?state.offset+1:0}–${state.offset+length}</span>${button('下一页','next','',more?'':'disabled')}</div>`;}
function sourceRows(){return `<div class="rb-table-scroll"><table class="table"><thead><tr>${['标签','标题','作者','年份','期刊或来源','类型','解析状态','阅读状态','标签','操作'].map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${state.sources.map(s=>`<tr data-rb-source="${esc(s.id)}"><td>${data(s.label)}</td><td>${data(s.title)}</td><td>${data(s.authors.map(a=>a.literal||[a.given,a.family].filter(Boolean).join(' ')).join(', '))}</td><td>${data(s.year)}</td><td>${data(s.venue)}</td><td>${label(s.kind)}</td><td>${label(s.contentStatus)}${s.parseError?infoTip(s.parseError):''}</td><td>${label(s.readStatus)}</td><td>${data(s.tags.join(', '))}</td><td><div class="rb-row-actions">${s.resourceId?button('预览','preview',s.id)+button('打开原件','open',s.id):''}${button('详情','source-detail',s.id)}${button('编辑元数据','edit-source',s.id)}${s.resourceId?button('重新解析','reparse',s.id):''}</div></td></tr>`).join('')}</tbody></table></div>${pages(state.sources.length)}`;}
function payloadHTML(item){
  const p=item.payload||{};
  if(item.type==='claim')return `<span class="badge">${label(p.claimStatus||'hypothesis')}</span> <span>${item.evidenceCount??0} <span>条证据</span></span>`;
  if(item.type!=='model')return '';
  return `${p.latex?`<div class="rendered-markdown">${renderMarkdown('$$\n'+p.latex+'\n$$')}</div>`:''}${p.variables?.length?`<table class="table"><thead><tr><th>符号</th><th>含义</th><th>单位</th></tr></thead><tbody>${p.variables.map(v=>`<tr><td>${data(v.symbol)}</td><td>${data(v.meaning)}</td><td>${data(v.unit)}</td></tr>`).join('')}</tbody></table>`:''}${p.assumptions?.length?`<h4>假设</h4><ul data-i18n-skip>${p.assumptions.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`:''}${p.steps?.length?`<h4>步骤</h4><ol data-i18n-skip>${p.steps.map(v=>`<li>${esc(v)}</li>`).join('')}</ol>`:''}`;
}
function card(item){return `<article class="card rb-card" data-rb-item="${esc(item.id)}"><div class="between"><h3>${data(item.title)}</h3><span class="badge">${label(item.status)}</span></div><small>${label(item.subtype)} · ${data('r'+item.revision)}</small><div class="rendered-markdown" data-i18n-skip>${renderMarkdown(item.body)}</div>${payloadHTML(item)}${item.supersededBy?`<div>${button('查看取代记录','detail',item.supersededBy)}</div>`:''}<div class="rb-row-actions">${button('编辑','edit',item.id)}${button(item.pinned?'取消置顶':'置顶','pin',item.id)}${item.status==='active'?button('归档','archive',item.id)+button('取代','supersede',item.id):''}${button('修订历史','history',item.id)}</div></article>`;}
function itemCards(){
  const rows=state.items;
  const html=state.tab==='memory'?subtypes.memory.map(type=>{const group=rows.filter(i=>i.subtype===type);return group.length?`<section><h3>${label(type)}</h3><div class="rb-cards">${group.map(card).join('')}</div></section>`:'';}).join(''):`<div class="rb-cards">${rows.map(card).join('')}</div>`;
  return (state.status==='superseded'?`<details><summary>已取代的记录</summary>${html}</details>`:html)+pages(rows.length);
}
function proposalCard(p){
  const item=p.payload?.item||{},editing=state.editingProposal===p.id;
  const external=item.payload?.originTrust==='external';
  const trust=external?`<span class="badge" data-rb-external>外部来源</span>${infoTip('这条候选包含网页或文献内容。来源标记会保留，接受不会将外部内容变为用户指令。')}`:'';
  const role=p.origin?.role==='consolidator'?'记忆整理':data(p.origin?.role||'');
  return `<article class="card rb-card" data-rb-proposal="${esc(p.id)}"><div class="between"><label><input type="checkbox" data-rb-select="${esc(p.id)}" ${state.selected.has(p.id)?'checked':''}> ${label(p.op)}</label><span class="badge">待确认</span>${trust}</div><h3>${data(item.title||p.targetId||p.op)}</h3><div class="rendered-markdown" data-i18n-skip>${renderMarkdown(item.body||'')}</div><p>${data(p.rationale||'')}</p><div class="rb-provenance">${role} ${data(p.origin?.expertId||'')}${p.origin?.chatId&&(p.origin?.messageId||p.payload?.evidence?.[0]?.ref?.type==='message')?button('定位到消息','origin',p.id):''}</div>${(p.payload?.evidence||[]).map(e=>`<blockquote data-i18n-skip>${esc(e.quote||'')} <small>${esc(e.ref?.id||e.cite||'')}</small></blockquote>`).join('')}${editing?`<form data-rb-proposal-form="${esc(p.id)}">${field('title','标题',item.title||'')}${field('body','内容',item.body||'',true)}<p role="alert" data-rb-form-error></p><button class="btn tiny primary" type="submit" data-rb-action="save-proposal" data-id="${esc(p.id)}">修改后接受</button>${button('取消','cancel-proposal',p.id)}</form>`:`<div class="rb-row-actions">${button('接受','accept',p.id)}${['create','update','supersede'].includes(p.op)?button('修改后接受','edit-proposal',p.id):''}${button('拒绝','reject',p.id)}</div>`}</article>`;
}
function inboxHTML(){return `<div class="rb-row-actions">${button('接受所选','bulk-accept','',!state.selected.size?'disabled':'')}${button('拒绝所选','bulk-reject','',!state.selected.size?'disabled':'')}</div><div class="rb-cards">${state.proposals.map(proposalCard).join('')}</div>`;}
function briefHTML(){return `<div class="between"><span>项目简报</span>${infoTip('这是主专家在当前项目中实际收到的确认记忆简报。内容预算为 3500 字符；固定规则说明与标题另计。')}</div><pre class="rb-brief" data-rb-brief-text data-i18n-skip>${esc(state.brief?.text||'')}</pre><div class="rb-row-actions">${(state.brief?.refs||[]).map(r=>button('编辑条目 '+data('[@'+r.id.replace(/^itm_/,'').slice(0,8)+']'),'edit',r.id)).join('')}</div>`;}
function highlight(text){const terms=state.query.trim().split(/\s+/u).filter(Boolean).sort((a,b)=>b.length-a.length);if(!terms.length)return esc(text);const escaped=terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');return String(text).split(new RegExp('('+escaped+')','giu')).map((part,i)=>i%2?`<mark>${esc(part)}</mark>`:esc(part)).join('');}
function searchHTML(){return `<div data-rb-search-results>${['item','source','chunk'].map(type=>{const hits=state.hits.filter(h=>h.ref.type===type);return hits.length?`<section><h3>${{item:'条目',source:'文献与资料',chunk:'段落'}[type]}</h3>${hits.map(h=>`<article class="card rb-card"><button class="btn tiny" data-rb-action="hit" data-type="${type}" data-id="${esc(h.ref.id)}" data-cite="${esc(h.cite)}">${data(h.title)}</button><p data-i18n-skip>${highlight(h.snippet)}</p>${data(h.cite)}</article>`).join('')}</section>`:'';}).join('')}</div>`;}
const previous=databasePage;
databasePage=function(){
  if(route==='sources')return previous();
  const content=state.hits?searchHTML():state.tab==='sources'?sourceRows():state.tab==='inbox'?inboxHTML():state.tab==='brief'?briefHTML():itemCards();
  const empty=state.hits?state.hits.length:state.tab==='sources'?state.sources.length:state.tab==='inbox'?state.proposals.length:state.tab==='brief'?1:state.items.length;
  return `<div class="content research-base"><div class="between"><h1>研究资料库 ${infoTip('原件、知识与确认记忆保存在同一个资料库。模型提议只有经你接受才会生效。')}</h1><div class="row"><button class="btn tiny" data-route="${route==='database'?'library':'database'}">${route==='database'?'我的资料':'当前项目材料'}</button>${button('导入材料','import')}${subtypes[state.tab]?button('新建条目','new'):''}</div></div><div class="tabs rb-tabs">${Object.entries(tabs).map(([key,title])=>`<button class="tab ${state.tab===key?'active':''}" data-rb-tab="${key}">${title}${key==='inbox'&&state.proposals.length?` <span class="badge">${state.proposals.length}</span>`:''}</button>`).join('')}</div><form id="rb-search" class="rb-search"><input id="rb-query" value="${esc(state.query)}" placeholder="统一检索资料与记忆" aria-label="统一检索资料与记忆"><button class="btn tiny" type="submit">搜索</button>${state.query?button('清除搜索','clear-search'):''}${button('刷新','refresh')}</form>${filters()}${state.error?`<p role="alert">${esc(state.error)}</p>`:''}${state.loading?'<p role="status">正在读取…</p>':''}${content}${!empty&&!state.loading?'<div class="empty">暂无记录</div>':''}</div>`;
};

async function openItem(id){const detail=await hostRequest('research/item?'+query({id}));modal('条目详情',`<div class="rb-dialog">${card(detail.item)}</div>`);}
async function editItem(id,replace=false){
  const item=id?(await hostRequest('research/item?'+query({id}))).item:{type:subtypes[state.tab]?state.tab:'memory',subtype:subtypes[state.tab]?.[0]||'decision',title:'',body:'',payload:{},scope:project()?'project':'personal',visibility:'shared'};
  modal(replace?'取代条目':id?'编辑条目':'新建条目',`<form id="rb-item-form" class="rb-dialog" data-id="${esc(id||'')}" data-replace="${replace}" data-revision="${item.revision||0}" data-type="${item.type}">${field('title','标题',item.title)}${select('subtype','子类型',subtypes[item.type]||['note'],item.subtype)}${field('body','内容',item.body,true)}${item.type==='model'||item.type==='claim'?field('payload','结构化内容（JSON）',JSON.stringify(item.payload,null,2),true):''}<label class="field">可见性<select name="visibility">${option('shared','共享',item.visibility)}${option('private','仅自己',item.visibility)}</select></label><p role="alert" data-rb-form-error></p><button class="btn primary" type="submit">${replace?'保存新版本':'保存'}</button></form>`);
}
async function editSource(id){const {source:s}=await hostRequest('research/source?'+query({id}));modal('编辑元数据',`<form id="rb-source-form" class="rb-dialog" data-id="${esc(id)}">${field('title','标题',s.title)}${select('kind','类型',['paper','preprint','book','chapter','thesis','report','webpage','dataset','software','file','note'],s.kind)}${field('authors','作者',s.authors.map(a=>a.literal||[a.given,a.family].filter(Boolean).join(' ')).join('; '))}${field('year','年份',s.year??'')}${field('venue','期刊或来源',s.venue??'')}${field('tags','标签',s.tags.join(', '))}${select('readStatus','阅读状态',['unread','reading','read'],s.readStatus)}<p role="alert" data-rb-form-error></p><button class="btn primary" type="submit">保存</button></form>`);}
async function history(id){const {revisions}=await hostRequest('research/item?'+query({id}));modal('修订历史',`<div class="rb-dialog" data-rb-history>${revisions.map(r=>`<article class="card"><strong>${data('r'+r.revision)}</strong><small>${data(r.changedAt)}</small><div data-i18n-skip>${renderMarkdown(r.snapshot?.body||'')}</div><pre data-i18n-skip>${esc(JSON.stringify(r.snapshot,null,2))}</pre></article>`).join('')}</div>`);}
async function importFiles(){const input=document.createElement('input');input.type='file';input.multiple=true;const projectId=project();input.onchange=async()=>{try{for(const file of input.files){if(file.size>14*1024*1024)throw new Error('单次导入文件上限 14 MB。');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));const result=await hostRequest('library/import',{name:file.name,base64:btoa(binary),projectId});await hostRequest('research/sources/ingest',{resourceId:result.id,wait:true});}await reload();}catch(e){state.error=e.message;repaint();}};input.click();}
async function openTab(tab){if(!tabs[tab])return;state.tab=tab;state.query='';state.hits=null;state.offset=0;state.subtype='';state.selected.clear();state.editingProposal=null;state.key=(route==='library'?'library':'database')+':'+project();if(!active())go('database');await reload();}

window.addEventListener('submit',async event=>{
  const form=event.target;if(!['rb-search','rb-item-form','rb-source-form'].includes(form.id)&&!form.matches('[data-rb-proposal-form]'))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(form.id==='rb-search'){state.query=form.querySelector('#rb-query').value;state.offset=0;await reload();return;}
  const values=Object.fromEntries(new FormData(form));const submit=form.querySelector('[type="submit"]');submit.disabled=true;
  try{
    if(form.id==='rb-item-form'){
      const patch={title:values.title,body:values.body,subtype:values.subtype,visibility:values.visibility,...(values.payload?{payload:JSON.parse(values.payload)}:{})};
      if(form.dataset.id&&form.dataset.replace!=='true')await hostRequest('research/items/update',{id:form.dataset.id,patch:{...patch,expectedRevision:Number(form.dataset.revision)}});
      else if(form.dataset.replace==='true'){const {item:old}=await hostRequest('research/item?'+query({id:form.dataset.id}));await hostRequest('research/items/supersede',{id:form.dataset.id,item:{payload:old.payload,...patch},expectedRevision:Number(form.dataset.revision)});}
      else await hostRequest('research/items',{item:{...patch,type:form.dataset.type,projectId:project(),scope:project()?'project':'personal'}});
    }else if(form.id==='rb-source-form')await hostRequest('research/sources/update',{id:form.dataset.id,patch:{title:values.title,kind:values.kind,authors:values.authors.split(';').map(s=>s.trim()).filter(Boolean),year:values.year?Number(values.year):null,venue:values.venue||null,tags:values.tags.split(',').map(s=>s.trim()).filter(Boolean),readStatus:values.readStatus}});
    else{await hostRequest('research/proposals/decide',{id:form.dataset.rbProposalForm,accept:true,edits:{item:{title:values.title,body:values.body}}});state.editingProposal=null;}
    if(form.id)document.querySelector('#modal')?.remove();await reload();
  }catch(error){form.querySelector('[data-rb-form-error]').textContent=error.status===409?error.message+' 请刷新后重试。':error.message;}finally{submit.disabled=false;}
},true);
window.addEventListener('change',event=>{const input=event.target;if(input.dataset.rbFilter){state[input.dataset.rbFilter]=input.value;state.offset=0;void reload();}if(input.dataset.rbSelect){if(input.checked)state.selected.add(input.dataset.rbSelect);else state.selected.delete(input.dataset.rbSelect);for(const b of document.querySelectorAll('[data-rb-action^="bulk-"]'))b.disabled=!state.selected.size;}},true);
window.addEventListener('click',async event=>{
  const tab=event.target.closest('[data-rb-tab]');if(tab){event.preventDefault();event.stopImmediatePropagation();void openTab(tab.dataset.rbTab);return;}
  const b=event.target.closest('[data-rb-action]');if(!b||b.type==='submit')return;event.preventDefault();event.stopImmediatePropagation();
  const {rbAction:action,id}=b.dataset;
  try{
    if(action==='new'||action==='edit'||action==='supersede')return await editItem(id,action==='supersede');
    if(action==='detail')return await openItem(id);
    if(action==='history')return await history(id);
    if(action==='edit-source')return await editSource(id);
    if(action==='import')return await importFiles();
    if(['preview','open','reparse','source-detail'].includes(action)){
      const {source}=await hostRequest('research/source?'+query({id}));
      if(action==='preview')return await window.ScienceScopePreview.open(source.resourceId);
      if(action==='open')return await hostRequest('library/open',{id:source.resourceId});
      if(action==='source-detail'){modal('来源信息',`<div class="rb-dialog"><h3>${data(source.title)}</h3><pre data-i18n-skip>${esc(JSON.stringify(source,null,2))}</pre></div>`);return;}
      await hostRequest('research/sources/ingest',{id,wait:true});
    }else if(action==='hit'){
      if(b.dataset.type==='item')return await openItem(id);
      const {citation}=await hostRequest('research/cite?'+query({...scopeQuery(),label:b.dataset.cite}));if(citation?.source?.resourceId)return await window.ScienceScopePreview.open(citation.source.resourceId,{page:citation.page});return;
    }else if(action==='pin'||action==='archive'){
      const {item}=await hostRequest('research/item?'+query({id}));
      if(action==='archive'&&!await window.ScienceScopeWorkspace.confirmAction('归档条目','归档后不再进入默认检索和项目简报，修订历史保留。','归档'))return;
      await hostRequest('research/items/update',{id,patch:{expectedRevision:item.revision,...(action==='pin'?{pinned:!item.pinned}:{status:'archived'})}});
    }else if(action==='edit-proposal'){state.editingProposal=id;repaint();return;}
    else if(action==='cancel-proposal'){state.editingProposal=null;repaint();return;}
    else if(action==='accept'||action==='reject')await hostRequest('research/proposals/decide',{id,accept:action==='accept'});
    else if(action.startsWith('bulk-')){for(const selected of [...state.selected]){await hostRequest('research/proposals/decide',{id:selected,accept:action==='bulk-accept'});state.selected.delete(selected);}}
    else if(action==='origin'){const p=state.proposals.find(p=>p.id===id);const messageId=p?.origin?.messageId||p?.payload?.evidence?.find(e=>e.ref?.type==='message')?.ref.id;if(p?.origin?.chatId&&messageId)await window.ScienceScopeWorkspace.openMessage(p.origin.chatId,messageId);return;}
    else if(action==='prev')state.offset=Math.max(0,state.offset-50);
    else if(action==='next')state.offset+=50;
    else if(action==='clear-search'){state.query='';state.hits=null;}
    await reload();
  }catch(error){toast(error.message);}
},true);
const after=window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender=(...args)=>{after?.(...args);updateBadge();if(active()){const key=route+':'+project();if(key!==state.key){state.key=key;state.offset=0;void reload();}}else void refreshInbox();};
window.ScienceScopeResearchBase={openTab,openInbox:()=>openTab('inbox'),openItem,reload,refreshInbox};

// The former prototype context panel now selects actual records into the bound
// Main draft. Opening it does not inject anything; every selection is explicit.
const materials={key:null,ticket:0,sources:[],items:[],error:'',loading:false,offset:0};
const materialHTML=()=>`<div class="rb-materials"><form id="rb-material-search"><input name="q" placeholder="搜索资料与条目"><button class="btn tiny">搜索</button></form>${materials.error?`<p role="alert">${esc(materials.error)}</p>`:''}${materials.loading?'<p role="status">正在读取…</p>':''}<div class="rb-materials-list">${materials.sources.filter(s=>s.resourceId).map(s=>`<label><input type="checkbox" data-rb-pick-resource="${esc(s.resourceId)}" data-title="${esc(s.title)}">${data(s.label+' · '+s.title)}</label>`).join('')}${materials.items.filter(i=>i.visibility==='shared'&&i.status==='active'&&!i.scope.startsWith('expert:')).map(i=>`<label><input type="checkbox" data-rb-pick-item="${esc(i.id)}" data-title="${esc(i.title)}">${data(i.title)}</label>`).join('')}</div><div class="rb-pagination"><button class="btn tiny" data-rb-material-page="-1" ${materials.offset===0?'disabled':''}>上一页</button><button class="btn tiny" data-rb-material-page="1" ${materials.sources.length<50&&materials.items.length<50?'disabled':''}>下一页</button></div></div>`;
async function loadMaterials(q=''){
  const chatId=V.chat,thread=window.ScienceScopeWorkspace.resolveThread(chatId),projectId=thread?.projectId||null,ticket=++materials.ticket;
  if(!thread)return;materials.loading=true;materials.error='';
  try{
    if(q){const {hits}=await hostRequest('research/search?'+query({projectId:projectId||'',q,k:50}));const refs=[...new Map(hits.map(h=>[h.item?'item:'+h.ref.id:'source:'+h.source.id,h])).values()];const details=await Promise.all(refs.map(h=>hostRequest('research/'+(h.item?'item':'source')+'?'+query({id:h.item?h.ref.id:h.source.id}))));if(ticket!==materials.ticket)return;materials.sources=details.filter(d=>d.source).map(d=>d.source);materials.items=details.filter(d=>d.item).map(d=>d.item);}
    else{const [sources,items]=await Promise.all([hostRequest('research/sources?'+query({projectId:projectId||'',limit:50,offset:materials.offset})),hostRequest('research/items?'+query({projectId:projectId||'',status:'active',limit:50,offset:materials.offset}))]);if(ticket!==materials.ticket)return;materials.sources=sources.sources;materials.items=items.items;}
  }catch(error){if(ticket===materials.ticket)materials.error=error.message;}finally{if(ticket===materials.ticket){materials.loading=false;const body=document.querySelector('[data-rb-materials-body]');if(body){body.innerHTML=materialHTML();const draft=await window.ScienceScopeResearchInput.capture('main',chatId);if(V.chat===chatId)for(const input of body.querySelectorAll('[data-rb-pick-resource],[data-rb-pick-item]'))input.checked=draft.contextRefs.some(r=>input.dataset.rbPickItem?r.itemId===input.dataset.rbPickItem:r.resourceId===input.dataset.rbPickResource);}}}
}
const previousPanel=rightPanel;
rightPanel=function(type){if(type!=='context')return previousPanel(type);queueMicrotask(()=>{materials.key=V.chat;void loadMaterials();});return `<aside class="rightpanel"><div class="panel-resizer" data-v-resize></div><div class="panelhead between"><h2>项目材料与引用 ${infoTip('选择来源或共享条目加入当前输入；不会自动发送，也不会改变确认记录。')}</h2>${vib('close','close-panel','关闭侧栏')}</div><div class="panelbody" data-rb-materials-body>${materialHTML()}</div></aside>`;};
window.addEventListener('change',async event=>{const input=event.target;if(!input.matches('[data-rb-pick-resource],[data-rb-pick-item]'))return;event.stopImmediatePropagation();const ref=input.dataset.rbPickItem?{itemId:input.dataset.rbPickItem}:{resourceId:input.dataset.rbPickResource};try{await window.ScienceScopeResearchInput.selectContext('main',materials.key,ref,input.dataset.title,input.checked);}catch(error){input.checked=!input.checked;toast(error.message);}},true);
window.addEventListener('submit',event=>{if(event.target.id!=='rb-material-search')return;event.preventDefault();event.stopImmediatePropagation();materials.offset=0;void loadMaterials(new FormData(event.target).get('q'));},true);
window.addEventListener('click',event=>{const b=event.target.closest('[data-rb-material-page]');if(!b)return;event.preventDefault();event.stopImmediatePropagation();materials.offset=Math.max(0,materials.offset+Number(b.dataset.rbMaterialPage)*50);void loadMaterials();},true);
