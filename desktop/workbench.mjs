import './workspace.mjs';
import {hostRequest} from './host-client.mjs';
import {renderMarkdown} from './markdown.mjs';

// The prototype remains the visual baseline; disk state replaces its examples.
const cache=new Map(), loading=new Set(), channel=new BroadcastChannel('sciencescope-workbench');
let ready=false, viewKey='', folder='', entries=[], allLogs=false, dirty=false;
const mapUndo=[],mapRedo=[];
const mapSnapshot=()=>structuredClone({nodes:S.nodes,edges:S.mapEdges||[]});
captureMap=()=>{mapUndo.push(mapSnapshot());if(mapUndo.length>50)mapUndo.shift();mapRedo.length=0;};
const current=()=>cache.get(S.projectId);
const button=(label,action,extra='')=>`<button class="btn tiny" data-wb="${action}" ${extra}>${label}</button>`;
const assetUrl=(relative)=>`/api/workbench/asset?projectId=${encodeURIComponent(S.projectId)}&path=${encodeURIComponent(relative)}`;
const organizing=new Set();
async function organize(versionId){
  if(organizing.has(versionId))return;
  const model=window.ScienceScopeModels?.selected();
  if(!model){toast('原件已保存；选择模型后可点击“整理说明”。');return;}
  const projectId=S.projectId;organizing.add(versionId);render();
  try{const result=await hostRequest('workbench/organize',{projectId,versionId,model});toast(result.status==='organized'?'秘书说明已保存。':result.note||'整理未完成；原件已保存。');if(projectId===S.projectId)await load();}
  catch(e){toast(e.message);}finally{organizing.delete(versionId);render();}
}
function apply(value){
  S.nodes=structuredClone(value.map.nodes); S.mapEdges=structuredClone(value.map.edges||[]);
  for(const node of S.nodes)for(const image of node.images||[])if(image.path)image.src=assetUrl(image.path);
  S.collapsed=value.map.collapsed||{}; S.mapHistory=value.map.history||[];
  S.journals=structuredClone(value.logs); S.versions=structuredClone(value.versions);
  S.mapSelected=S.nodes.some(n=>n.id===S.mapSelected)?S.mapSelected:S.nodes[0]?.id;
  dirty=false;
  mapUndo.length=0;mapRedo.length=0;
}
async function load(id=S.projectId){
  if(!id||loading.has(id))return;
  const requestedRoute=route;
  loading.add(id);
  try {
    const value=await hostRequest(`workbench?projectId=${encodeURIComponent(id)}`);
    if(id===S.projectId&&dirty)return;
    cache.set(id,value);
    if(id===S.projectId){apply(value);await files('');if(route===requestedRoute){render();requestAnimationFrame(fitMap);}}
  }catch(error){toast(error.message);}finally{loading.delete(id);}
}
async function files(relative=folder){
  const id=S.projectId;
  const result=await hostRequest(`workbench/files?projectId=${encodeURIComponent(id)}&path=${encodeURIComponent(relative)}`);
  if(id===S.projectId){folder=relative;entries=result.entries;}
}
async function save(patch){
  const id=S.projectId,value=current();if(!value)throw new Error('工作站尚未读取完成。');
  const next=await hostRequest('workbench/save',{projectId:id,revision:value.revision,...patch});
  cache.set(id,{...value,...next});channel.postMessage({projectId:id});return next;
}
async function saveMap(){
  const nodes=structuredClone(S.nodes);
  for(const node of nodes)for(const image of node.images||[])if(image.path)delete image.src;
  const ids=new Set(nodes.map(n=>n.id));
  await save({map:{nodes,edges:(S.mapEdges||[]).filter(e=>ids.has(e.from)&&ids.has(e.to)),collapsed:S.collapsed,history:S.mapHistory}});
  dirty=false;toast('导图已保存，预览已更新。');
  const status=document.querySelector('#mapsavestate');if(status)status.textContent='已保存到项目目录';
}
channel.onmessage=({data})=>{if(data.plans){hostRequest('workbench/plans').then(plans=>{S.plans=plans;if(['workbench','plans'].includes(route))render();}).catch(()=>{});return;}if(data.projectId===S.projectId&&!dirty){if(['workbench','map','map-rich','versions'].includes(route))load();else cache.delete(data.projectId);}else if(data.projectId!==S.projectId)cache.delete(data.projectId);else toast('其他窗口已更新导图；当前草稿保留，保存时会检查版本。');};
const baseAfter=window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender=function(...args){
  baseAfter?.(...args);if(!ready)return;
  const key=S.projectId+':'+route;
  if(key!==viewKey){
    const changedProject=viewKey.split(':')[0]!==S.projectId;viewKey=key;
    if(changedProject){folder='';entries=[];if(current()){apply(current());files('').then(()=>render()).catch(e=>toast(e.message));}else load();}
    else if(['workbench','versions','map','map-rich'].includes(route)&&!dirty)load();
    if(['workbench','map','map-rich'].includes(route))requestAnimationFrame(fitMap);
  }
};
const baseWorkbench=workbench;
workbench=()=>{
  let html=baseWorkbench().replace(/<div class="wb-action">[\s\S]*?<\/div>/,'')
    .replace('拖入文件 · 秘书自动整理说明','拖入文件')
    .replace(/<small>等待秘书<\/small>/g,'<small>原件已保存</small>');
  html=html.replace('</div><div class="journalstrip">',`${button('查看全部','logs')}</div><div class="journalstrip">`);
  html=html.replace('<div class="versionlist"',`<label class="wb-organize"><input type="checkbox" data-wb-organize ${current()?.autoOrganize?'checked':''}>秘书自动整理</label><div class="versionlist"`);
  return html.replace(/<small>等待秘书<\/small>/g,'<small>原件已保存</small>');
};
function fileIcon(name,directory=false){
  if(directory)return ic('folder');
  const ext=name.split('.').pop().toLowerCase();
  const known={pdf:'PDF',doc:'DOC',docx:'DOC',xls:'XLS',xlsx:'XLS',csv:'CSV',md:'MD',txt:'TXT',tex:'TEX',png:'IMG',jpg:'IMG',jpeg:'IMG',svg:'IMG',json:'{}',py:'PY',r:'R',zip:'ZIP'};
  return `<span class="wb-file-icon" data-format="${known[ext]||'FILE'}">${known[ext]||ic('file')}</span>`;
}
fileTreeHTML=()=>`<div class="wb-path" title="${esc(current()?.folder||'')}">${esc(current()?.folder||'正在读取项目目录…')}</div><div class="row">${button('绑定目录','bind')}${button('刷新','refresh')}</div>${folder?button('上一级','up'):''}${entries.map(entry=>`<button class="wb-file-row" data-wb="${entry.directory?'folder':'open'}" data-path="${esc(entry.path)}">${fileIcon(entry.name,entry.directory)}<span>${esc(entry.name)}</span></button>`).join('')||'<p class="hint">这个目录暂无文件</p>'}`;
filesPage=()=>`<div class="content">${pageintro('项目文件夹','显示绑定目录中的实际文件。',button('资源管理器打开','open',`data-path="${esc(folder)}"`))}<div class="card">${fileTreeHTML()}</div></div>`;
versions=()=>`<div class="content">${pageintro('文献版本管理','原件保存在项目的 paper_versions 目录。',button('资源管理器打开','open','data-path="paper_versions"')+button('添加版本','import'))}<label class="wb-organize"><input type="checkbox" data-wb-organize ${current()?.autoOrganize?'checked':''}>秘书自动整理</label><div class="dropzone" data-drop="version">拖入文件</div><table class="table"><thead><tr><th>文件</th><th>版本</th><th>导入时间</th><th>说明</th><th></th></tr></thead><tbody>${S.versions.map(v=>`<tr><td>${fileIcon(v.name)} ${esc(v.name)}</td><td>v${v.number}</td><td>${esc(new Date(v.created).toLocaleString())}</td><td>${organizing.has(v.id)?'秘书正在整理…':esc(v.status==='organized'?'说明已保存':v.note||'原件已保存，尚无整理说明')}</td><td>${button('打开原件','open',`data-path="${esc(v.relativePath)}"`)} ${v.status==='organized'?button('说明 MD','open',`data-path="${esc(v.note)}"`):button('整理说明','organize',`data-id="${esc(v.id)}" ${organizing.has(v.id)?'disabled':''}`)}</td></tr>`).join('')}</tbody></table></div>`;
const baseJournal=journalPage;
journalPage=()=>allLogs?`<div class="content">${pageintro('本项目日志',esc(S.project))}<div class="wb-log-list">${S.journals.map(vLogCard).join('')||'<p class="hint">暂无项目日志</p>'}</div></div>`:baseJournal();
const basePlan=planPage;
planPage=()=>basePlan().replace('class="grid3"','class="wb-plan-grid"');
async function persistRecords(kind,records){
  if(kind==='plan'){await hostRequest('workbench/plans',{plans:records});S.plans=records;channel.postMessage({plans:true});}
  else {await save({logs:records});S.journals=records;}
}
async function fileBody(file){
  if(file.size>14*1024*1024)throw new Error('当前单文件上限为 14 MB；较大文件可放入绑定目录。');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let start=0;start<bytes.length;start+=16384)binary+=String.fromCharCode(...bytes.subarray(start,start+16384));
  return {name:file.name,base64:btoa(binary)};
}
appendRecordFiles=async filesToAttach=>{
  const editor=V.editor;if(!editor)return;
  if(!current()){toast('请先选择项目，附件将保存在该项目目录。');return;}
  try{for(const file of filesToAttach){const asset=await hostRequest('workbench/asset',{projectId:S.projectId,...await fileBody(file)});(editor.data.files??=[]).push({id:uid('attachment'),name:file.name,size:file.size,path:asset.path,projectId:S.projectId});}if(V.editor===editor)showRecordEditor();}catch(error){toast(error.message);}
};
saveRecord=async()=>{
  const editor=V.editor;if(!editor)return;const title=editor.data.title.trim();
  if(!title){document.querySelector('#record-error').textContent='请填写标题';return;}
  if(editor.kind==='log'&&editor.projectId!==S.projectId){toast('请回到日志所属项目后保存。');return;}
  const records=structuredClone(editor.kind==='plan'?S.plans:S.journals);
  const record={...editor.data,title,id:editor.id||uid(editor.kind),time:new Date().toLocaleString(),author:window.ScienceScopeProfile?.name()||'用户'};
  const index=records.findIndex(r=>r.id===record.id);if(index<0)records.push(record);else records[index]=record;
  try{await persistRecords(editor.kind,records);V.editor=null;document.querySelector('#record-editor')?.remove();render();toast('已保存到本机。');}catch(e){toast(e.message);}
};
deleteRecord=async(kind,id)=>{try{const records=(kind==='plan'?S.plans:S.journals).filter(r=>r.id!==id);await persistRecords(kind,records);V.editor=null;render();toast('已删除。');}catch(e){toast(e.message);}};

