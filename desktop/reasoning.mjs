import './workspace.mjs';
import {hostRequest} from './host-client.mjs';
import {composerMenu} from './composer-menu.mjs';
const selections=new Map();
const key=()=>JSON.stringify([V.chat,window.ScienceScopeModels?.selected()]);
function paint(){
  const selected=selections.get(key());S.settings.reasoning=selected?.name||'模型默认';
  document.querySelectorAll('[data-v="reasoning-menu"]').forEach(el=>el.textContent=S.settings.reasoning);
}
async function open(trigger){
  if(V.pending.has(V.chat))return toast('请等当前回复完成后调整思考强度。');
  const model=window.ScienceScopeModels?.selected();if(!model)return toast('请先选择模型。');
  const target=key();
  try{
    const info=await hostRequest('model-info?'+new URLSearchParams(model));
    if(target!==key()||!trigger.isConnected)return;
    const efforts=info.reasoning?.efforts||[];
    composerMenu(trigger,'思考强度',[
      {id:'',name:'模型默认',description:efforts.length?'使用此模型的默认思考设置。':'当前运行时未声明可调整的强度，保持模型默认。'},...efforts
    ].map(item=>({label:item.name,description:item.description,action:'choose-reasoning',attrs:`data-effort="${esc(item.id)}" data-effort-name="${esc(item.name)}"`,selected:(selections.get(target)?.id||'')===item.id})));
  }catch(error){toast(error.message);}
}
window.addEventListener('click',event=>{
  const el=event.target.closest('[data-v="choose-reasoning"]');if(!el)return;
  event.preventDefault();event.stopImmediatePropagation();
  selections.set(key(),{id:el.dataset.effort,name:el.dataset.effortName});
  closeMenu();paint();
},true);
const after=window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender=(...args)=>{after?.(...args);paint();};
window.ScienceScopeReasoning={open,value:()=>selections.get(key())?.id||undefined,setDefault(effort){selections.set(key(),{id:effort||'',name:effort||'模型默认'});paint();}};
