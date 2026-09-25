import {infoTip} from './info-tip.mjs';
import './workspace.mjs';
import {hostRequest} from './host-client.mjs';
import {renderMarkdown} from './markdown.mjs';
const state={resources:[],knowledge:[],query:'',view:'materials',namespace:'canonical',selected:null,key:'',ticket:0,error:'',loading:false};
const original=databasePage;
const action=(label,name,attrs='')=>`<button class="btn tiny" data-library="${name}" ${attrs}>${label}</button>`;
function tabs(){return `<div class="tabs">${[['database','当前项目材料'],['library','我的资料'],['sources','外部资源']].map(([r,t])=>`<button class="tab ${route===r?'active':''}" data-route="${r}">${t}</button>`).join('')}</div>`;}
async function reload(){
  const ticket=++state.ticket;state.loading=true;state.error='';
  try{
    const projectId=route==='database'?S.projectId:null;
    const query=`query=${encodeURIComponent(state.query)}${projectId?'&projectId='+encodeURIComponent(projectId):''}`;
    const [resources,knowledge]=await Promise.all([hostRequest('library?'+query),hostRequest(`knowledge?${query}&namespace=${state.namespace}`)]);
    if(ticket!==state.ticket)return;state.resources=resources.resources;state.knowledge=knowledge.knowledge;
  }catch(error){if(ticket===state.ticket)state.error=error.message;}finally{if(ticket===state.ticket){state.loading=false;if(['database','library','resource'].includes(route))render();}}
}
databasePage=()=>{
  if(route==='sources')return original();
  const privateView=state.namespace==='private';
  return `<div class="content">${pageintro(route==='database'?'项目材料':'我的资料','原始资料与已整理知识分别保存，知识保留来源。',action('导入材料','import'))}${tabs()}<div class="between" style="margin-bottom:18px"><div class="row">${action('材料','materials')}${action('知识','knowledge')} ${state.view==='knowledge'?`<select id="library-namespace"><option value="canonical" ${state.namespace==='canonical'?'selected':''}>规范知识</option><option value="heuristic" ${state.namespace==='heuristic'?'selected':''}>研究经验</option><option value="private" ${privateView?'selected':''}>私人偏好</option></select>${privateView?infoTip('私人条目单独查询，不会自动进入正式专家上下文。',{label:'私人偏好说明'}):''}`:''}</div><form id="library-search"><input id="library-query" class="searchinput" value="${esc(state.query)}" placeholder="搜索标题或内容…" aria-label="搜索资料"><button class="btn tiny">搜索</button></form></div>${state.error?`<p role="alert">${esc(state.error)}</p>`:''}${state.view==='materials'?`<table class="table"><thead><tr><th>材料</th><th>归属</th><th>原件</th><th>操作</th></tr></thead><tbody>${state.resources.map(r=>`<tr><td><span class="fileicon">${esc(r.kind.toUpperCase())}</span> ${esc(r.title)}</td><td>${esc(S.projects.find(p=>p.id===r.projectId)?.name||'全局资料')}</td><td>已保存</td><td>${action('详情','detail',`data-id="${esc(r.id)}"`)} ${action('预览','preview',`data-id="${esc(r.id)}"`)} ${action('打开原件','open',`data-id="${esc(r.id)}"`)}</td></tr>`).join('')}</tbody></table>`:`<div class="stack">${state.knowledge.map(k=>`<article class="card"><div class="between"><strong>${esc(k.title)}</strong><span class="badge">${k.status==='accepted'?'已确认':'候选'}</span></div><div class="mdview">${renderMarkdown(k.content)}</div><div class="row">${(k.sourceIds||[]).map(id=>action('查看来源','open',`data-id="${esc(id)}"`)).join('')}${k.status!=='accepted'?action('确认采用','accept',`data-id="${esc(k.id)}"`):''}</div></article>`).join('')}</div>`}${!(state.view==='materials'?state.resources:state.knowledge).length?`<div class="empty">${state.loading?'正在读取…':state.view==='materials'?'暂无材料。导入原件，或在工作站添加文献版本。':'暂无知识条目。材料详情中可以保存有来源的候选；不会自动把聊天总结当成知识。'}</div>`:''}</div>`;
};
resourcePage=()=>{const resource=state.selected;if(!resource)return `<div class="content">${pageintro('材料详情','请先从资料列表选择材料。',action('返回资料','materials'))}</div>`;return `<div class="content">${pageintro(esc(resource.title),'来源与原件位置。',action('打开原件','open',`data-id="${esc(resource.id)}"`))}<div class="card"><h2>来源信息</h2><p>归属：${esc(S.projects.find(p=>p.id===resource.projectId)?.name||'全局资料')}</p><p style="overflow-wrap:anywhere">原件：${esc(resource.path)}</p><p>类型：${esc(resource.kind)}</p><div class="row">${action('保存知识候选','propose',`data-id="${esc(resource.id)}"`)}${infoTip('候选是待确认的理解或经验，不改变原文，也不会自动提升为已确认知识。',{label:'知识候选说明'})}</div></div></div>`;};
const after=window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender=(...args)=>{after?.(...args);if(!['database','library'].includes(route))return;const key=route+':'+S.projectId;if(key!==state.key){state.key=key;void reload();}};
window.addEventListener('submit',event=>{if(event.target.id!=='library-search')return;event.preventDefault();event.stopImmediatePropagation();state.query=document.querySelector('#library-query').value;void reload();},true);
window.addEventListener('change',event=>{if(event.target.id==='library-namespace'){state.namespace=event.target.value;void reload();}},true);
window.addEventListener('click',async event=>{
  const button=event.target.closest('[data-library]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();
  try{
    const name=button.dataset.library;
    if(name==='materials'||name==='knowledge'){state.view=name;go(route==='database'?'database':'library');await reload();}
    else if(name==='detail'){state.selected=state.resources.find(r=>r.id===button.dataset.id);go('resource');}
    else if(name==='open')await hostRequest('library/open',{id:button.dataset.id});
    else if(name==='preview'){if(!window.ScienceScopePreview)throw new Error('文件预览尚未就绪。');await window.ScienceScopePreview.open(button.dataset.id);}
    else if(name==='accept'){if(await window.ScienceScopeWorkspace.confirmAction('确认采用知识','确认当前条目及其来源？这会把候选标记为已确认，不改变原始材料。','确认采用')){await hostRequest('knowledge/accept',{id:button.dataset.id});await reload();}}
    else if(name==='propose')modal('保存知识候选',`<input id="knowledge-title" placeholder="标题"><textarea id="knowledge-content" placeholder="说明内容、适用条件与不确定性"></textarea><select id="knowledge-namespace"><option value="heuristic">研究经验</option><option value="canonical">规范知识</option><option value="private">私人偏好</option></select>${action('保存候选','save-candidate',`data-source="${esc(button.dataset.id)}"`)}`);
    else if(name==='save-candidate'){await hostRequest('knowledge/propose',{title:document.querySelector('#knowledge-title').value,content:document.querySelector('#knowledge-content').value,namespace:document.querySelector('#knowledge-namespace').value,sourceIds:[button.dataset.source],projectId:state.selected?.projectId??null});document.querySelector('#modal')?.remove();toast('候选已保存，尚未确认采用。');}
    else if(name==='import'){
      const input=document.createElement('input');input.type='file';input.multiple=true;const projectId=route==='database'?S.projectId:null;
      input.onchange=async()=>{try{for(const file of input.files){if(file.size>14*1024*1024)throw new Error('单次导入文件上限 14 MB。');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));await hostRequest('library/import',{name:file.name,base64:btoa(binary),projectId});}await reload();toast('原件与资料记录已保存。');}catch(error){toast(error.message);}};input.click();
    }
  }catch(error){toast(error.message);}
},true);
window.ScienceScopeLibrary={reload};
