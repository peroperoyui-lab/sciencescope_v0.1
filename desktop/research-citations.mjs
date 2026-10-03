import {hostRequest} from './host-client.mjs';
import {extractCitationLabels} from './citation-parser.mjs';

// Enhance rendered assistant prose without changing model text or the message
// renderer. The observer only visits inserted/changed subtrees, so streaming a
// reply does not repeatedly walk the transcript.
const MAX_CACHE = 160;
const cache = new Map();
const usageCache = new Map();
const pending = new Map();
const unknown = new Map();
let citationChoices = [];
const ROOTS = '.message:not(.user) .message-text,.assistant-message:not(.user) .message-text';
const SKIP = 'pre,code,a,button,.ss-math-block,.ss-math-inline,[data-research-citation]';
const usageLabel = (memories, materials, entries) => `本轮用到 ${memories} 条记忆 · ${materials} 份资料${entries ? ` · ${entries} 条目` : ''}`;
const proposalLabel = count => `已提交 ${count} 条记忆提议，待你确认`;
const usageKey = (type,id) => `${type}\0${id}`;

function textNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !extractCitationLabels(node.nodeValue).length) return NodeFilter.FILTER_REJECT;
      return node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const found=[]; while (walker.nextNode()) found.push(walker.currentNode); return found;
}

function replaceCitations(root) {
  if (!root?.isConnected || !root.matches?.(ROOTS)) return;
  const projectId=targetFor(messageRoot(root)).projectId||'';
  for (const node of textNodes(root)) {
    const value=node.nodeValue, matches=extractCitationLabels(value);
    for(const match of matches)if(match.parseStatus!=='parsed')recordUnknown(match.raw,match.unrecognized,messageRoot(root));
    const unresolved=matches.filter(match=>match.parseStatus==='parsed'&&!(cache.has(`${projectId}\0${match.raw}`)&&cache.get(`${projectId}\0${match.raw}`)===null));
    if (!unresolved.length) continue;
    const fragment=document.createDocumentFragment(); let offset=0;
    for (const match of matches) {
      if (match.start>offset) fragment.append(document.createTextNode(value.slice(offset,match.start)));
      const label=match.raw, key=`${projectId}\0${label}`;
      if(match.parseStatus!=='parsed'||cache.has(key)&&cache.get(key)===null){fragment.append(document.createTextNode(label));offset=match.end;continue;}
      const chip=document.createElement('button');
      chip.type='button'; chip.className='research-citation-chip'; chip.dataset.researchCitation=''; chip.dataset.label=label;
      chip.setAttribute('aria-label',label);
      chip.textContent=label; fragment.append(chip); offset=match.end;
    }
    if(offset<value.length)fragment.append(document.createTextNode(value.slice(offset)));
    node.replaceWith(fragment);
  }
}

function recordUnknown(raw,reasons,message) {
  const context=targetFor(message),key=`${context.chatId}\0${raw}`;
  if(unknown.has(key))return;
  const record={raw,unrecognized:reasons,chatId:context.chatId,projectId:context.projectId};
  unknown.set(key,record);while(unknown.size>MAX_CACHE)unknown.delete(unknown.keys().next().value);
  window.dispatchEvent(new CustomEvent('sciencescope:unrecognized-citation',{detail:record}));
}

