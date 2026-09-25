import {infoTip} from './info-tip.mjs';
import {hostRequest} from './host-client.mjs';

export function secretaryPreferencesContent(){return `<section data-secretary-preferences><h2>文献版本整理</h2><form data-secretary-template><label>版本说明模板 · Markdown${infoTip('用于下一次整理说明；不会重写已有说明或原件。', {label: '模板说明'})}<textarea name="notesTemplate" maxlength="16000" required rows="8" disabled></textarea></label><button class="btn" type="submit" disabled>保存模板</button><p data-template-feedback role="status"></p></form><label><input type="checkbox" data-secretary-organize disabled> 导入材料后自动整理当前项目的版本说明${infoTip('只影响当前项目；整理会使用已选择的模型并产生 API 用量。', {label: '自动整理说明'})}</label><p data-organize-feedback role="status"></p></section>`;}
const mounted=new WeakSet(),channel=new BroadcastChannel('sciencescope-workbench');
async function mount(section){
  try{const preferences=await hostRequest('secretary/preferences');if(!section.isConnected)return;section.querySelector('textarea').value=preferences.notesTemplate;section.querySelector('textarea').disabled=false;section.querySelector('[type="submit"]').disabled=false;}catch{section.querySelector('[data-template-feedback]').textContent='模板读取失败，请重新打开设置。';}
  const projectId=S.projectId,checkbox=section.querySelector('[data-secretary-organize]'),feedback=section.querySelector('[data-organize-feedback]');
  if(!projectId){feedback.textContent='进入一个项目后可设置该项目的自动整理。';return;}
  try{let snapshot=await hostRequest('workbench?'+new URLSearchParams({projectId}));if(!section.isConnected)return;checkbox.checked=snapshot.autoOrganize;checkbox.disabled=false;feedback.textContent='';
    checkbox.addEventListener('change',async()=>{checkbox.disabled=true;try{snapshot=await hostRequest('workbench/save',{projectId,revision:snapshot.revision,autoOrganize:checkbox.checked});channel.postMessage({projectId});feedback.textContent='当前项目自动整理设置已保存。';}catch(error){checkbox.checked=snapshot.autoOrganize;feedback.textContent=error.message;}finally{checkbox.disabled=false;}});
  }catch{feedback.textContent='项目设置读取失败，请重新打开设置。';}
}
new MutationObserver(()=>{for(const section of document.querySelectorAll('[data-secretary-preferences]'))if(!mounted.has(section)){mounted.add(section);void mount(section);}}).observe(document.body,{childList:true,subtree:true});
window.addEventListener('submit',async event=>{const form=event.target;if(!form.matches('[data-secretary-template]'))return;event.preventDefault();event.stopImmediatePropagation();const button=form.querySelector('button');button.disabled=true;try{await hostRequest('secretary/preferences',{notesTemplate:form.elements.notesTemplate.value});form.querySelector('[data-template-feedback]').textContent='模板已保存，下次整理使用。';}catch(error){form.querySelector('[data-template-feedback]').textContent=error.message;}finally{button.disabled=false;}},true);
