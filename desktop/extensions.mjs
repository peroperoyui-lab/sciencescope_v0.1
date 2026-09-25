import {infoTip} from './info-tip.mjs';
import {hostRequest} from './host-client.mjs';
let catalog=null,inventory=null,error='',loading=false,editor=null;
const button=(label,action,name='')=>`<button type="button" class="btn tiny" data-extension="${action}" data-name="${esc(name)}">${label}</button>`;
const template='---\nname: research-checklist\ndescription: Check the sources and assumptions of a research argument.\n---\n\n# Research checklist\n\n1. Identify the question.\n2. Check sources and assumptions.\n3. Report gaps without inventing evidence.\n';
async function refresh(){if(loading)return;loading=true;try{const [skills,plugins]=await Promise.all([hostRequest('skills'),hostRequest('plugins/inventory')]);catalog=skills;inventory=plugins;error='';}catch(e){error=e.message;}finally{loading=false;if(['plugins','plugin'].includes(route))render();}}
export function extensionsContent(){
  if(!catalog&&!loading)queueMicrotask(()=>void refresh());
  if(editor)return `<h2>${editor.name?'编辑技能 · '+esc(editor.name):'添加本地技能'}</h2><form id="skill-editor"><div class="field"><label for="skill-markdown">SKILL.md${infoTip('必须包含 name 和 description 的 YAML 头，由 DSH 解析。\n技能提供工作步骤，不授予工具权限。\n此页只保存 SKILL.md；附带脚本或素材可放入技能目录。',{label:'SKILL.md 说明'})}</label><textarea id="skill-markdown" maxlength="131072" required style="min-height:380px;font-family:monospace">${esc(editor.markdown)}</textarea></div><p data-skill-feedback role="status"></p><div class="saverow">${button('取消','cancel')}<button type="submit" class="btn primary">保存技能</button></div></form>`;
  const skills=catalog?.skills||[];
  return `<h2>插件与技能${infoTip('本地技能由 DSH 发现并按需加载。\n停用不会抹去模型此前已经读入的内容；需要严格隔离旧上下文时请新建对话。',{label:'插件与技能说明'})}</h2><div class="row">${button('添加技能','new')}${button('导入 SKILL.md','import')}${button('刷新','refresh')}<button class="btn tiny" data-settings-open="skills">打开技能目录</button></div>${error?`<p role="alert">${esc(error)}</p>`:''}
    <h3>本客户端管理的技能</h3><table class="table"><thead><tr><th>名称</th><th>说明</th><th>状态</th><th>操作</th></tr></thead><tbody>${skills.map(skill=>`<tr><td>${esc(skill.name)}</td><td>${esc(skill.description||'无法解析，请检查 SKILL.md')}</td><td>${skill.valid===false?'格式无效':skill.enabled?'已启用':'已停用'}</td><td>${button('查看 / 编辑','edit',skill.name)} ${button(skill.enabled?'停用':'启用',skill.enabled?'disable':'enable',skill.name)} ${button('移除','remove',skill.name)}</td></tr>`).join('')||`<tr><td colspan="4">${loading?'正在读取…':'尚未添加本地技能'}</td></tr>`}</tbody></table>
    <h3>DSH 插件组成${infoTip('来自宿主的实时清单；宿主插件不是模型的工具列表。\n依赖包安装、更新及插件启停管理尚待接入 DSH CLI。',{label:'DSH 插件组成说明'})}</h3>${inventory?.available?`<details><summary>宿主插件 · ${inventory.entries.length} 项</summary>${pluginRows(inventory.entries)}</details>${(inventory.agentPresets||[]).map(p=>`<details><summary>Agent 预设 · ${esc(p.name||p.id)}${p.isDefault?' · 默认':''}</summary>${pluginRows(p.rows||[])}</details>`).join('')}`:'<p>插件清单暂不可用；本地技能管理不受影响。</p>'}`;
}
function pluginRows(rows){return `<table class="table"><thead><tr><th>模块</th><th>配置</th><th>运行状态</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.moduleName)}</td><td>${r.enabled===true?'启用':r.enabled===false?'停用':'条件启用'}</td><td>${esc(r.fiberPhase||'未挂载')}</td></tr>`).join('')}</tbody></table>`;}
window.addEventListener('click',async event=>{
  const el=event.target.closest('[data-extension]');if(!el)return;event.preventDefault();event.stopImmediatePropagation();
  const action=el.dataset.extension,name=el.dataset.name;el.disabled=true;
  try{
    if(action==='new'){editor={name:null,markdown:template};render();return;}
    if(action==='cancel'){editor=null;render();return;}
    if(action==='refresh'){await refresh();return;}
    if(action==='edit'){editor=await hostRequest('skills/read?'+new URLSearchParams({name}));render();return;}
    if(action==='import'){const picker=document.createElement('input');picker.type='file';picker.accept='.md';picker.onchange=async()=>{const file=picker.files[0];if(!file)return;if(file.size>131072){toast('技能说明不能超过 128 KiB。');return;}editor={name:null,markdown:await file.text()};render();};picker.click();return;}
    if(action==='remove'){if(!await window.ScienceScopeWorkspace.confirmAction('移除技能','此客户端将不再发现该技能，原目录移入本地恢复目录。','移除'))return;const result=await hostRequest('skills/remove',{name});toast('已移除，可从以下目录恢复：'+result.recoveryPath);}
    else if(['enable','disable'].includes(action))await hostRequest('skills/enabled',{name,enabled:action==='enable'});
    await refresh();
  }catch(e){error=e.message;toast(error);}finally{if(el.isConnected)el.disabled=false;}
},true);
window.addEventListener('submit',async event=>{
  const form=event.target;if(form.id!=='skill-editor')return;event.preventDefault();event.stopImmediatePropagation();const submit=form.querySelector('[type="submit"]');submit.disabled=true;
  try{await hostRequest('skills/save',{markdown:form.querySelector('textarea').value,...(editor.name?{name:editor.name}:{})});editor=null;await refresh();toast('技能已保存，DSH 将在后续目录发现时读取。');}
  catch(e){form.querySelector('[data-skill-feedback]').textContent=e.message;}finally{if(submit.isConnected)submit.disabled=false;}
},true);
