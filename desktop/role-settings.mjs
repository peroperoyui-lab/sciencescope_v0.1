import {infoTip} from './info-tip.mjs';
import {hostRequest} from './host-client.mjs';
const labels={main:'主专家',secretary:'任务秘书',global:'全局助手'};
let roles=[],providers=[],failure='';
const roleChannel=new BroadcastChannel('sciencescope-role-settings');
const targetRole=target=>target==='assistant-settings'?'global':target==='secretary-settings'?'secretary':'main';
const option=(value,label,selected)=>`<option value="${esc(value)}" ${selected?'selected':''}>${esc(label)}</option>`;
export function roleSettingsContent(target){
  const id=targetRole(target),config=roles.find(r=>r.role===id);
  if(!config)return `<h2>${labels[id]}设置</h2><p role="status">${esc(failure||'正在读取角色配置…')}</p>`;
  const modelValue=config.model?JSON.stringify(config.model):'';
  const choices=providers.flatMap(p=>p.models.map(modelId=>({value:JSON.stringify({providerId:p.id,modelId}),label:p.name+' / '+modelId})));
  if(modelValue&&!choices.some(c=>c.value===modelValue))choices.push({value:modelValue,label:config.model.modelId+'（当前服务列表中不存在）'});
  return `<form data-role-form="${id}"><h2>${labels[id]}设置${infoTip(id==='main'?'它是统筹者，不建议给予主专家特定角色。':'提示词描述职责，不代替工具权限设置。',{label:'角色说明'})}</h2>
    <div class="field"><label>角色 system prompt</label><textarea name="prompt" maxlength="16000" required style="min-height:240px">${esc(config.prompt)}</textarea></div>
    <div class="field"><label>新对话默认模型</label><select name="model">${option('','由输入框选择',!modelValue)}${choices.map(c=>option(c.value,c.label,c.value===modelValue)).join('')}</select></div>
    <div class="field"><label>默认思考强度</label><select name="effort">${option('','模型默认',!config.reasoningEffort)}${config.reasoningEffort?option(config.reasoningEffort,config.reasoningEffort,true):''}</select><small data-effort-note>仅使用模型公开支持的强度。</small></div>
    <p>已保存版本 ${config.revision}。保存用于新对话；已有对话须空闲时显式应用提示词。应用不会切换模型或清空历史。</p>
    <p data-role-feedback role="status"></p><div class="saverow"><button type="submit" class="btn primary">保存配置</button><button type="button" class="btn" data-role-apply="${id}">应用已保存提示词到${id==='global'?'全局助手':'当前'+labels[id]}</button></div>
    <details><summary>最近应用记录</summary><button type="button" class="btn tiny" data-role-history="${id}">读取记录</button><div data-role-receipts></div></details>
  </form>`;
}
async function refresh(){
  try{const data=await hostRequest('roles');roles=data.roles;providers=(await hostRequest('providers')).providers;failure='';}
  catch{failure='角色配置读取失败，请重开此页重试。';}
}
async function efforts(form){
  const model=form.elements.model.value,selected=form.elements.effort.value;
  if(!model){form.elements.effort.innerHTML=option('','模型默认',true);return;}
  try{const info=await hostRequest('model-info?'+new URLSearchParams(JSON.parse(model)));if(!form.isConnected||form.elements.model.value!==model)return;
    form.elements.effort.innerHTML=option('','模型默认',!selected)+(info.reasoning?.efforts||[]).map(item=>option(item.id,item.name,item.id===selected)).join('');
    form.querySelector('[data-effort-note]').textContent=info.reasoning?.efforts?.length?'能力来自当前运行时模型描述。':'此模型未声明可调强度，使用默认。';
  }catch{form.querySelector('[data-effort-note]').textContent='模型能力读取失败，保存前请核对模型配置。';}
}
window.addEventListener('change',event=>{const form=event.target.closest('[data-role-form]');if(form&&event.target.name==='model'){form.elements.effort.innerHTML=option('','模型默认',true);void efforts(form);}},true);
window.addEventListener('submit',async event=>{
  const form=event.target;if(!form.matches('[data-role-form]'))return;event.preventDefault();event.stopImmediatePropagation();
  const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{const config={prompt:form.elements.prompt.value,model:form.elements.model.value?JSON.parse(form.elements.model.value):null,reasoningEffort:form.elements.effort.value||null};const saved=await hostRequest('roles/save',{role:form.dataset.roleForm,config});roles=roles.map(r=>r.role===saved.role?saved:r);roleChannel.postMessage('changed');form.querySelector('[data-role-feedback]').textContent=`版本 ${saved.revision} 已保存；已有对话未改变。`;}
  catch(error){form.querySelector('[data-role-feedback]').textContent=error.message;}finally{button.disabled=false;}
},true);
window.addEventListener('click',async event=>{
  const button=event.target.closest('[data-role-apply],[data-role-history]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();
  const form=button.closest('[data-role-form]'),role=button.dataset.roleApply||button.dataset.roleHistory;
  button.disabled=true;
  try{if(button.hasAttribute('data-role-history')){const data=await hostRequest('roles/history?'+new URLSearchParams({role,chatId:V.chat||''}));form.querySelector('[data-role-receipts]').textContent=data.receipts.map(r=>`版本 ${r.revision} · ${new Date(r.at).toLocaleString()}`).join('\n')||'尚无显式应用记录。';return;}
    const saved=roles.find(r=>r.role===role);
    if(form.elements.prompt.value.trim()!==saved.prompt){form.querySelector('[data-role-feedback]').textContent='提示词有未保存修改，请先保存。';return;}
    const result=await hostRequest('roles/apply',{role,chatId:V.chat});form.querySelector('[data-role-feedback]').textContent=`版本 ${result.revision} 已应用；原历史保留，下一次请求使用新提示词。`;
  }catch(error){form.querySelector('[data-role-feedback]').textContent=error.message;}finally{button.disabled=false;}
},true);
roleChannel.onmessage=()=>void refresh();
const ready=refresh().then(()=>{if(['persona','experts','secretary-settings','assistant-settings'].includes(route))render();});
window.ScienceScopeRoleSettings={ready,async applyNewDraft(chatId){const before=window.ScienceScopeModels?.selected();await ready;const config=roles.find(r=>r.role==='main');if(V.chat!==chatId||V.pending.has(chatId)||window.ScienceScopeModels?.selected()!==before)return;if(config?.model){window.ScienceScopeModels?.select(config.model);window.ScienceScopeReasoning?.setDefault(config.reasoningEffort);render();}}};
// Populate capabilities when a settings form is mounted, without remounting it.
const mounted=new WeakSet();new MutationObserver(()=>{for(const form of document.querySelectorAll('[data-role-form]'))if(!mounted.has(form)){mounted.add(form);void efforts(form);}}).observe(document.body,{childList:true,subtree:true});