function messageRoot(node) { return node?.closest?.('.message:not(.user),.assistant-message:not(.user)'); }
function targetFor(message) {
  const assistantSurface=message.closest('.assistant-surface');
  if(assistantSurface){
    const scope=assistantSurface.dataset.scope,ownerId=assistantSurface.dataset.owner;
    const entry=window.ScienceScopeAssistants?.entry?.(scope,ownerId),chat=entry?.chat?.chat||entry?.chat;
    const thread=scope==='secretary'?window.ScienceScopeWorkspace?.resolveThread?.(ownerId):null;
    return {chatId:chat?.id||entry?.chat?.chatId||'',projectId:thread?.projectId||chat?.projectId||null};
  }
  const projectId=(typeof activeThread==='function'?activeThread()?.projectId:null)??null;
  return {chatId:(typeof V!=='undefined'?V.chat:'')||'',projectId};
}
function cacheSet(key,value) {
  cache.delete(key); cache.set(key,value);
  while(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value);
}
function usageCacheSet(key,value) {
  usageCache.delete(key);usageCache.set(key,value);
  while(usageCache.size>MAX_CACHE)usageCache.delete(usageCache.keys().next().value);
}
async function citationDetails(chip) {
  const label=chip.dataset.label, message=messageRoot(chip), {projectId}=targetFor(message);
  const key=`${projectId||''}\0${label}`;
  if(cache.has(key))return cache.get(key);
  if(pending.has(key))return pending.get(key);
  const query=new URLSearchParams({label}); if(projectId)query.set('projectId',projectId);
  const task=(async()=>{
    const result=await hostRequest(`research/cite?${query}`);
    const citations=result.citations??(result.citation?[result.citation]:[]);
    if(result.parseStatus&&result.parseStatus!=='parsed'||!citations.length){recordUnknown(label,result.unrecognized??[{raw:label,reason:'not-found'}],message);cacheSet(key,null);return null;}
    const entries=await Promise.all(citations.map(async citation=>{
      let read=null;
      try { read=await hostRequest('research/read',{ref:citation.ref,page:citation.page??citation.fromPage,maxChars:1200}); } catch {}
      const source=citation.source||read?.source,item=citation.item||read?.item;
      return {citation,title:source?.title||item?.title||label,snippet:(read?.text||read?.body||item?.body||'').replace(/^\s*\[p\.\d+\]\s*/u,'').replace(/\s+/gu,' ').trim().slice(0,320)};
    }));
    const detail={...entries[0],entries,title:entries.map(entry=>entry.title).join(' · '),snippet:entries.map(entry=>entry.snippet).filter(Boolean).join('\n')};
    cacheSet(key,detail); return detail;
  })().finally(()=>pending.delete(key));
  pending.set(key,task); return task;
}

function setTooltip(chip,detail) {
  const title=detail?.title||'', snippet=detail?.snippet||'';
  chip.title=snippet?`${title}\n${snippet}`:title;
  chip.dataset.tooltip=snippet?`${title}\n${snippet}`:title;
  chip.setAttribute('aria-label',snippet?`${chip.dataset.label}: ${title}. ${snippet}`:title||chip.dataset.label);
}

function keepUnknownAsText(chip) {
  if(chip?.isConnected)chip.replaceWith(document.createTextNode(chip.dataset.label||chip.textContent||''));
}

async function usageRecord(ref) {
  const key=usageKey(ref.type,ref.id);
  if(usageCache.has(key))return usageCache.get(key);
  let detail=null;
  if(ref.type==='source'){
    const {source}=await hostRequest(`research/source?${new URLSearchParams({id:ref.id})}`);
    detail={kind:'source',id:source.id,refType:ref.type,refId:ref.id,label:`[${source.label}]`,title:source.title,source,resourceId:source.resourceId};
  } else if(ref.type==='chunk'){
    const read=await hostRequest('research/read',{ref:{type:'chunk',id:ref.id},maxChars:700});
    const source=read.source,page=/^\s*\[p\.(\d+)\]/u.exec(read.text||'')?.[1];
    detail={kind:'source',id:source.id,refType:ref.type,refId:ref.id,label:`[${source.label}]`,title:source.title,source,resourceId:source.resourceId,page:page?Number(page):undefined,highlight:(read.text||'').replace(/^\s*\[p\.\d+\]\s*/u,'').slice(0,260)};
  } else if(ref.type==='item'){
    const read=await hostRequest('research/read',{ref:{type:'item',id:ref.id},maxChars:700}),item=read.item;
    detail={kind:item?.type==='memory'?'memory':'entry',id:item.id,refType:ref.type,refId:ref.id,label:`[@${item.handle}]`,title:item.title,item};
  }
  if(detail)usageCacheSet(key,detail);
  return detail;
}

async function openCitation(chip) {
  const detail=await citationDetails(chip); if(!detail){keepUnknownAsText(chip);return;}
  if(detail.entries.length>1){
    citationChoices=detail.entries;
    menu(detail.entries.map((entry,index)=>({text:`${entry.citation.normalized||entry.citation.raw||''} ${entry.title}`,act:'citation-choice',attrs:`data-citation-choice="${index}"`})),chip,'选择引用来源');
    document.querySelectorAll('#v-menu [data-citation-choice] .menu-text').forEach(label=>label.dataset.i18nSkip='');
    return;
  }
  await openCitationEntry(detail.entries[0]);
}
async function openCitationEntry(detail) {
  const citation=detail.citation, ref=citation.ref;
  if(ref?.type==='item') {
    await window.ScienceScopeResearchBase?.openItem?.(ref.id); return;
  }
  const source=citation.source||detail.source||{};
  const resourceId=source.resourceId;
  if(resourceId)await window.ScienceScopePreview?.open?.(resourceId,{page:citation.page||undefined,highlight:detail.snippet||undefined});
}

