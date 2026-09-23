// Expert discussion for the Main composer. "有序讨论" sends one frozen input to
// every enabled expert in parallel and shows answers in roster order; "自由讨论"
// sends only to experts named with @label or @id. Experts run as DSH subagents
// of this chat's session (see /api/discussion). The approved layout is kept:
// answers are ordinary transcript messages whose author is the expert.
import './live-chat.mjs';
import './work-mode.mjs';
import {hostRequest, streamChat} from './host-client.mjs';
import {renderMarkdown} from './markdown.mjs';

let roster = [];
let available = false;
async function loadRoster() {
  try { ({experts: roster, available} = await hostRequest('experts')); }
  catch { roster = []; available = false; }
  return roster;
}
const enabled = () => roster.filter(expert => expert.enabled);
const mode = (chatId = V.chat) => window.ScienceScopeWorkMode?.get(chatId) || 'work';

// @mentions use the stable id or the current label; the longest name wins so
// "@统计" never shadows "@统计审稿人".
export function mentionedExperts(text, experts) {
  const names = experts.flatMap(expert => [[expert.label, expert.id], [expert.id, expert.id]]).sort((a, b) => b[0].length - a[0].length);
  const found = new Set();
  for (const match of String(text).matchAll(/@([^\s@,，。;；:：!?！？]+)/gu)) {
    const token = match[1];
    const hit = names.find(([name]) => token.startsWith(name));
    if (hit) found.add(hit[1]);
  }
  return experts.filter(expert => found.has(expert.id)).map(expert => expert.id);
}

async function submitDiscussion(text, {kind = 'independent'} = {}) {
  const chatId = V.chat;
  const model = window.ScienceScopeModels?.selected();
  if (!model || !window.ScienceScopeModels.available()) { toast('请先在模型与 API 中连接服务并选择模型。'); go('models'); return false; }
  const thread = window.ScienceScopeWorkspace?.resolveThread(chatId) || S.threads.find(t => t.id === chatId);
  if (!thread || V.pending.has(chatId)) return false;
  if (thread.temporary) { toast('临时对话不支持专家讨论。'); return false; }
  await loadRoster();
  if (!available) { toast('当前运行时不支持专家讨论。'); return false; }
  const expertIds = mode(chatId) === 'free' ? mentionedExperts(text, enabled()) : enabled().map(expert => expert.id);
  if (!expertIds.length) { toast(mode(chatId) === 'free' ? '自由讨论请用 @专家名 点名，例如 @' + (enabled()[0]?.label || '方法学家') + '。' : '专家名册中没有启用的专家。'); return false; }
  if (kind === 'independent' && !text.trim()) return false;
  let researchInput = {attachmentIds: [], messageQuotes: [], annotations: [], contextRefs: []};
  if (kind === 'independent') {
    try { researchInput = await window.ScienceScopeResearchInput.capture('main', chatId); }
    catch (error) { toast(error.message); return false; }
  }
  const inputBefore = S.drafts.main;
  try { await window.ScienceScopeWorkspace?.beforeSend(chatId); } catch (error) { toast(error.message); return false; }
  if (V.pending.has(chatId)) return false;
  const userId = uid('msg');
  const data = () => chatId === V.chat ? S : chatData[chatId];
  saveThread(); V.pending.add(chatId); window.ScienceScopeMainRun?.sync();
  let accepted = false; const placeholders = new Map(); const pendingPaint = new Set();
  const paintAnswer = (messageId) => {
    if (chatId !== V.chat) return;
    const node = document.getElementById(`message-${messageId}`);
    const answer = data().messages?.find(m => m.id === messageId);
    if (!node || !answer) return;
    const box = document.querySelector('.messages');
    const follow = box && box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    node.querySelector('.message-text').innerHTML = renderMarkdown(answer.text || (answer.streaming ? (answer.activity ? `正在使用工具：${answer.activity}…` : '正在作答…') : ''));
    node.toggleAttribute('data-streaming', !!answer.streaming);
    if (follow) box.scrollTop = box.scrollHeight;
  };
  try {
    await streamChat({chatId, projectId: thread.projectId || null, model, text, kind, expertIds, researchInput, userMessageId: userId,
      executionMode: window.ScienceScopeExecution?.mode() === 'full' ? 'full' : 'ask', title: thread.title === '新对话' ? (text.trim() || '专家讨论').slice(0, 40) : thread.title}, event => {
      if (event.type === 'accepted' && !accepted) {
        accepted = true;
        if (kind === 'independent') void window.ScienceScopeResearchInput.accepted('main', chatId, researchInput).catch(error => toast(error.message));
        thread.model = model; window.ScienceScopeWorkspace?.accepted(thread, text || '专家讨论');
        const d = data(); d.messages ??= [];
        const userText = kind === 'critique' ? (text.trim() ? `请专家互相质询：${text}` : '请专家互相质询。') : text;
        const added = [{id: userId, role: 'user', text: userText, researchInput, time: vtime()}];
        for (const expert of event.experts) {
          const message = {id: expert.messageId, role: 'assistant', name: expert.label, label: expert.model?.modelId || model.modelId, text: '', streaming: true, time: vtime(), expert: {expertId: expert.id, label: expert.label, role: expert.role, model: expert.model}};
          placeholders.set(expert.id, message.id); added.push(message);
        }
        d.messages.push(...added); d.messages = d.messages.slice(-60);
        if (kind === 'independent' && chatId === V.chat && S.drafts.main === inputBefore) S.drafts.main = '';
        const box = chatId === V.chat ? document.querySelector('.messages') : null;
        if (box) {
          box.insertAdjacentHTML('beforeend', added.map(messageHTML).join(''));
          const retained = new Set(d.messages.map(message => message.id));
          for (const node of box.querySelectorAll(':scope > .message')) if (!retained.has(node.dataset.messageId)) node.remove();
          const input = document.querySelector('[data-draft="main"]');
          if (kind === 'independent' && input && input.value === inputBefore) input.value = S.drafts.main;
          for (const message of added) if (message.role === 'assistant') paintAnswer(message.id);
          box.scrollTop = box.scrollHeight; saveThread();
        } else if (chatId === V.chat) { saveThread(); render(); }
      }
      if (event.type === 'expert-delta' || event.type === 'expert-reset' || event.type === 'expert-tool') {
        const answer = data().messages?.find(m => m.id === event.messageId);
        if (answer && answer.streaming) {
          if (event.type === 'expert-delta') answer.text += event.delta;
          else if (event.type === 'expert-reset') answer.text = '';
          else answer.activity = event.name;
          if (!pendingPaint.has(event.messageId)) { pendingPaint.add(event.messageId); setTimeout(() => { pendingPaint.delete(event.messageId); paintAnswer(event.messageId); }, 60); }
        }
      }
      if (event.type === 'expert-end') {
        const answer = data().messages?.find(m => m.id === event.messageId);
        if (answer) { answer.text = event.text; answer.streaming = false; answer.expert = {...answer.expert, stopReason: event.stopReason}; }
        paintAnswer(event.messageId);
      }
      if (event.type === 'completed' && event.failed) toast(`${event.failed} 位专家本轮未完成，可重试或调整名册。`);
    }, '/api/discussion');
    thread.updated = vtime();
    return true;
  } catch (error) {
    if (accepted && kind === 'independent') {
      await window.ScienceScopeResearchInput.restore('main', chatId, researchInput).catch(() => {});
      if (chatId === V.chat && !S.drafts.main) { S.drafts.main = text; const input = document.querySelector('[data-draft="main"]'); if (input && !input.value) input.value = text; }
    }
    toast(error.message); return false;
  } finally {
    V.pending.delete(chatId);
    for (const id of placeholders.values()) { const answer = data().messages?.find(m => m.id === id); if (answer?.streaming) { answer.streaming = false; paintAnswer(id); } }
    saveThread(); window.ScienceScopeMainRun?.sync();
    if (accepted) await window.ScienceScopeWorkspace?.settled(chatId);
    void window.ScienceScopeActivity?.refresh();
    paintStrip();
  }
}

