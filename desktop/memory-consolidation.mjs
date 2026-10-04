import {hostRequest} from './host-client.mjs';
import {infoTip} from './info-tip.mjs';

const help='空闲时只整理纪要的变化和对应原文，生成候选记忆。所有候选都进入记忆收件箱，只有经你确认才生效；网页或文献内容标为外部来源。整理会调用所选模型并产生用量。';
const modelHelp='默认使用任务秘书的模型；秘书未设置时使用该对话的模型。明确选择的模型不可用时会报错，不会自动换模型。每次整理有输入和输出预算，失败不会自动重新整理。';
export function memoryConsolidationSettingsContent(){return `<form data-memory-consolidation-settings><h2>记忆整理${infoTip(help)}</h2><fieldset disabled><label><input type="checkbox" name="enabled"> 空闲时整理候选记忆</label><label>空闲时间（分钟）<input type="number" name="idleMinutes" min="1" max="1440" step="1" required></label><label>整理模型${infoTip(modelHelp)}<select name="model"><option value="">使用秘书模型（未设置时使用对话模型）</option></select></label></fieldset><p role="status" data-memory-consolidation-feedback></p></form>`;}
const mounted=new WeakSet();
async function mount(form){
  const feedback=form.querySelector('[data-memory-consolidation-feedback]');
  try{
    const settings=await hostRequest('research/consolidate/settings');
    let providers=[];try{providers=(await hostRequest('providers')).providers||[];}catch{}
    if(!form.isConnected)return;
    const field=form.elements.model;
    for(const provider of providers)for(const value of provider.models||[]){const modelId=typeof value==='string'?value:value.id;const option=document.createElement('option');option.value=JSON.stringify({providerId:provider.id,modelId});option.textContent=`${provider.name||provider.id} / ${modelId}`;option.dataset.i18nSkip='';field.append(option);}
    const selected=settings.model?JSON.stringify({providerId:settings.model.providerId,modelId:settings.model.modelId}):'';
    if(selected&&![...field.options].some(option=>option.value===selected)){const option=document.createElement('option');option.value=selected;option.textContent=`${settings.model.providerId} / ${settings.model.modelId}`;option.dataset.i18nSkip='';field.append(option);}
    field.value=selected;form.elements.enabled.checked=settings.enabled;form.elements.idleMinutes.value=settings.idleMinutes;form.querySelector('fieldset').disabled=false;
    let saves=Promise.resolve();
    form.addEventListener('submit',event=>event.preventDefault());
    form.addEventListener('change',()=>{
      if(!form.reportValidity())return;
      const chosen=field.value?JSON.parse(field.value):null;
      if(chosen&&chosen.providerId===settings.model?.providerId&&chosen.modelId===settings.model?.modelId&&settings.model.reasoningEffort)chosen.reasoningEffort=settings.model.reasoningEffort;
      const patch={enabled:form.elements.enabled.checked,idleMinutes:Number(form.elements.idleMinutes.value),model:chosen};
      feedback.textContent='正在保存记忆整理设置…';
      saves=saves.catch(()=>{}).then(()=>hostRequest('research/consolidate/settings',patch)).then(()=>{feedback.textContent='记忆整理设置已保存。';}).catch(error=>{feedback.textContent=error.message;});
    });
  }catch(error){feedback.textContent=error.message;}
}
const dialog=()=>document.querySelector('.memory-consolidation-dialog');
const statuses={idle:'尚无整理记录',running:'正在整理候选记忆…',completed:'候选已整理，请到收件箱确认。',failed:'记忆整理失败；原文和已确认记忆保留。',skipped:'本次没有可整理的新证据。'};
async function paint(chatId){
  const value=await hostRequest('research/consolidate/status?'+new URLSearchParams({chatId}));const root=dialog();if(root?.dataset.chatId!==chatId)return;
  root.querySelector('[data-consolidate-status]').textContent=statuses[value.state]||statuses.idle;
  root.querySelector('[data-consolidate-run]').disabled=value.running;
  root.querySelector('[data-consolidate-range]').textContent=value.range?`#${value.range.from??value.range.fromOrdinal??''}–#${value.range.to??value.range.toOrdinal??''}`:'';
  if(value.error)root.querySelector('[data-consolidate-status]').textContent=`${statuses.failed} (${value.error.code})`;
}
function open(chatId){
  if(!chatId||!S.threads.some(thread=>thread.id===chatId))return;
  modal('整理这段对话',`<div class="memory-consolidation-dialog" data-chat-id="${esc(chatId)}"><h2>候选记忆${infoTip(help)}</h2><p role="status" data-consolidate-status>正在读取…</p><p data-consolidate-range data-i18n-skip></p><div class="saverow"><button class="btn" type="button" data-consolidate-inbox>打开记忆收件箱</button><button class="btn primary" type="button" data-consolidate-run>开始整理</button></div></div>`);
  void paint(chatId).catch(error=>{if(dialog()?.dataset.chatId===chatId)dialog().querySelector('[data-consolidate-status]').textContent=error.message;});
}
const baseMenu=objectMenu;
objectMenu=function(kind,id,...args){
  baseMenu(kind,id,...args);
  if(kind!=='chat'||!window.ScienceScopeFeatures?.has('memoryConsolidation')||!S.threads.some(thread=>thread.id===id))return;
  const button=document.createElement('button');button.className='menu-line';button.setAttribute('role','menuitem');button.dataset.v='memory-consolidate';button.dataset.chatId=id;button.textContent='整理这段对话';document.querySelector('#v-menu')?.append(button);
};
new MutationObserver(()=>{for(const form of document.querySelectorAll('[data-memory-consolidation-settings]'))if(!mounted.has(form)){mounted.add(form);void mount(form);}}).observe(document.body,{childList:true,subtree:true});
window.addEventListener('click',async event=>{
  const target=event.target.closest('[data-v="memory-consolidate"],[data-consolidate-run],[data-consolidate-inbox]');if(!target)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(target.dataset.v==='memory-consolidate'){closeMenu();open(target.dataset.chatId);return;}
  const root=dialog();if(!root)return;
  const chatId=root.dataset.chatId;
  if(target.hasAttribute('data-consolidate-inbox')){document.getElementById('modal')?.remove();const thread=S.threads.find(thread=>thread.id===chatId);if(thread?.projectId){await window.SSV2.loadThread(chatId);go('database');}else go('library');await window.ScienceScopeResearchBase?.openInbox?.();return;}
  target.disabled=true;root.querySelector('[data-consolidate-status]').textContent=statuses.running;
  try{await hostRequest('research/consolidate',{chatId});await paint(chatId);}catch(error){if(dialog()===root){root.querySelector('[data-consolidate-status]').textContent=error.message;target.disabled=false;}}
},true);
window.ScienceScopeConsolidation=Object.freeze({open});