function proposalCount(message) {
  const calls=[...message.querySelectorAll('.turn-activity [data-tool-call]')];
  return calls.filter(call=>{
    const name=call.querySelector(':scope > summary span')?.textContent?.trim();
    const status=call.querySelector(':scope > summary small')?.textContent?.trim()||'';
    return name==='research_propose'&&/^(?:完成|completed|done|success)$/iu.test(status);
  }).length;
}

function usageHost(message) {
  let host=message.querySelector('.research-message-extras');
  if(!host){host=document.createElement('div');host.className='research-message-extras';host.dataset.researchMessageExtras='';
    const body=message.querySelector('.messagebody'); (body||message).append(host);
  }
  return host;
}

function usageSummary(records) {
  const memories=new Set(),materials=new Set(),entries=new Set();
  for(const detail of records) {
    if(detail?.kind==='memory')memories.add(detail.id);
    else if(detail?.kind==='source')materials.add(detail.id);
    else if(detail?.kind==='entry')entries.add(detail.id);
  }
  return usageLabel(memories.size,materials.size,entries.size);
}

async function loadUsage(message,details) {
  const {chatId}=targetFor(message),messageId=message.dataset.messageId||message.dataset.assistantMessage;
  if(!chatId||!messageId)return;
  const signature=`${chatId}\0${messageId}`;
  if(message.dataset.researchUsageLoaded===signature||details.dataset.loaded===signature)return;
  const surface=message.closest('.assistant-surface');
  const entry=surface&&window.ScienceScopeAssistants?.entry?.(surface.dataset.scope,surface.dataset.owner);
  if(message.matches('[data-streaming]')||entry?.running||entry?.sending)return;
  details.dataset.loaded=signature;
  try {
    const {refs=[]}=await hostRequest(`research/usage?${new URLSearchParams({chatId,messageId})}`);
    if(!message.isConnected||details.dataset.loaded!==signature)return;
    message.dataset.researchUsageLoaded=signature;
    if(!refs.length){details.remove();return;}
    const records=await Promise.all(refs.slice(0,80).map(async ref=>{
      try { const record=await usageRecord(ref);return record?{...record,how:new Set(ref.how?[ref.how]:[])}:null; }
      catch { return null; }
    }));
    if(!message.isConnected||details.dataset.loaded!==signature)return;
    const distinct=[];const seenRecords=new Set();
    for(const record of records){
      if(!record)continue;
      const key=`${record.kind}\0${record.id}`,existing=distinct.find(item=>`${item.kind}\0${item.id}`===key);
      if(existing){for(const how of record.how)existing.how.add(how);continue;}
      if(seenRecords.has(key))continue;seenRecords.add(key);distinct.push(record);
    }
    const summary=details.querySelector('summary'); summary.textContent=usageSummary(distinct);
    const list=document.createElement('ul'); list.className='research-usage-list';
    for(const record of distinct) {
      const li=document.createElement('li'),button=document.createElement('button');
      button.type='button';button.className='research-usage-link';button.dataset.usageType=record.refType;button.dataset.usageId=record.refId;
      button.textContent=`${record.label} ${record.title||''}${record.how.size?` · ${[...record.how].join(', ')}`:''}`.trim();li.append(button);list.append(li);
    }
    details.append(list);
  } catch { details.remove(); }
}