const baseSubmit = submitMain;
submitMain = async function(text, annotations, options = {}) {
  if (options.outboxId || options.targetChat && options.targetChat !== V.chat || mode() === 'work') return baseSubmit(text, annotations, options);
  return submitDiscussion(text);
};
window.SS.submitMain = submitMain;
window.SSV2.submit = submitMain;

// Participants strip above the transcript, in the approved panelhead style.
function stripHTML() {
  const current = mode();
  const experts = enabled();
  const tags = experts.map((expert, index) => `<span class="tag ${current === 'ordered' ? 'fill' : ''}" title="${esc(expert.role || '')}">${current === 'ordered' ? `${index + 1} ` : '@'}${esc(expert.label)}</span>`).join('');
  const busy = V.pending.has(V.chat);
  return `<div class="panelhead discussion-strip" data-discussion-strip><div class="row"><small>${current === 'ordered' ? '发言顺序' : '可点名专家'}</small>${tags || '<small>名册为空</small>'}<span class="spacer"></span><button class="btn tiny" data-discussion-critique ${busy ? 'disabled' : ''} title="让专家看到上一轮全部回答后互相质询">互相质询</button></div></div>`;
}
function paintStrip() {
  const column = document.querySelector('.chatcol');
  const existing = column?.querySelector('[data-discussion-strip]');
  if (!column || mode() === 'work' || !available) { existing?.remove(); return; }
  const html = stripHTML();
  if (existing) { if (existing.outerHTML !== html) existing.outerHTML = html; return; }
  column.querySelector('.messages')?.insertAdjacentHTML('beforebegin', html);
}
window.addEventListener('click', event => {
  if (!event.target.closest('[data-discussion-critique]')) return;
  event.preventDefault(); event.stopImmediatePropagation();
  void submitDiscussion('', {kind: 'critique'});
}, true);
const after = window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender = (...args) => { after?.(...args); paintStrip(); };
// Mode changes happen in work-mode.mjs without a full render.
window.addEventListener('sciencescope-work-mode', () => { void loadRoster().then(paintStrip); });
window.ScienceScopeDiscussion = Object.freeze({roster: () => roster, reload: async () => { await loadRoster(); paintStrip(); return roster; }, mentionedExperts});
void loadRoster().then(paintStrip);