// Explicit floating nodes and links augment the existing tree, not a new graph engine.
mapPositions=()=>{
  const result=[], visiting=new Set();let y=40;
  const height=n=>Math.min(320,Math.max(90,55+Math.ceil(String(n.text||'').length/22)*23+(n.images?.length?100:0)));
  function walk(node,x,top){
    if(visiting.has(node.id))return 0;visiting.add(node.id);
    const h=height(node),p={node,x:Number.isFinite(node.x)&&node.floating?node.x:x,y:Number.isFinite(node.y)&&node.floating?node.y:top,w:250,h,root:!node.parent,parent:node.parent};result.push(p);
    let used=0;if(!S.collapsed[node.id])for(const child of S.nodes.filter(n=>n.parent===node.id))used+=walk(child,p.x+320,top+used)+24;
    return Math.max(h,used);
  }
  for(const node of S.nodes.filter(n=>!n.parent)){const h=walk(node,node.floating?420:60,y);if(!node.floating)y+=h+64;}
  return result;
};
mapViewport=edit=>{
  const positions=mapPositions(),byId=new Map(positions.map(p=>[p.node.id,p]));
  const edges=S.mapEdges||[];
  let lines=edges.map(e=>{const a=byId.get(e.from),b=byId.get(e.to);return a&&b?`<path d="M${a.x+a.w} ${a.y+a.h/2} L${b.x} ${b.y+b.h/2}" ${e.directed?'marker-end="url(#wb-arrow)"':''}/>`:'';}).join('');
  const roots=positions.filter(p=>p.root&&!p.node.floating);for(let i=1;i<roots.length;i++){const a=roots[i-1],b=roots[i];lines+=`<path d="M${a.x+a.w/2} ${a.y+a.h} L${b.x+b.w/2} ${b.y-5}" marker-end="url(#wb-arrow)"/>`;}
  for(const parent of positions){const children=positions.filter(p=>p.parent===parent.node.id);if(!children.length)continue;const x=parent.x+parent.w+30,first=children[0],last=children.at(-1),mid=parent.y+parent.h/2;lines+=`<path d="M${parent.x+parent.w} ${mid} H${x} M${x+12} ${first.y+18} Q${x} ${first.y+18} ${x} ${first.y+30} V${last.y+last.h-18} Q${x} ${last.y+last.h-6} ${x+12} ${last.y+last.h-6}"/>`;for(const child of children)lines+=`<path d="M${x} ${child.y+child.h/2} H${child.x}"/>`;}
  return `<div class="mapviewport" id="mapviewport" data-edit="${edit}">${edit?'':'<span class="readbadge">缩放 / 拖动 / 展开 · 内容只读</span>'}<div class="mapscene" id="mapscene"><svg class="connections"><defs><marker id="wb-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#9bac8f"/></marker></defs><g fill="none" stroke="#9bac8f" stroke-width="1.5">${lines}</g></svg>${positions.map(p=>`<div class="mapnode ${p.root?'root':'secondary'} ${S.mapSelected===p.node.id?'selected':''}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px" data-node="${esc(p.node.id)}" data-action="select-node" ${edit?'data-drop="map"':''} tabindex="0"><div class="nodetext">${renderMarkdown(p.node.text)}</div>${(p.node.images||[]).map(image=>`<img class="nodeimg" src="${esc(image.path?assetUrl(image.path):image.src)}" alt="${esc(image.name)}">`).join('')}<button class="nodeplus" data-action="node-toggle" data-id="${esc(p.node.id)}">${S.nodes.some(n=>n.parent===p.node.id)&&!S.collapsed[p.node.id]?'−':'+'}</button></div>`).join('')}</div></div>`;
};
fitMap=()=>{const vp=document.querySelector('#mapviewport'),p=mapPositions();if(!vp||!p.length||!vp.clientWidth)return;const minX=Math.min(...p.map(n=>n.x)),minY=Math.min(...p.map(n=>n.y)),width=Math.max(...p.map(n=>n.x+n.w))-minX,height=Math.max(...p.map(n=>n.y+n.h))-minY;const scale=Math.max(.1,Math.min(1,(vp.clientWidth-60)/width,(vp.clientHeight-60)/height));mapView={scale,x:(vp.clientWidth-width*scale)/2-minX*scale,y:(vp.clientHeight-height*scale)/2-minY*scale};applyMapView();};
const baseMapEditor=mapEditor;
mapEditor=()=>baseMapEditor().replace(/<button[^>]*(?:data-action="back-workbench"|data-v="back-workbench-v2")[\s\S]*?<\/button>/,'')
  .replace('当前为浏览器内存原型 · 保存后同步预览',dirty?'尚未保存 · 保存后更新预览':'项目文件 · 保存后更新预览')
  .replace('<div class="toolbar-scroll">',`<div class="toolbar-scroll">${button('游离节点','floating')}${button('连线','connect')}`);