function enhanceMessage(message) {
  if(!message?.isConnected||message.matches('.user,.receipt'))return;
  const text=message.querySelector('.message-text'); if(text)replaceCitations(text);
  const host=usageHost(message);
  let usage=host.querySelector('[data-research-usage]');
  if(!usage&&!message.dataset.researchUsageLoaded){usage=document.createElement('details');usage.className='research-usage';usage.dataset.researchUsage='';const summary=document.createElement('summary');summary.textContent='本轮用到的资料';usage.append(summary);host.append(usage);}
  const id=message.dataset.messageId||message.dataset.assistantMessage;
  if(id&&usage&&!usage.dataset.loaded)void loadUsage(message,usage);
  const count=proposalCount(message);
  let notice=host.querySelector('[data-research-proposal-notice]');
  if(count){
    if(!notice){notice=document.createElement('button');notice.type='button';notice.className='research-proposal-notice';notice.dataset.researchProposalNotice='';host.append(notice);void window.ScienceScopeResearchBase?.refreshInbox?.(true);}
    notice.dataset.count=String(count);const label=proposalLabel(count);if(notice.textContent!==label)notice.textContent=label;
  }else notice?.remove();
}

function scan(node) {
  if(!(node instanceof Element))return;
  if(node.closest('.research-message-extras'))return;
  if(node.matches('.message:not(.user),.assistant-message:not(.user)'))enhanceMessage(node);
  else {const message=messageRoot(node);if(message)enhanceMessage(message);for(const child of node.querySelectorAll('.message:not(.user),.assistant-message:not(.user)'))enhanceMessage(child);}
}

window.ScienceScopeCitations=Object.freeze({unrecognized:()=>[...unknown.values()],refresh(root=document){
  if(root.matches?.('.message:not(.user),.assistant-message:not(.user)'))enhanceMessage(root);
  else for(const message of root.querySelectorAll?.('.message:not(.user),.assistant-message:not(.user)')||[])enhanceMessage(message);
}});

document.addEventListener('pointerover',event=>{
  const chip=event.target.closest?.('[data-research-citation]'); if(!chip||chip.contains(event.relatedTarget))return;
  void citationDetails(chip).then(detail=>{if(!detail)keepUnknownAsText(chip);else if(chip.isConnected)setTooltip(chip,detail);}).catch(()=>{if(chip.isConnected)setTooltip(chip,null);});
},true);
document.addEventListener('focusin',event=>{
  const chip=event.target.closest?.('[data-research-citation]');if(!chip)return;
  void citationDetails(chip).then(detail=>{if(!detail)keepUnknownAsText(chip);else if(chip.isConnected)setTooltip(chip,detail);}).catch(()=>{if(chip.isConnected)setTooltip(chip,null);});
},true);
window.addEventListener('click',event=>{
  const choice=event.target.closest?.('[data-citation-choice]');
  if(choice){event.preventDefault();event.stopImmediatePropagation();const detail=citationChoices[Number(choice.dataset.citationChoice)];closeMenu();citationChoices=[];if(detail)void openCitationEntry(detail).catch(error=>toast(error.message));return;}
  const usage=event.target.closest?.('[data-usage-type]');
  if(usage){
    event.preventDefault();event.stopImmediatePropagation();
    const detail=usageCache.get(usageKey(usage.dataset.usageType,usage.dataset.usageId));
    if(detail?.kind==='source'&&detail.resourceId)void window.ScienceScopePreview?.open?.(detail.resourceId,{page:detail.page,highlight:detail.highlight});
    else if(detail?.item)void window.ScienceScopeResearchBase?.openItem?.(detail.item.id);
    return;
  }
  const chip=event.target.closest?.('[data-research-citation]');
  if(chip){event.preventDefault();event.stopImmediatePropagation();void openCitation(chip).catch(error=>toast(error.message));return;}
  const notice=event.target.closest?.('[data-research-proposal-notice]');
  if(notice){event.preventDefault();event.stopImmediatePropagation();void window.ScienceScopeResearchBase?.openInbox?.();}
},true);
document.addEventListener('toggle',event=>{
  const details=event.target.closest?.('[data-research-usage]');if(details?.open)void loadUsage(messageRoot(details),details);
},true);

new MutationObserver(records=>{
  for(const record of records){
    if(record.target instanceof Element&&record.target.closest('.research-message-extras'))continue;
    if(record.target.parentElement?.closest?.('.research-message-extras'))continue;
    if(record.type==='characterData'){scan(record.target.parentElement);continue;}
    for(const node of record.addedNodes)scan(node);
    if(record.target instanceof Element){const message=messageRoot(record.target);if(message)enhanceMessage(message);}
  }
}).observe(document.body,{childList:true,subtree:true,characterData:true});

queueMicrotask(()=>window.ScienceScopeCitations.refresh());
