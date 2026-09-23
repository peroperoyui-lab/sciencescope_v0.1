import { streamChat, hostRequest } from './host-client.mjs';
import { renderMarkdown } from './markdown.mjs';
import './workspace.mjs';
import { recordTool, paintActivity } from './turn-activity.mjs';
import './main-outbox.mjs';
import './background-activity.mjs';
import './research-input.mjs';

const stopping = new Set();
const originalComposer = composer;
composer = function(scope='main', ...args) {
  const html = originalComposer(scope,...args);
  if(scope!=='main'||!V.pending.has(V.chat))return html;
  return html.replace(/(<button\b[^>]*data-v="send"[^>]*>)[\s\S]*?(<\/button>)/,(_whole,start,end)=>
    start.replace('data-v="send"','data-main-stop').replace(/aria-label="[^"]*"/,'aria-label="停止当前回复"')+'■'+end)
    .replace('正在提交',stopping.has(V.chat)?'正在停止':'正在运行');
};
function syncRunButton() {
  const button=document.querySelector('[data-composer="main"] .sendbtn');
  const busy=V.pending.has(V.chat);
  if(!button)return;
  button.toggleAttribute('data-main-stop',busy);
  if(busy)delete button.dataset.v;else button.dataset.v='send';
  button.innerHTML=busy?'■':ic('arrow');
  button.setAttribute('aria-label',busy?'停止当前回复':'发送');
  button.disabled=stopping.has(V.chat);
  window.ScienceScopeOutbox?.paint();
}
window.addEventListener('click',async event=>{
  if(!event.target.closest('[data-main-stop]'))return;
  event.preventDefault();event.stopImmediatePropagation();
  const chatId=V.chat;
  if(stopping.has(chatId))return;
  stopping.add(chatId);syncRunButton();
  try {await hostRequest('chat/stop',{chatId,temporary:!!activeThread()?.temporary});}
  catch(error){toast(error.message);}
  finally {stopping.delete(chatId);syncRunButton();}
},true);

// Only Main text is wired in this increment. Do not pretend demo discussion or
// secretary actions execute real agents. The original design remains untouched.
exampleMessages = () => [];
S.settings.mode = '询问';
S.settings.reasoning = '模型默认';
window.addEventListener('click', event => {
  const button = event.target.closest('[data-v="mode-menu"],[data-v="reasoning-menu"]');
  if (!button) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if(button.dataset.v==='mode-menu'&&window.ScienceScopeExecution)return window.ScienceScopeExecution.openMenu(button);
  if(button.dataset.v==='reasoning-menu')return window.ScienceScopeReasoning?.open(button);
},true);
submitMain = async function(text, annotations = S.annotations, options = {}) {
  const model = options.snapshot?.model || window.ScienceScopeModels?.selected();
  if (!model || !window.ScienceScopeModels.available()) { toast('请先在模型与 API 中连接服务并选择模型。'); go('models'); return false; }
  const chatId = options.targetChat || V.chat;
  const thread = window.ScienceScopeWorkspace?.resolveThread(chatId) || S.threads.find(t => t.id === chatId);
  if (!thread || V.pending.has(chatId)) return false;
  let researchInput;
try{researchInput=options.outboxId?{attachmentIds:[],messageQuotes:[],annotations:[],contextRefs:[]}:await window.ScienceScopeResearchInput.capture('main',chatId);if(!options.outboxId){const legacy=getThreadData(chatId).contextRefs||[];for(const ref of legacy){if(ref.messageId&&ref.chatId&&ref.text)researchInput.messageQuotes.push({id:ref.id,revision:0,sourceChatId:ref.chatId,sourceMessageId:ref.messageId,selectedText:ref.text});else throw new Error('旧材料引用没有真实原件标识，请移除后重新附加；草稿已保留。');}researchInput.annotations.push(...await window.ScienceScopeResearchInput.legacyAnnotations(annotations,thread.projectId));}}catch(error){toast(error.message);return false;}
  if (!text.trim()) return false;
  const inputBefore = chatId===V.chat ? S.drafts.main : chatData[chatId]?.draft;
  const reasoningEffort=options.snapshot?.reasoningEffort??window.ScienceScopeReasoning?.value();
  const executionMode=options.snapshot?.executionMode||window.ScienceScopeExecution?.mode()||'ask';
  try { await window.ScienceScopeWorkspace?.beforeSend(chatId); }
  catch(error) {toast(error.message);return false;}
  if(V.pending.has(chatId))return false;
  const userId = options.snapshot?.userMessageId || uid('msg'); const answerId = options.snapshot?.assistantMessageId || uid('msg');
  saveThread(); V.pending.add(chatId);
  let accepted = false;
  syncRunButton();
  const data = () => chatId === V.chat ? S : chatData[chatId];
  const refresh = () => { if (chatId === V.chat) { saveThread(); render(); } };
  let paintTimer;
  const paint = () => {
    paintTimer = undefined;
    if (chatId !== V.chat) return;
    const message = document.getElementById(`message-${answerId}`);
    const body = message?.querySelector('.message-text');
    const box = document.querySelector('.messages');
    const follow = box && box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    const answer = data().messages?.find(m => m.id === answerId);
    if (body && answer) body.innerHTML = renderMarkdown(answer.text);
    message?.toggleAttribute('data-streaming', V.pending.has(chatId));
    if (follow) box.scrollTop = box.scrollHeight;
  };
  try {
    await streamChat({projectId:thread.projectId || null, chatId, model, text,researchInput,reasoningEffort,executionMode, title:thread.title==='新对话'?text.trim().slice(0,40):thread.title, userMessageId:userId, assistantMessageId:answerId, temporary:!!thread.temporary,...(options.outboxId?{outboxId:options.outboxId}:{})}, event => {
      if (event.type === 'accepted' && !accepted) {
        const previousBox=chatId===V.chat?document.querySelector('.messages'):null;
        const previousTop=previousBox?.scrollTop || 0;
        const follow=previousBox&&previousBox.scrollHeight-previousBox.scrollTop-previousBox.clientHeight<90;
        accepted = true;
        if(!options.outboxId)void window.ScienceScopeResearchInput.accepted('main',chatId,researchInput).catch(error=>toast(error.message));
        void window.ScienceScopeActivity?.refresh();
        thread.model=model;
        window.ScienceScopeWorkspace?.accepted(thread,text);
        const d = data(); d.messages ??= [];
        if(!options.outboxId)d.contextRefs=(d.contextRefs||[]).filter(ref=>!researchInput.messageQuotes.some(q=>q.id===ref.id&&q.selectedText===ref.text));
        if(!options.outboxId)d.annotations=(d.annotations||[]).filter(a=>!researchInput.annotations.some(sent=>sent.id===a.id&&sent.revision===a.rev));
        d.messages.push({id:userId,role:'user',text,researchInput,time:vtime()});
        d.messages.push({id:answerId,role:'assistant',name:'主专家',label:model.modelId,text:'',streaming:true,time:vtime()});
        d.messages=d.messages.slice(-60);
        if (!options.outboxId) {
          if (chatId === V.chat && S.drafts.main === inputBefore) S.drafts.main = '';
          else if (d.draft === inputBefore) d.draft = '';
        }
        if(previousBox) {
          previousBox.insertAdjacentHTML('beforeend',d.messages.slice(-2).map(messageHTML).join(''));
          const retained=new Set(d.messages.map(message=>message.id));
          for(const node of previousBox.querySelectorAll(':scope > .message'))if(!retained.has(node.dataset.messageId))node.remove();
          const input=document.querySelector('[data-draft="main"]');
          if(!options.outboxId&&input&&input.value===inputBefore)input.value=S.drafts.main;
          saveThread();syncRunButton();
        }else refresh();
        paint();
        const box = document.querySelector('.messages');
        if (chatId === V.chat && box) box.scrollTop = !options.outboxId||follow ? box.scrollHeight : previousTop;
      }
      if(event.type==='goal-started'){
        data().messages=data().messages.filter(m=>m.id!==answerId);
        window.ScienceScopeExecution?.started(chatId,event.goal);refresh();
      }
      if (event.type === 'text-delta') {
        const answer = data().messages?.find(m => m.id === answerId);
        if (answer) answer.text += event.delta;
        // Update only this bubble at most 20 times/sec; never replace the
        // composer, an open menu, selection or another chat on each token.
        paintTimer ??= setTimeout(paint, 50);
      }
      if (event.type === 'text-reset' || event.type === 'text-replace') {
        const answer = data().messages?.find(m => m.id === answerId);
        if (answer) answer.text = event.text || '';
        paintTimer ??= setTimeout(paint, 50);
      }
      if (event.type === 'tool-call' || event.type === 'tool-result') {
        const answer=data().messages?.find(m=>m.id===answerId);
        if(!answer)return;
        recordTool(answer,event);
        if(chatId===V.chat){
          const box=document.querySelector('.messages');
          const follow=box&&box.scrollHeight-box.scrollTop-box.clientHeight<90;
          paintActivity(answer);
          if(follow)box.scrollTop=box.scrollHeight;
        }
      }
      if(event.type==='cancelled') {
        const answer=data().messages?.find(m=>m.id===answerId);
        if(answer) {
          if(typeof event.text==='string')answer.text=event.text;
          if(!answer.text)answer.text='已停止。';
          answer.cancelled=true;
        }
      }
      if(event.type==='completed' && typeof event.text==='string' && !event.background) {
        const answer=data().messages?.find(m=>m.id===answerId);
        if(answer)answer.text=event.text;
      }
    });
    thread.updated = vtime();
    return true;
  } catch(error) {
    if(accepted&&!options.outboxId)await window.ScienceScopeResearchInput.restore('main',chatId,researchInput).catch(()=>toast('材料草稿恢复失败；已发送快照仍保留在消息记录中，请检查后重试。'));
    // Acceptance cleared the composer; a failed turn gives the text back for
    // retry, but never overwrites anything the user typed in the meantime.
    if(accepted&&!options.outboxId) {
      if(chatId===V.chat) {
        const input=document.querySelector('[data-draft="main"]');
        if(!S.drafts.main&&!input?.value) {
          S.drafts.main=text;
          if(input)input.value=text;
        }
      } else if(chatData[chatId]&&!chatData[chatId].draft) chatData[chatId].draft=text;
    }
    if (accepted) {
      const receipt = {id:uid('error'),role:'system',text:error.message,time:vtime()};
      data().messages.push(receipt);
      if (chatId === V.chat) document.querySelector('.messages')?.insertAdjacentHTML('beforeend', messageHTML(receipt));
    }
    toast(error.message);
    return false;
  } finally {
    clearTimeout(paintTimer); V.pending.delete(chatId);
    const answer = data().messages?.find(m => m.id === answerId);
    if (answer) {
      answer.streaming = false;
      for(const call of answer.toolActivity || [])if(call.status==='running')call.status='interrupted';
    }
    if(answer && chatId===V.chat)paintActivity(answer);
    paint(); saveThread();
    syncRunButton();
    if (chatId === V.chat) document.querySelector('[data-composer="main"] .queue-badge')?.remove();
    if(accepted)await window.ScienceScopeWorkspace?.settled(chatId);
    void window.ScienceScopeActivity?.refresh();
    if(accepted&&!options.outboxId)void window.ScienceScopeOutbox?.settled(chatId);
  }
};
window.SS.submitMain = submitMain;
window.SSV2.submit = submitMain;
render();
