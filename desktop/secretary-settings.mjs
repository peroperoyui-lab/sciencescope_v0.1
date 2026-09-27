import {infoTip} from './info-tip.mjs';
import {hostRequest} from './host-client.mjs';

const summaryHelp='任务秘书在下列时机更新对话纪要。总结越少，专家和秘书收到的纪要之后原文越长；每 n 个新 token 用于触发总结，不会静默截断原文。';
const workbenchHelp='导图、稿件版本、计划、日志有大量你的参与，非必要不开启。提议需要你逐条确认后才写入；直接更新只追加或标记，不改写你的内容，可撤销。';
function summaryContent(){return `<form data-summary-settings><h2>自动总结${infoTip(summaryHelp)}</h2><fieldset disabled>
  <label><input type="checkbox" name="afterDiscussion"> 有序讨论结束后</label>
  <label><input type="checkbox" name="messagesEnabled"> 每 <input type="number" name="messagesN" min="4" max="500" step="1" aria-label="主对话消息间隔"> 条主对话消息</label>
  <label><input type="checkbox" name="tokensEnabled"> 每 <input type="number" name="tokensN" min="2000" max="500000" step="1" aria-label="新 token 间隔"> 个新 token</label>
  <label><input type="checkbox" name="onEnterProject"> 进入项目时</label>
  <label><input type="checkbox" name="onLeaveProject"> 离开项目时</label>
  <label><input type="checkbox" name="saveMarkdown"> 同时保存为工作文件夹中的 Markdown 文件${infoTip('保存在工作文件夹的 minutes/ 下；在文件里的修改不会读回，请在对话纪要窗口中编辑。')}</label>
  <h3>随总结更新工作站${infoTip(workbenchHelp)}</h3>
  ${[['map','导图'],['versions','稿件版本说明'],['plans','计划'],['log','日志']].map(([key,label])=>`<label>${label}<select name="${key}"><option value="off" data-summary-off data-i18n-skip>关闭</option><option value="propose">提议</option><option value="apply">直接更新</option></select></label>`).join('')}
  </fieldset><p data-summary-feedback role="status"></p></form>`;}
export function secretaryPreferencesContent(){return `<section data-secretary-preferences>${summaryContent()}<h2>文献版本整理</h2><form data-secretary-template><label>版本说明模板 · Markdown${infoTip('用于下一次整理说明；不会重写已有说明或原件。', {label: '模板说明'})}<textarea name="notesTemplate" maxlength="16000" required rows="8" disabled></textarea></label><button class="btn" type="submit" disabled>保存模板</button><p data-template-feedback role="status"></p></form><label><input type="checkbox" data-secretary-organize disabled> 导入材料后自动整理当前项目的版本说明${infoTip('只影响当前项目；整理会使用已选择的模型并产生 API 用量。', {label: '自动整理说明'})}</label><p data-organize-feedback role="status"></p></section>`;}
const mounted=new WeakSet(),channel=new BroadcastChannel('sciencescope-workbench');
function translateOffOptions(){for(const option of document.querySelectorAll('[data-summary-off]')){const text=document.documentElement.lang==='en'?(window.ScienceScopeI18n?.translate('关闭自动更新')||'Off'):'关闭';if(option.textContent!==text)option.textContent=text;}}
new MutationObserver(translateOffOptions).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
async function mount(section){
  translateOffOptions();
  try{
    const preferences=await hostRequest('secretary/preferences');if(!section.isConnected)return;
    section.querySelector('textarea').value=preferences.notesTemplate;section.querySelector('textarea').disabled=false;section.querySelector('[type="submit"]').disabled=false;
    const form=section.querySelector('[data-summary-settings]'), fields=form.elements, summary=preferences.summary;
    for(const key of ['afterDiscussion','onEnterProject','onLeaveProject','saveMarkdown'])fields[key].checked=summary[key];
    fields.messagesEnabled.checked=summary.everyMessages.enabled;fields.messagesN.value=summary.everyMessages.n;
    fields.tokensEnabled.checked=summary.everyTokens.enabled;fields.tokensN.value=summary.everyTokens.n;
    for(const key of ['map','versions','plans','log'])fields[key].value=summary.workbench[key];
    form.querySelector('fieldset').disabled=false;
    let saves=Promise.resolve();
    form.addEventListener('submit',event=>event.preventDefault());
    form.addEventListener('change',()=>{
      if(!form.reportValidity())return;
      const value={afterDiscussion:fields.afterDiscussion.checked,onEnterProject:fields.onEnterProject.checked,onLeaveProject:fields.onLeaveProject.checked,saveMarkdown:fields.saveMarkdown.checked,
        everyMessages:{enabled:fields.messagesEnabled.checked,n:Number(fields.messagesN.value)},everyTokens:{enabled:fields.tokensEnabled.checked,n:Number(fields.tokensN.value)},
        workbench:Object.fromEntries(['map','versions','plans','log'].map(key=>[key,fields[key].value]))};
      const feedback=form.querySelector('[data-summary-feedback]');feedback.textContent='正在保存自动总结设置…';
      saves=saves.catch(()=>{}).then(()=>hostRequest('secretary/preferences',{summary:value})).then(()=>{feedback.textContent='自动总结设置已保存。';}).catch(error=>{feedback.textContent=error.message;});
    });
  }catch{section.querySelector('[data-template-feedback]').textContent='模板读取失败，请重新打开设置。';section.querySelector('[data-summary-feedback]').textContent='自动总结设置读取失败，请重新打开设置。';}
  const projectId=S.projectId,checkbox=section.querySelector('[data-secretary-organize]'),feedback=section.querySelector('[data-organize-feedback]');
  if(!projectId){feedback.textContent='进入一个项目后可设置该项目的自动整理。';return;}
  try{let snapshot=await hostRequest('workbench?'+new URLSearchParams({projectId}));if(!section.isConnected)return;checkbox.checked=snapshot.autoOrganize;checkbox.disabled=false;feedback.textContent='';
    checkbox.addEventListener('change',async()=>{checkbox.disabled=true;try{snapshot=await hostRequest('workbench/save',{projectId,revision:snapshot.revision,autoOrganize:checkbox.checked});channel.postMessage({projectId});feedback.textContent='当前项目自动整理设置已保存。';}catch(error){checkbox.checked=snapshot.autoOrganize;feedback.textContent=error.message;}finally{checkbox.disabled=false;}});
  }catch{feedback.textContent='项目设置读取失败，请重新打开设置。';}
}
new MutationObserver(()=>{for(const section of document.querySelectorAll('[data-secretary-preferences]'))if(!mounted.has(section)){mounted.add(section);void mount(section);}}).observe(document.body,{childList:true,subtree:true});
window.addEventListener('submit',async event=>{const form=event.target;if(!form.matches('[data-secretary-template]'))return;event.preventDefault();event.stopImmediatePropagation();const button=form.querySelector('button');button.disabled=true;try{await hostRequest('secretary/preferences',{notesTemplate:form.elements.notesTemplate.value});form.querySelector('[data-template-feedback]').textContent='模板已保存，下次整理使用。';}catch(error){form.querySelector('[data-template-feedback]').textContent=error.message;}finally{button.disabled=false;}},true);
