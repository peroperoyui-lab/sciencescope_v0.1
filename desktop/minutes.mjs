// Conversation minutes (对话纪要): the task secretary updates them by the
// user's rules; every expert can read them through project_memory. The
// user can read, edit (the edit becomes the next revision the secretary builds
// on) or ask the secretary to update now. Opened from the chat's "…" menu.
import {hostRequest} from './host-client.mjs';
import {renderMarkdown} from './markdown.mjs';
import {infoTip} from './info-tip.mjs';

let editing = false, busy = false;
const open = () => document.querySelector('#modal .minutes-dialog');
const persisted = () => S.threads.some(thread => thread.id === V.chat);

function metaLine(data) {
  const m = data.minutes;
  if (!m) return '';
  const by = m.author === 'user' ? '由你编辑' : '任务秘书整理';
  return `${by} · 第 ${m.revision} 版 · 涵盖第 1–${m.throughOrdinal} 条（共 ${data.latestMessage} 条）`;
}

async function paint(chatId) {
  const root = open(); if (!root || root.dataset.chatId !== chatId) return;
  let data;
  try { data = await hostRequest(`chats/minutes?chatId=${encodeURIComponent(chatId)}`); }
  catch (error) { root.querySelector('[data-minutes-body]').textContent = error.message; return; }
  if (!open() || editing) return;
  root.dataset.revision = String(data.minutes?.revision ?? 0);
  root.querySelector('[data-minutes-meta]').textContent = [metaLine(data), data.updating ? '正在更新…' : ''].filter(Boolean).join(' · ');
  const remaining=data.summaryStatus||{},next=[];
  if(Number.isFinite(remaining.messagesRemaining))next.push(`再 ${remaining.messagesRemaining} 条消息`);
  if(Number.isFinite(remaining.tokensRemaining))next.push(`约 ${remaining.tokensRemaining} token`);
  root.querySelector('[data-minutes-next]').textContent=next.length?`下次自动总结：${next.join(' 或 ')}`:'';
  root.querySelector('[data-minutes-export]').textContent=data.exportStatus?.error||'';
  const body = root.querySelector('[data-minutes-body]');
  body.dataset.markdown = data.minutes?.text ?? '';
  body.innerHTML = '';
  if (data.minutes) body.innerHTML = renderMarkdown(data.minutes.text); // sanitized HTML (DOMPurify)
  else body.innerHTML = '<p class="minutes-empty">还没有纪要。</p>';
  root.querySelector('[data-minutes-edit]').disabled = !data.minutes;
  try{
    const result=await hostRequest('summary/writes?'+new URLSearchParams({chatId}));
    if(open()!==root||editing)return;
    const writes=result.writes||[],box=root.querySelector('[data-minutes-writes]');
    box.innerHTML=writes.length?`<h3>最近的工作站更新</h3>${writes.slice(0,20).map(item=>`<article><span>${esc(({map:'导图',versions:'稿件版本说明',plans:'计划',log:'日志'})[item.target]||item.target)} · <span data-i18n-skip>${esc(item.op?.title||item.op?.text||item.op?.nodeId||item.op?.planId||item.op?.versionId||'')}</span></span><button type="button" class="btn tiny" data-summary-undo="${esc(item.id)}" ${item.undoneAt?'disabled':''}>${item.undoneAt?'已撤销':'撤销'}</button></article>`).join('')}`:'';
  }catch(error){root.querySelector('[data-minutes-writes]').textContent=error.message;}
}

