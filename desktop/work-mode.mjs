import './workspace.mjs';
import {hostRequest} from './host-client.mjs';
import {composerMenu} from './composer-menu.mjs';

// 2026-09-24: 自由讨论 was folded into 工作: @专家 invites experts there.
const labels={work:'工作',ordered:'有序讨论'};
const choices=new Map();
let saving=false;
function paint(){
  const selected=choices.get(V.chat)||'work';
  for(const button of document.querySelectorAll('[data-v="work-mode"],[data-action="work-mode"]'))
    button.innerHTML=esc(labels[selected])+' '+ic('down');
}
window.addEventListener('click',async event=>{
  const button=event.target.closest('[data-v="work-mode"],[data-action="work-mode"],[data-work-mode]');
  if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(V.pending.has(V.chat)||saving)return toast('请等待当前操作完成后切换工作方式。');
  if(!button.dataset.workMode){
    composerMenu(button,'工作方式',Object.entries(labels).map(([id,label])=>({label,selected:(choices.get(V.chat)||'work')===id,action:'desktop-work-mode',attrs:`data-work-mode="${id}"`,description:id==='work'?'主专家持续处理当前任务；输入 @专家名 可邀请专家回答。':'所选专家读取同一份前文后并行独立作答，按顺序展示；可设审核专家在最后核查。'})));
    return;
  }
  const id=V.chat,next=button.dataset.workMode;
  closeMenu();if(next===(choices.get(id)||'work'))return;
  saving=true;
  try{
    // No navigation to demo routes: that used to remount the transcript and
    // restore a scroll position belonging to a different route.
    if(S.threads.some(thread=>thread.id===id)){
      const result=await hostRequest('chats/mode',{chatId:id,mode:next,messageId:uid('mode')});
      if(id===V.chat)await window.ScienceScopeWorkspace.appendNotice(result.message);
    }else toast('此设置将用于本次界面；发送首条消息后才创建对话。');
    choices.set(id,next);if(id===V.chat)paint();
    window.dispatchEvent(new CustomEvent('sciencescope-work-mode',{detail:{chatId:id,mode:next}}));
  }catch(error){toast(error.message);}finally{saving=false;}
},true);
window.ScienceScopeWorkMode=Object.freeze({get:id=>choices.get(id)||'work'});
const after=window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender=(...args)=>{after?.(...args);paint();};