mapChanged=(label='编辑导图')=>{dirty=true;S.mapHistory.unshift({label,source:window.ScienceScopeProfile?.name()||'用户',time:new Date().toLocaleString()});render();const status=document.querySelector('#mapsavestate');if(status)status.textContent='尚未保存 · 保存后更新预览';};

async function upload(filesToImport,kind,nodeId=S.mapSelected){
  if(!current())throw new Error('请先打开项目工作站。');
  if(kind!=='map'&&dirty)await saveMap();
  const imported=[];
  for(const file of filesToImport){
    if(kind==='map'&&!/\.(png|jpe?g|gif|webp|md|txt)$/i.test(file.name))throw new Error('节点支持 PNG/JPEG/GIF/WebP 图片或 Markdown 文本。');
    const result=await hostRequest(kind==='map'?'workbench/asset':'workbench/import',{projectId:S.projectId,...await fileBody(file)});
    if(kind!=='map')imported.push(result.id);
    if(kind==='map'){
      const node=S.nodes.find(n=>n.id===nodeId);if(!node)continue;
      if(/\.(md|txt)$/i.test(file.name))node.text+=(node.text?'\n\n':'')+await file.text();
      else (node.images??=[]).push({name:file.name,path:result.path});dirty=true;
    }
  }
  if(kind==='map'){await saveMap();render();}
  else {await load();toast('原件已保存到项目目录。');if(current()?.autoOrganize)for(const id of imported)await organize(id);}
}
function pick(kind){const input=document.createElement('input');input.type='file';input.multiple=true;if(kind==='map')input.accept='.png,.jpg,.jpeg,.gif,.webp,.md,.txt';input.onchange=()=>upload([...input.files],kind).catch(e=>toast(e.message));input.click();}
const originalHandleFiles=handleFiles;
handleFiles=(items,kind,node)=>['map','version','project'].includes(kind)?upload(items,kind,node).catch(e=>toast(e.message)):originalHandleFiles(items,kind,node);
window.addEventListener('drop',event=>{const node=event.target.closest('[data-node]');if(!node||!['map','map-rich'].includes(route))return;event.preventDefault();event.stopImmediatePropagation();upload([...event.dataTransfer.files],'map',node.dataset.node).catch(e=>toast(e.message));},true);
window.addEventListener('dblclick',event=>{
  const element=event.target.closest('[data-node]');if(!element||!['map','map-rich'].includes(route))return;
  event.preventDefault();event.stopImmediatePropagation();const node=S.nodes.find(n=>n.id===element.dataset.node);S.mapSelected=node.id;captureMap();
  const input=document.createElement('textarea');input.className='wb-node-editor';input.value=node.text;element.replaceChildren(input);input.focus();input.select();
  input.addEventListener('click',e=>e.stopPropagation());input.oninput=()=>{node.text=input.value;dirty=true;};input.onblur=()=>render();
  input.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'||(e.key==='Enter'&&(e.ctrlKey||e.metaKey))){e.preventDefault();input.blur();}};
},true);
window.addEventListener('focusin',event=>{if(event.target.matches('[data-node-input]'))captureMap();},true);
window.addEventListener('input',event=>{if(event.target.matches('[data-node-input]'))dirty=true;},true);
window.addEventListener('change',event=>{if(event.target.matches('[data-wb-organize]'))save({autoOrganize:event.target.checked}).then(()=>toast('自动整理偏好已保存。')).catch(e=>{event.target.checked=!event.target.checked;toast(e.message);});},true);
window.addEventListener('click',async event=>{
  const el=event.target.closest('[data-wb],[data-action],[data-v]');if(!el)return;
  const action=el.dataset.wb||el.dataset.v||el.dataset.action;
  if(['open-log','legacy-open-log'].includes(action))allLogs=false;
  if(action==='select-node'&&['map','map-rich'].includes(route)){
    event.preventDefault();event.stopImmediatePropagation();S.mapSelected=el.dataset.node;
    document.querySelectorAll('.mapnode').forEach(n=>n.classList.toggle('selected',n===el));
    const template=document.createElement('template');template.innerHTML=mapEditor();const inspector=template.content.querySelector('.editorinspector');if(inspector)document.querySelector('.editorinspector')?.replaceWith(inspector);
    return;
  }
  const known=['organize','record-file-open','undo-map','redo-map','complete-plan','logs','bind','bind-save','refresh','up','folder','open','import','floating','connect','connect-save','connect-remove','save-map','save-map-v2','open-folder','upload-version','upload-project','version-open','version-select','map-file','map-pick'];
  if(!known.includes(action))return;event.preventDefault();event.stopImmediatePropagation();
  try {
    if(action==='organize')await organize(el.dataset.id);
    else if(action==='record-file-open'){const file=[...S.plans,...S.journals].flatMap(r=>r.files||[]).find(f=>f.id===el.dataset.id);if(!file?.path)throw new Error('这个旧附件没有本地文件，请重新添加。');await hostRequest('workbench/open',{projectId:file.projectId,path:file.path});}
    else if(action==='undo-map'||action==='redo-map'){const source=action==='undo-map'?mapUndo:mapRedo,target=action==='undo-map'?mapRedo:mapUndo;if(source.length){target.push(mapSnapshot());const snapshot=source.pop();S.nodes=snapshot.nodes;S.mapEdges=snapshot.edges;mapChanged(action==='undo-map'?'撤销导图编辑':'重做导图编辑');}}
    else if(action==='complete-plan'){const plans=structuredClone(S.plans),plan=plans.find(p=>p.id===el.dataset.id);if(plan)plan.done=!plan.done;await persistRecords('plan',plans);render();}
    else if(action==='logs'){allLogs=true;go('journal');}
    else if(action==='bind')modal('绑定项目目录',`<p class="hint">不会移动已有文件。已有聊天保留原执行目录；新聊天使用新目录。</p><input id="wb-folder" value="${esc(current()?.folder||'')}" placeholder="绝对目录路径">${button('绑定','bind-save')}`);
    else if(action==='bind-save'){await hostRequest('workbench/bind',{projectId:S.projectId,folder:document.querySelector('#wb-folder').value});document.querySelector('#modal')?.remove();await load();}
    else if(action==='refresh'){if(dirty)throw new Error('请先保存导图草稿，再刷新项目。');await load();}
    else if(['up','folder'].includes(action)){await files(action==='up'?folder.split('/').slice(0,-1).join('/'):el.dataset.path);render();}
    else if(['open','open-folder','version-open','version-select'].includes(action)){const version=S.versions.find(v=>v.id===el.dataset.id);await hostRequest('workbench/open',{projectId:S.projectId,path:version?.relativePath||(el.dataset.path==='project'?'':el.dataset.path||'')});}
    else if(['import','upload-version','upload-project'].includes(action))pick('version');
    else if(['map-file','map-pick'].includes(action))pick('map');
    else if(action.startsWith('save-map'))await saveMap();
    else if(action==='floating'){captureMap();const id=uid('node');S.nodes.push({id,parent:null,floating:true,text:'新的研究节点',x:420,y:120,images:[]});S.mapSelected=id;mapChanged('新增游离节点');}
    else if(action==='connect')modal('节点连线',`<label>起点<select id="wb-link-from">${S.nodes.map(n=>`<option value="${esc(n.id)}" ${n.id===S.mapSelected?'selected':''}>${esc(n.text.slice(0,40))}</option>`).join('')}</select></label><label>终点<select id="wb-link-to">${S.nodes.map(n=>`<option value="${esc(n.id)}">${esc(n.text.slice(0,40))}</option>`).join('')}</select></label><label class="checkrow"><input id="wb-link-directed" type="checkbox" checked>有向连线</label>${button('添加连线','connect-save')}<hr>${(S.mapEdges||[]).map(e=>`<p>${esc(S.nodes.find(n=>n.id===e.from)?.text.slice(0,20)||'')} ${e.directed?'→':'—'} ${esc(S.nodes.find(n=>n.id===e.to)?.text.slice(0,20)||'')} ${button('移除','connect-remove',`data-id="${esc(e.id)}"`)}</p>`).join('')}`);
    else if(action==='connect-save'){const from=document.querySelector('#wb-link-from').value,to=document.querySelector('#wb-link-to').value;if(from===to)throw new Error('请选择不同的节点。');captureMap();(S.mapEdges??=[]).push({id:uid('edge'),from,to,directed:document.querySelector('#wb-link-directed').checked});document.querySelector('#modal')?.remove();mapChanged('添加连线');}
    else if(action==='connect-remove'){captureMap();S.mapEdges=S.mapEdges.filter(e=>e.id!==el.dataset.id);document.querySelector('#modal')?.remove();mapChanged('移除连线');}
  }catch(error){toast(error.message);}
},true);

