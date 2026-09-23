let current=null;
let trigger=null;
function normalized(value) {
  if(!value||!Number.isFinite(value.usedTokens)||value.usedTokens<0||!Number.isFinite(value.contextWindow)||value.contextWindow<=0)return null;
  return {...value,percent:Math.max(0,Math.min(100,100*value.usedTokens/value.contextWindow))};
}
function content(value) {
  const amount=value?`${Math.round(value.usedTokens).toLocaleString()} / ${Math.round(value.contextWindow).toLocaleString()} tokens`:'暂无数据';
  return `<strong>模型上下文</strong><div class="usage-stat"><span>当前占用${value?.estimated?'（估计）':''}</span><span>${value?value.percent.toFixed(1)+'%':'—'}</span></div><div class="meter"><i style="width:${value?.percent||0}%"></i></div><div class="usage-stat"><span>${amount}</span></div>`;
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
  box.style.top=Math.max(40,rect.top-box.offsetHeight-10)+'px';
};
window.ScienceScopeContext={update(chatId,value){current=chatId===V.chat?normalized(value):null;paint();}};
