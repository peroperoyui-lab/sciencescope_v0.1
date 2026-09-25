// Experts in the Main composer (2026-09-24 revision).
// - 工作: the Main expert handles the message; "@专家名" instead invites the
//   named experts to answer it (exact label or stable id; nothing is guessed).
// - 有序讨论: the selected experts read the same conversation and answer
//   independently in parallel, shown in roster order; an optional reviewer
//   checks their answers afterwards. The reviewer's check joins later context
//   only when the user adopts it.
// Experts run as DSH subagents of this chat's session (see /api/discussion).
// Answers are ordinary transcript messages whose author is the expert.
import {infoTip} from './info-tip.mjs';
import './live-chat.mjs';
import './work-mode.mjs';
import {hostRequest, streamChat} from './host-client.mjs';
import {renderMarkdown} from './markdown.mjs';
import {recordTool, paintActivity} from './turn-activity.mjs';
import {composerMenu} from './composer-menu.mjs';

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

// Ordered panel choice per chat: participants and optional reviewer. A
// per-viewer convenience; a missing or stale entry falls back to "all enabled".
const panels = new Map();
const storeKey = chatId => `sciencescope-panel:${chatId}`;
function panelOf(chatId = V.chat) {
  if (!panels.has(chatId)) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storeKey(chatId)) || 'null'); } catch {}
    panels.set(chatId, {excluded: new Set(saved?.excluded || []), reviewer: saved?.reviewer || null});
  }
  const panel = panels.get(chatId);
  const ids = enabled().map(expert => expert.id);
  if (panel.reviewer && !ids.includes(panel.reviewer)) panel.reviewer = null;
  return {participants: ids.filter(id => !panel.excluded.has(id) && id !== panel.reviewer), reviewer: panel.reviewer, raw: panel};
}
function savePanel(chatId = V.chat) {
  const panel = panels.get(chatId); if (!panel) return;
  try { localStorage.setItem(storeKey(chatId), JSON.stringify({excluded: [...panel.excluded], reviewer: panel.reviewer})); } catch {}
}