let nodeDrag;
window.addEventListener('pointerdown',event=>{const element=event.target.closest('[data-node]');if(event.button!==0||!element||event.target.closest('button,textarea,input')||!['map','map-rich'].includes(route))return;const node=S.nodes.find(n=>n.id===element.dataset.node);if(!node?.floating)return;nodeDrag={node,element,id:event.pointerId,x:event.clientX,y:event.clientY,originalX:node.x,originalY:node.y};element.setPointerCapture(event.pointerId);},true);
window.addEventListener('pointermove',event=>{if(!nodeDrag)return;const d=nodeDrag;d.node.x=d.originalX+(event.clientX-d.x)/mapView.scale;d.node.y=d.originalY+(event.clientY-d.y)/mapView.scale;d.element.style.left=d.node.x+'px';d.element.style.top=d.node.y+'px';},true);
window.addEventListener('pointerup',event=>{if(!nodeDrag)return;const d=nodeDrag;nodeDrag=null;if(Math.abs(event.clientX-d.x)+Math.abs(event.clientY-d.y)>4)mapChanged('移动游离节点');},true);
window.addEventListener('keydown',event=>{if(event.isComposing)return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&['map','map-rich'].includes(route)){event.preventDefault();event.stopImmediatePropagation();saveMap().catch(e=>toast(e.message));}},true);

await window.ScienceScopeWorkspace.ready;
try {S.plans=await hostRequest('workbench/plans');if(!Array.isArray(S.plans))S.plans=S.plans.plans||[];}catch{S.plans=[];}
ready=true;await load();window.ScienceScopeWorkbench={ready:true,refresh:load,saveMap};
