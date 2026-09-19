import { streamChat } from './host-client.mjs';
import { renderMarkdown } from './markdown.mjs';
import './workspace.mjs';

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
  const model = window.ScienceScopeModels?.selected();
  if (!model || !window.ScienceScopeModels.available()) { toast('请先在模型与 API 中连接服务并选择模型。'); go('models'); return false; }
  const chatId = options.targetChat || V.chat;
  const thread = window.ScienceScopeWorkspace?.resolveThread(chatId) || S.threads.find(t => t.id === chatId);
  if (!thread || V.pending.has(chatId)) return false;
  if (annotations.length || (getThreadData(chatId).contextRefs || []).length) { toast('材料与批注的真实发送尚未接通；本次请先使用纯文本。'); return false; }
  if (!text.trim()) return false;
  try { await window.ScienceScopeWorkspace?.beforeSend(chatId); }
  catch(error) {toast(error.message);return false;}
  const inputBefore = S.drafts.main;
  const userId = uid('msg'); const answerId = uid('msg');
  saveThread(); V.pending.add(chatId);
  let accepted = false;
  const toolNames = new Map();
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
    await streamChat({projectId:thread.projectId || null, chatId, model, text,reasoningEffort:window.ScienceScopeReasoning?.value(),executionMode:window.ScienceScopeExecution?.mode()||'ask', title:thread.title==='新对话'?text.trim().slice(0,40):thread.title, userMessageId:userId, assistantMessageId:answerId, temporary:!!thread.temporary}, event => {
      if (event.type === 'accepted' && !accepted) {
        accepted = true;
        thread.model=model;
        window.ScienceScopeWorkspace?.accepted(thread,text);
        const d = data(); d.messages ??= [];
        d.messages.push({id:userId,role:'user',text,time:vtime()});
        d.messages.push({id:answerId,role:'assistant',name:'主专家',label:model.modelId,text:'',streaming:true,time:vtime()});
        d.messages=d.messages.slice(-60);
        if (chatId === V.chat && S.drafts.main === inputBefore) S.drafts.main = '';
        else if (d.draft === inputBefore) d.draft = '';
        refresh(); paint();
        const box = document.querySelector('.messages');
        if (chatId === V.chat && box) box.scrollTop = box.scrollHeight;
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
        if (event.type === 'tool-call') toolNames.set(event.callId,event.name);
        const receipt={id:uid('tool'),role:'system',text:event.type==='tool-call'
          ? `工具调用：${event.name}` : `工具${event.isError?'失败':'完成'}：${toolNames.get(event.callId)||'调用'}`,time:vtime()};
        data().messages.push(receipt);
        while(data().messages.length>60){
          const index=data().messages.findIndex(m=>m.id!==answerId);
          const [removed]=data().messages.splice(index,1);
          if(chatId===V.chat)document.getElementById('message-'+removed.id)?.remove();
        }
        if(chatId===V.chat){
          const box=document.querySelector('.messages');
          const follow=box&&box.scrollHeight-box.scrollTop-box.clientHeight<90;
          box?.insertAdjacentHTML('beforeend',messageHTML(receipt));
          if(follow)box.scrollTop=box.scrollHeight;
        }
      }
    });
    thread.updated = vtime();
    return true;
  } catch(error) {
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
    if (answer) answer.streaming = false;
    paint(); saveThread();
    if (chatId === V.chat) document.querySelector('[data-composer="main"] .queue-badge')?.remove();
    if(accepted)await window.ScienceScopeWorkspace?.settled(chatId);
  }
};
window.SS.submitMain = submitMain;
window.SSV2.submit = submitMain;
render();
