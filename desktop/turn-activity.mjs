// A bounded presentation of tool activity belonging to one assistant reply.
// DSH remains the runtime history. This module never sends tool output to models.
const openCards = new Set();
const openCalls = new Set();
const key = (messageId, callId) => `${messageId}:${callId}`;
const display = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

export function activityHTML(message) {
  const calls = message.toolActivity || [];
  if (!calls.length) return '';
  const count = calls.length;
  const running = calls.filter(call => call.status === 'running').length;
  return `<details class="turn-activity" data-turn-activity="${esc(message.id)}" ${openCards.has(message.id)?'open':''}>
    <summary>${running ? `正在使用工具 · ${running}` : `工具记录 · ${count}`}<span>${message.streaming ? '执行中' : '展开查看'}</span></summary>
    <div class="turn-activity-calls">${calls.map(call => `<details data-tool-call="${esc(key(message.id,call.callId))}" ${openCalls.has(key(message.id,call.callId))?'open':''}>
      <summary><span>${esc(call.name || '工具')}</span><small>${call.status==='running'?'进行中':call.status==='interrupted'?'未完成':call.isError?'失败':'完成'}</small></summary>
      ${call.argumentsPreview === undefined ? '' : `<div class="tool-detail-label">输入</div><pre>${esc(display(call.argumentsPreview))}</pre>`}
      ${call.resultPreview === undefined ? '' : `<div class="tool-detail-label">结果</div><pre>${esc(display(call.resultPreview))}</pre>`}
    </details>`).join('')}</div>
  </details>`;
}

export function recordTool(message, event) {
  const calls = message.toolActivity ??= [];
  let call = calls.find(value => value.callId === event.callId);
  if (!call) {
    // The complete history stays with DSH; bound the live presentation cache.
    if (calls.length >= 100) calls.shift();
    calls.push(call = {callId:event.callId, name:event.name});
  }
  Object.assign(call, event, {status:event.type === 'tool-call' ? 'running' : 'completed'});
}

export function paintActivity(message) {
  const body = document.getElementById(`message-${message.id}`)?.querySelector('.messagebody');
  if (!body) return;
  let container = body.querySelector('.turn-activity-host');
  if (!container) { container = document.createElement('div'); container.className='turn-activity-host'; body.prepend(container); }
  // Do not replace a detail currently selected by the user. Catch up on next event.
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && container.contains(selection.anchorNode)) return;
  container.innerHTML = activityHTML(message);
}

document.addEventListener('toggle', event => {
  const node=event.target;
  const id=node.dataset?.turnActivity || node.dataset?.toolCall;
  if (!id || !node.isConnected) return;
  const collection=node.dataset.turnActivity ? openCards : openCalls;
  if(node.open) collection.add(id); else collection.delete(id);
  // Bound UI expansion preferences; old unmounted cards need no retained state.
  if(collection.size>200)collection.delete(collection.values().next().value);
},true);

const previousMessageHTML=messageHTML;
messageHTML=function(message) {
  const html=previousMessageHTML(message);
  return message.toolActivity?.length
    ? html.replace('<div class="messagebody">',`<div class="messagebody"><div class="turn-activity-host">${activityHTML(message)}</div>`)
    : html;
};
