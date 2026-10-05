let current=null,experts=[];
let trigger=null;
function normalized(value) {
  if(!value||!Number.isFinite(value.usedTokens)||value.usedTokens<0||!Number.isFinite(value.contextWindow)||value.contextWindow<=0)return null;
  return {...value,percent:Math.max(0,Math.min(100,100*value.usedTokens/value.contextWindow))};
}
const amountOf=value=>value?`${Math.round(value.usedTokens).toLocaleString()} / ${Math.round(value.contextWindow).toLocaleString()} tokens`:'暂无数据';
// The ring shows the Main expert; the popover adds every expert that has
// answered in this chat, measured when its latest answer ended (experts run
// as fresh agents each round, so this is what that round carried).
function content(value) {
  const main=`<strong>模型上下文</strong><div class="usage-stat"><span>主专家 · 当前${value?.estimated?'（估计）':''}</span><span>${value?value.percent.toFixed(1)+'%':'—'}</span></div><div class="meter"><i style="width:${value?.percent||0}%"></i></div><div class="usage-stat"><span>${amountOf(value)}</span></div>`;
  if(!experts.length)return main;
  return main+`<div class="usage-experts"><div class="usage-experts-head">专家 · 上一次作答结束时</div>${experts.map(expert=>{const v=expert.value;return `<div class="usage-expert"><div class="usage-stat"><span>${esc(expert.label)}${expert.model?.modelId?` <small>${esc(expert.model.modelId)}</small>`:''}</span><span>${v?v.percent.toFixed(1)+'%':'—'}</span></div><div class="meter"><i style="width:${v?.percent||0}%"></i></div><div class="usage-stat"><span>${amountOf(v)}${v?.estimated?'（估计）':''}</span></div></div>`;}).join('')}</div>`;
}
function paint() {
  for(const circle of document.querySelectorAll('.usage-ring')) {
    const value=circle.dataset.usage==='main'?current:null;
    circle.style.setProperty('--context-pct',`${value?.percent||0}%`);
    circle.dataset.contextKnown=String(!!value);
    circle.setAttribute('aria-label',value?`上下文占用 ${value.percent.toFixed(1)}%${value.estimated?'，估计值':''}`:'上下文占用暂无数据');
  }
  const pop=document.getElementById('usage-pop');
  if(pop&&trigger?.isConnected)pop.innerHTML=content(trigger.dataset.usage==='main'?current:null);
}
showUsage=function(element) {
  document.getElementById('usage-pop')?.remove();trigger=element;
  const box=document.createElement('div');box.id='usage-pop';box.className='usage-pop';box.role='tooltip';
  box.innerHTML=content(element.dataset.usage==='main'?current:null);document.body.append(box);
  const rect=element.getBoundingClientRect();
  box.style.left=Math.max(8,Math.min(innerWidth-310,rect.left))+'px';
  box.style.top=Math.max(8,rect.top-box.offsetHeight-10)+'px';
};
window.ScienceScopeContext={update(chatId,value,expertContexts=[]){const mine=chatId===V.chat;current=mine?normalized(value):null;experts=mine&&Array.isArray(expertContexts)?expertContexts.map(expert=>({...expert,value:normalized(expert.context)})):[];paint();}};