// Live status of each expert in the running round, shown on its message and
// on the participants strip.
const STATES = {waiting: '等待中', running: '作答中', tool: '使用工具', review: '等待其他专家', done: '已完成', failed: '未完成', stopped: '已停止'};
const live = new Map();
function stateOf(message) {
  if (message.streaming) return live.get(message.id) || 'running';
  const reason = message.expert?.stopReason;
  return !reason || reason === 'completed' ? 'done' : reason === 'aborted' ? 'stopped' : 'failed';
}
function reviewBar(message) {
  const expert = message.expert;
  if (!expert?.review || message.streaming || expert.stopReason && expert.stopReason !== 'completed') return '';
  const label = expert.mainSeen ? '已加入后续上下文 · 主专家已读取' : expert.adopted ? '已加入后续上下文' : '加入后续上下文';
  return `<div class="review-adopt" data-review-bar="${esc(message.id)}"><span>审核结论${infoTip('审核结论默认不进入后续上下文。\n点击"加入后续上下文"后，它会随下一轮一起提供给主专家和各位专家。',{label:'审核结论说明'})}</span><button class="btn tiny ${expert.adopted ? 'soft' : 'primary'}" data-review-adopt="${esc(message.id)}" aria-pressed="${!!expert.adopted}" ${expert.mainSeen ? 'disabled' : ''}>${label}</button></div>`;
}
const baseMessageHTML = messageHTML;
messageHTML = function(message) {
  let html = baseMessageHTML(message);
  if (!message.expert || message.role !== 'assistant') return html;
  const state = stateOf(message);
  html = html.replace(/<article\b([^>]*?)class="message /, `<article$1data-expert-state="${state}" class="message expert-message ${message.expert.review ? 'review-message ' : ''}`);
  html = html.replace('<time title=', `${message.expert.review ? '<span class="expert-badge">审核</span>' : ''}<span class="expert-state" data-state="${state}">${STATES[state]}</span><time title=`);
  return html.replace('<div class="msg-actions">', reviewBar(message) + '<div class="msg-actions">');
};

async function submitDiscussion(text, {kind, expertIds, reviewerId = null}) {
  const chatId = V.chat;
  const model = window.ScienceScopeModels?.selected();
  if (!model || !window.ScienceScopeModels.available()) { toast('请先在模型与 API 中连接服务并选择模型。'); go('models'); return false; }
  const thread = window.ScienceScopeWorkspace?.resolveThread(chatId) || S.threads.find(t => t.id === chatId);
  if (!thread || V.pending.has(chatId)) return false;
  if (thread.temporary) { toast('临时对话不支持专家讨论。'); return false; }
  if (!available) { toast('当前运行时不支持专家讨论。'); return false; }
  if (!expertIds.length) { toast(kind === 'ordered' ? '请在讨论条上至少选择一位作答专家。' : '没有找到被 @ 的专家。'); return false; }
  if (!text.trim()) return false;
  let researchInput;
  try { researchInput = await window.ScienceScopeResearchInput.capture('main', chatId); }
  catch (error) { toast(error.message); return false; }
  const inputBefore = S.drafts.main;
  try { await window.ScienceScopeWorkspace?.beforeSend(chatId); } catch (error) { toast(error.message); return false; }
  if (V.pending.has(chatId)) return false;
  const userId = uid('msg');
  const data = () => chatId === V.chat ? S : chatData[chatId];
  saveThread(); V.pending.add(chatId); window.ScienceScopeMainRun?.sync();
  let accepted = false; const placeholders = new Map(); const pendingPaint = new Set();
  const find = messageId => data().messages?.find(m => m.id === messageId);
  const paintAnswer = (messageId) => {
    if (chatId !== V.chat) return;
    const node = document.getElementById(`message-${messageId}`);
    const answer = find(messageId);
    if (!node || !answer) return;
    const box = document.querySelector('.messages');
    const follow = box && box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    const state = stateOf(answer);
    node.dataset.expertState = state;
    const pill = node.querySelector('.expert-state'); if (pill) { pill.dataset.state = state; pill.textContent = STATES[state]; }
    const waiting = state === 'review' ? '等待其他专家完成后开始审核…' : state === 'waiting' ? '等待开始…' : '';
    node.querySelector('.message-text').innerHTML = renderMarkdown(answer.text || waiting);
    node.toggleAttribute('data-streaming', !!answer.streaming);
    const bar = node.querySelector('[data-review-bar]'); const next = reviewBar(answer);
    if (bar) { if (next) bar.outerHTML = next; else bar.remove(); }
    else if (next) node.querySelector('.msg-actions')?.insertAdjacentHTML('beforebegin', next);
    if (follow) box.scrollTop = box.scrollHeight;
  };
  const schedule = messageId => { if (!pendingPaint.has(messageId)) { pendingPaint.add(messageId); setTimeout(() => { pendingPaint.delete(messageId); paintAnswer(messageId); }, 60); } };
  const setState = (messageId, state) => { live.set(messageId, state); paintStrip(); schedule(messageId); };
  try {
    await streamChat({chatId, projectId: thread.projectId || null, model, text, kind, expertIds, reviewerId, researchInput, userMessageId: userId, workspaceChoice: thread.workspaceChoice || {mode: 'new'}, ...(thread.pythonEnvId ? {pythonEnvId: thread.pythonEnvId} : {}),
      executionMode: window.ScienceScopeExecution?.mode() === 'full' ? 'full' : 'ask', title: thread.title === '新对话' ? text.trim().slice(0, 40) : thread.title}, event => {
      if (event.type === 'accepted' && !accepted) {
        accepted = true;
        void window.ScienceScopeResearchInput.accepted('main', chatId, researchInput).catch(error => toast(error.message));
        thread.model = model; window.ScienceScopeWorkspace?.accepted(thread, text);
        const d = data(); d.messages ??= [];
        const added = [{id: userId, role: 'user', text, researchInput, time: vtime()}];
        for (const expert of event.experts) {
          const message = {id: expert.messageId, role: 'assistant', name: expert.label, label: expert.model?.modelId || model.modelId, text: '', streaming: true, time: vtime(), expert: {expertId: expert.id, label: expert.label, role: expert.role, model: expert.model, review: !!expert.review, adopted: false}};
          live.set(message.id, expert.review ? 'review' : 'waiting');
          placeholders.set(expert.id, message.id); added.push(message);
        }
        d.messages.push(...added); d.messages = d.messages.slice(-60);
        if (chatId === V.chat && S.drafts.main === inputBefore) S.drafts.main = '';
        const box = chatId === V.chat ? document.querySelector('.messages') : null;
        if (box) {
          box.insertAdjacentHTML('beforeend', added.map(messageHTML).join(''));
          const retained = new Set(d.messages.map(message => message.id));
          for (const node of box.querySelectorAll(':scope > .message')) if (!retained.has(node.dataset.messageId)) node.remove();
          const input = document.querySelector('[data-draft="main"]');
          if (input && input.value === inputBefore) input.value = S.drafts.main;
          for (const message of added) if (message.role === 'assistant') paintAnswer(message.id);
          box.scrollTop = box.scrollHeight; saveThread();
        } else if (chatId === V.chat) { saveThread(); render(); }
        paintStrip();
      }
      const answer = event.messageId ? find(event.messageId) : null;
      if (!answer) { if (event.type === 'completed' && event.failed) toast(`${event.failed} 位专家本轮未完成，可重试或调整名册。`); return; }
      if (event.type === 'expert-start' && answer.streaming) setState(answer.id, 'running');
      if (event.type === 'review-start' && answer.streaming) setState(answer.id, 'running');
      if ((event.type === 'expert-delta' || event.type === 'expert-reset') && answer.streaming) {
        if (event.type === 'expert-delta') answer.text += event.delta; else answer.text = '';
        if (live.get(answer.id) !== 'running') live.set(answer.id, 'running');
        schedule(answer.id);
      }
      if ((event.type === 'tool-call' || event.type === 'tool-result') && answer.streaming) {
        // The text streamed before a tool call is its preamble: it now lives
        // in the tool card, not in the answer.
        if (event.type === 'tool-call' && event.preamble) answer.text = '';
        recordTool(answer, event);
        if (chatId === V.chat) paintActivity(answer);
        setState(answer.id, event.type === 'tool-call' ? 'tool' : 'running');
      }
      if (event.type === 'expert-end') {
        answer.text = event.text; answer.streaming = false; answer.expert = {...answer.expert, stopReason: event.stopReason};
        for (const call of answer.toolActivity || []) if (call.status === 'running') call.status = 'interrupted';
        live.delete(answer.id);
        if (chatId === V.chat) paintActivity(answer);
        paintAnswer(answer.id); paintStrip();
      }
    }, '/api/discussion');
    thread.updated = vtime();
    return true;
  } catch (error) {
    if (accepted) {
      await window.ScienceScopeResearchInput.restore('main', chatId, researchInput).catch(() => {});
      if (chatId === V.chat && !S.drafts.main) { S.drafts.main = text; const input = document.querySelector('[data-draft="main"]'); if (input && !input.value) input.value = text; }
    }
    toast(error.message); return false;
  } finally {
    V.pending.delete(chatId);
    for (const id of placeholders.values()) { const answer = find(id); live.delete(id); if (answer?.streaming) { answer.streaming = false; answer.expert = {...answer.expert, stopReason: answer.expert.stopReason || 'aborted'}; paintAnswer(id); } }
    saveThread(); window.ScienceScopeMainRun?.sync();
    if (accepted) await window.ScienceScopeWorkspace?.settled(chatId);
    void window.ScienceScopeActivity?.refresh();
    paintStrip();
  }
}

const baseSubmit = submitMain;
submitMain = async function(text, annotations, options = {}) {
  if (options.outboxId || options.targetChat && options.targetChat !== V.chat) return baseSubmit(text, annotations, options);
  if (!roster.length) await loadRoster();
  if (mode() === 'ordered') {
    const {participants, reviewer} = panelOf();
    return submitDiscussion(text, {kind: 'ordered', expertIds: participants, reviewerId: reviewer});
  }
  const invited = available ? mentionedExperts(text, enabled()) : [];
  if (invited.length) return submitDiscussion(text, {kind: 'invited', expertIds: invited});
  return baseSubmit(text, annotations, options);
};
window.SS.submitMain = submitMain;
window.SSV2.submit = submitMain;

// Ordered panel strip above the transcript: order, participation toggles and
// the reviewer choice; during a round each chip shows its expert's state.
function stripHTML() {
  const {participants, reviewer} = panelOf();
  const busy = V.pending.has(V.chat);
  const running = new Map();
  for (const message of S.messages || []) if (message.streaming && message.expert) running.set(message.expert.expertId, live.get(message.id) || 'running');
  let order = 0;
  const chips = enabled().filter(expert => expert.id !== reviewer).map(expert => {
    const on = participants.includes(expert.id); const state = running.get(expert.id);
    return `<button class="panel-chip" data-panel-toggle="${esc(expert.id)}" aria-pressed="${on}" ${busy ? 'disabled' : ''} title="${esc(expert.role || '')}${on ? ' · 点击不参加本轮' : ' · 点击参加本轮'}">${on ? `<b>${++order}</b>` : '<b>–</b>'}${esc(expert.label)}${state ? `<i data-state="${state}" aria-label="${STATES[state]}"></i>` : ''}</button>`;
  }).join('');
  const reviewerExpert = enabled().find(expert => expert.id === reviewer);
  const reviewState = reviewer && running.get(reviewer);
  return `<div class="panelhead discussion-strip" data-discussion-strip><div class="row"><small>发言顺序</small>${chips || '<small>名册为空</small>'}<span class="spacer"></span><button class="panel-chip reviewer-chip" data-panel-reviewer-menu ${busy ? 'disabled' : ''} aria-haspopup="menu">审核：${reviewerExpert ? esc(reviewerExpert.label) : '无'}${reviewState ? `<i data-state="${reviewState}"></i>` : ''} ${ic('down')}</button></div></div>`;
}
function paintStrip() {
  const column = document.querySelector('.chatcol');
  const existing = column?.querySelector('[data-discussion-strip]');
  if (!column || mode() !== 'ordered' || !available) { existing?.remove(); return; }
  const html = stripHTML();
  if (existing) { if (existing.outerHTML !== html) existing.outerHTML = html; return; }
  column.querySelector('.messages')?.insertAdjacentHTML('beforebegin', html);
}
window.addEventListener('click', event => {
  const toggle = event.target.closest('[data-panel-toggle]');
  const reviewerMenu = event.target.closest('[data-panel-reviewer-menu]');
  const reviewerPick = event.target.closest('[data-panel-reviewer]');
  const adopt = event.target.closest('[data-review-adopt]');
  if (!toggle && !reviewerMenu && !reviewerPick && !adopt) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (adopt) return void adoptReview(adopt.dataset.reviewAdopt, adopt.getAttribute('aria-pressed') !== 'true');
  if (V.pending.has(V.chat)) return;
  const {raw, reviewer} = panelOf();
  if (toggle) {
    const id = toggle.dataset.panelToggle;
    if (raw.excluded.has(id)) raw.excluded.delete(id); else raw.excluded.add(id);
  } else if (reviewerMenu) {
    return composerMenu(reviewerMenu, '审核专家', [{label: '不设审核', selected: !reviewer, action: 'desktop-panel-reviewer', attrs: 'data-panel-reviewer=""', description: '专家各自作答后本轮结束。'},
      ...enabled().map(expert => ({label: expert.label, selected: reviewer === expert.id, action: 'desktop-panel-reviewer', attrs: `data-panel-reviewer="${esc(expert.id)}"`, description: '其他专家全部完成后，核查各回复的事实、依据、方法和结论并总结；该专家本轮不单独作答。'}))]);
  } else { closeMenu(); raw.reviewer = reviewerPick.dataset.panelReviewer || null; }
  savePanel(); paintStrip();
}, true);

async function adoptReview(messageId, adopted) {
  const chatId = V.chat;
  try {
    const {entry} = await hostRequest('discussion/adopt', {chatId, messageId, adopted});
    const message = (chatId === V.chat ? S : chatData[chatId])?.messages?.find(m => m.id === messageId);
    if (message) message.expert = {...message.expert, adopted: entry.adopted, mainSeen: entry.mainSeen};
    const bar = document.querySelector(`[data-review-bar="${CSS.escape(messageId)}"]`);
    if (bar && message) bar.outerHTML = reviewBar(message);
    saveThread();
    toast(entry.adopted ? '审核结论将随下一轮一起提供给主专家和专家。' : '审核结论不会进入后续上下文。');
  } catch (error) { toast(error.message); }
}

const after = window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender = (...args) => { after?.(...args); paintStrip(); };
// Mode changes happen in work-mode.mjs without a full render.
window.addEventListener('sciencescope-work-mode', () => { void loadRoster().then(paintStrip); });

// @ candidate menu (工作模式): lists enabled experts; the chosen expert is
// inserted as "@名称 ". Arrow keys move, Enter/Tab choose, Esc closes.
let mention = null;
function closeMention() { mention?.menu.remove(); mention = null; }
function mentionQuery(input) {
  const before = input.value.slice(0, input.selectionStart);
  const match = before.match(/(?:^|[\s(（])@([^\s@]*)$/u);
  return match ? {query: match[1], start: before.length - match[1].length - 1, end: input.selectionStart} : null;
}
function paintMention() {
  if (!mention) return;
  mention.menu.innerHTML = `<div class="mention-title">邀请专家回答</div>` + (mention.items.map((expert, index) => `<button type="button" role="option" data-mention="${esc(expert.id)}" aria-selected="${index === mention.active}"><span class="mention-avatar">${esc(expert.label.slice(0, 1))}</span><span class="mention-name">${esc(expert.label)}</span><small>${esc(expert.role || expert.model?.modelId || '')}</small></button>`).join('') || '<div class="mention-empty">没有匹配的专家</div>');
}
function openMention(input) {
  if (mode() !== 'work' || !available) return closeMention();
  const hit = mentionQuery(input);
  if (!hit) return closeMention();
  const q = hit.query.toLocaleLowerCase();
  const items = enabled().filter(expert => !q || expert.label.toLocaleLowerCase().includes(q) || expert.id.toLocaleLowerCase().includes(q));
  if (!mention) {
    const menu = document.createElement('div'); menu.className = 'mention-menu'; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', '邀请专家');
    input.closest('[data-composer="main"]')?.append(menu);
    mention = {menu, items: [], active: 0, input};
  }
  mention.items = items; mention.hit = hit; mention.active = Math.min(mention.active, Math.max(0, items.length - 1));
  paintMention();
}
function chooseMention(expert) {
  if (!mention || !expert) return;
  const {input, hit} = mention;
  const insert = `@${expert.label} `;
  input.value = input.value.slice(0, hit.start) + insert + input.value.slice(hit.end);
  const caret = hit.start + insert.length; input.setSelectionRange(caret, caret);
  closeMention();
  input.dispatchEvent(new Event('input', {bubbles: true}));
  input.focus();
}
window.addEventListener('input', event => {
  if (!event.target.matches?.('textarea[data-draft="main"]') || event.isComposing) return;
  if (!roster.length) void loadRoster().then(() => openMention(event.target)); else openMention(event.target);
}, true);
window.addEventListener('compositionend', event => { if (event.target.matches?.('textarea[data-draft="main"]')) openMention(event.target); }, true);
window.addEventListener('keydown', event => {
  if (!mention || event.target !== mention.input || event.isComposing) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); event.stopImmediatePropagation();
    const n = mention.items.length; if (!n) return;
    mention.active = (mention.active + (event.key === 'ArrowDown' ? 1 : n - 1)) % n; paintMention();
  } else if ((event.key === 'Enter' || event.key === 'Tab') && mention.items.length) {
    event.preventDefault(); event.stopImmediatePropagation(); chooseMention(mention.items[mention.active]);
  } else if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeMention(); }
}, true);
window.addEventListener('mousedown', event => {
  const option = event.target.closest('[data-mention]');
  if (option && mention) { event.preventDefault(); chooseMention(mention.items.find(expert => expert.id === option.dataset.mention)); return; }
  if (mention && !event.target.closest('.mention-menu')) closeMention();
}, true);
window.addEventListener('blur', closeMention);

window.ScienceScopeDiscussion = Object.freeze({roster: () => roster, reload: async () => { await loadRoster(); paintStrip(); return roster; }, mentionedExperts, panel: () => panelOf()});
void loadRoster().then(paintStrip);