function show() {
  if (!persisted()) return toast('发送第一条消息后才会有纪要。');
  editing = false;
  const chatId = V.chat;
  modal('对话纪要', `<div class="minutes-dialog" data-chat-id="${esc(chatId)}">
    <p class="minutes-meta"><span data-minutes-meta>正在读取…</span>${infoTip('任务秘书按自动总结设置或手动请求更新纪要；没有新内容时不调用模型。所有专家都能读取纪要并按编号回查原文。\n你的修改会成为最新一版，秘书之后在此基础上继续整理。', {label: '对话纪要说明'})}</p>
    <p class="minutes-meta" data-minutes-next></p><p role="status" data-minutes-export></p>
    <div class="minutes-body rendered-markdown" data-minutes-body></div>
    <div class="minutes-summary-writes" data-minutes-writes></div>
    <div class="saverow"><button type="button" class="btn" data-minutes-refresh>让秘书更新</button><button type="button" class="btn" data-minutes-edit disabled>编辑</button><button type="button" class="btn primary" data-minutes-close>关闭</button></div>
  </div>`, 'minutes-modal');
  void paint(chatId);
}

window.addEventListener('click', async event => {
  const undo=event.target.closest('[data-summary-undo]');
  if(undo){event.preventDefault();event.stopImmediatePropagation();undo.disabled=true;
    try{const result=await hostRequest('summary/writes/undo',{id:undo.dataset.summaryUndo});const channel=new BroadcastChannel('sciencescope-workbench');channel.postMessage({projectId:result.projectId,plans:result.target==='plans'});channel.close();const chatId=open()?.dataset.chatId;if(chatId)await paint(chatId);}
    catch(error){const status=open()?.querySelector('[data-minutes-export]');if(status)status.textContent=error.message;undo.disabled=false;}return;}
  const root = open();
  const target = event.target.closest('[data-minutes-refresh],[data-minutes-edit],[data-minutes-save],[data-minutes-cancel],[data-minutes-close],[data-v="chat-minutes"]');
  if (!target) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (target.matches('[data-v="chat-minutes"]')) { closeMenu(); show(); return; }
  if (!root) return;
  const chatId = root.dataset.chatId, body = root.querySelector('[data-minutes-body]');
  if (target.matches('[data-minutes-close]')) { editing = false; document.getElementById('modal')?.remove(); return; }
  if (target.matches('[data-minutes-edit]')) {
    editing = true;
    body.innerHTML = `<textarea data-minutes-text aria-label="纪要内容" maxlength="100000"></textarea>`;
    body.querySelector('textarea').value = body.dataset.markdown || '';
    root.querySelector('.saverow').innerHTML = '<button type="button" class="btn" data-minutes-cancel>取消</button><button type="button" class="btn primary" data-minutes-save>保存纪要</button>';
    body.querySelector('textarea').focus();
    return;
  }
  if (target.matches('[data-minutes-cancel]')) { document.getElementById('modal')?.remove(); show(); return; }
  if (busy) return;
  busy = true; target.disabled = true;
  try {
    if (target.matches('[data-minutes-save]')) {
      await hostRequest('chats/minutes', {chatId, text: body.querySelector('textarea').value, expectedRevision: Number(root.dataset.revision) || 0});
      toast('纪要已保存；秘书之后会在此基础上继续整理。');
      document.getElementById('modal')?.remove(); show();
    } else {
      root.querySelector('[data-minutes-meta]').textContent = '任务秘书正在整理…';
      await hostRequest('chats/minutes/refresh', {chatId});
      await paint(chatId);
    }
  } catch (error) { toast(error.message); target.disabled = false; }
  finally { busy = false; }
}, true);

// "对话纪要" in the chat's "…" menu, after 查找当前对话.
if (typeof menu === 'function') {
  const baseMenu = menu;
  menu = function (items, trigger, ...rest) {
    if (trigger?.dataset?.v === 'workspace-menu' && persisted() && !items.some(item => item.act === 'chat-minutes')) {
      const at = items.findIndex(item => item.act === 'find-chat');
      items = [...items.slice(0, at + 1), {text: '对话纪要', act: 'chat-minutes', icon: 'file'}, ...items.slice(at + 1)];
    }
    return baseMenu(items, trigger, ...rest);
  };
}

window.ScienceScopeMinutes = Object.freeze({show});
