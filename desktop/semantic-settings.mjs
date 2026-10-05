import {hostRequest} from './host-client.mjs';
import {infoTip} from './info-tip.mjs';

const states={disabled:'已关闭',warming:'正在预热模型',downloading:'正在下载模型',indexing:'正在建立索引',paused:'对话运行中，索引已暂停',ready:'混合检索就绪','model-missing':'模型未下载',unsupported:'未满足本地模型最低配置',error:'本地检索准备失败'};
let current=null,error='',pending=false,loading=false;
function body(){
  if(!current)return error?`<p role="alert">${esc(error)}</p>`:'<p role="status">正在读取检索状态…</p>';
  const hardware=current.hardware;
  const download=current.download;
  return `<p role="status">${esc(states[current.state]||current.state)}</p>
    <p><code>multilingual-e5-small · int8 · 384</code></p>
    ${hardware&&!hardware.supported?'<p role="alert">需要 AVX2、8 GB 内存及 5 GB 可用空间；当前使用关键词检索。</p>':''}
    ${current.enabled&&current.state!=='ready'?'<p>本次为关键词检索</p>':''}
    ${['indexing','paused','ready'].includes(current.state)?`<p><span>索引进度</span> ${current.indexed} / ${current.total}</p>`:''}
    ${download?`<p><span>下载进度</span> ${download.completed} / ${download.files}${download.bytes?` · ${(download.bytes/1048576).toFixed(1)} MB`:''}</p>`:''}
    ${current.error?`<p role="alert">${esc(current.error)}</p>`:''}${error?`<p role="alert">${esc(error)}</p>`:''}
    <div class="saverow">
    <button class="btn" data-semantic-action="${current.enabled?'disable':'enable'}" ${pending?'disabled':''}>${current.enabled?'关闭语义检索':'开启语义检索'}</button>
    <button class="btn" data-semantic-action="download" ${pending||current.state==='downloading'?'disabled':''}>下载或修复本地模型</button>
    <button class="btn" data-semantic-action="rebuild" ${pending||!current.enabled?'disabled':''}>重新检查索引</button>
    </div>`;
}
export function semanticSettingsContent(){return `<section><h2>本地混合检索${infoTip('模型仅在本机运行，首次下载需要明确点击。启动后后台预热；对话期间暂停建索引。模型缺失、索引未完成、版本不一致或向量阶段超过 300ms 时，整次退回关键词检索。索引可以重建，不会改动资料原件。',{label:'混合检索说明'})}</h2><div data-semantic-settings>${body()}</div></section>`;}
function repaint(){const container=document.querySelector('[data-semantic-settings]');if(container)container.innerHTML=body();}
async function refresh(){if(loading)return;loading=true;try{const next=await hostRequest('research/embedding');const changed=error||JSON.stringify(next)!==JSON.stringify(current);current=next;error='';if(changed)repaint();}catch(caught){error=caught.message;repaint();}finally{loading=false;}}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-semantic-action]');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();pending=true;repaint();
  void hostRequest('research/embedding',{action:button.dataset.semanticAction}).then(value=>{current=value;error='';}).catch(caught=>{error=caught.message;}).finally(()=>{pending=false;repaint();});
},true);
setInterval(()=>{if(document.querySelector('[data-semantic-settings]'))void refresh();},1000);
