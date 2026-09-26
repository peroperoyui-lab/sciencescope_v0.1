// Files an agent presented with its answer (DSH `present`): image thumbnails
// and document cards under the answer. Clicking opens the file with the
// system's default program. The host only serves files that a `present` call
// in this chat declared (scripts/deliverables.mjs).
import {hostBlob, hostRequest} from './host-client.mjs';

const MAX_CACHED = 40;
const thumbs = new Map(); // `${chatId}\n${path}` → Promise<objectURL>
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function presentedOf(message) {
  const seen = new Set(), out = [];
  for (const call of message?.toolActivity || []) {
    if (call.name !== 'present' || call.status !== 'completed' || call.isError) continue;
    let args = call.argumentsPreview;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { continue; } }
    for (const file of Array.isArray(args?.files) ? args.files : []) {
      if (typeof file?.path !== 'string' || !file.path || seen.has(file.path)) continue;
      seen.add(file.path); out.push({path: file.path, description: typeof file.description === 'string' ? file.description : ''});
    }
  }
  return out;
}

const baseName = file => file.split(/[\\/]/).pop() || file;

export function deliverablesHTML(message) {
  const files = presentedOf(message);
  if (!files.length) return '';
  return `<div class="deliverables">${files.map(file => {
    const image = IMAGE.test(file.path);
    return `<button type="button" class="deliverable ${image ? 'is-image' : 'is-document'}" data-deliverable="${esc(file.path)}" title="${esc(file.description || file.path)}">
      ${image ? '<span class="deliverable-thumb"><img alt="" data-deliverable-img></span>' : `<span class="deliverable-icon">${ic('file')}</span>`}
      <span class="deliverable-text"><b>${esc(baseName(file.path))}</b>${file.description ? `<small>${esc(file.description)}</small>` : ''}</span>
    </button>`;
  }).join('')}</div>`;
}

function thumbnail(chatId, file) {
  const key = `${chatId}\n${file}`;
  if (!thumbs.has(key)) {
    if (thumbs.size >= MAX_CACHED) { const [oldKey, old] = thumbs.entries().next().value; thumbs.delete(oldKey); old.then(url => url && URL.revokeObjectURL(url)); }
    thumbs.set(key, hostBlob(`chats/deliverable?chatId=${encodeURIComponent(chatId)}&path=${encodeURIComponent(file)}`).then(blob => URL.createObjectURL(blob)).catch(() => null));
  }
  return thumbs.get(key);
}

export function paintDeliverables(message, element = document.getElementById(`message-${message?.id}`)) {
  const body = element?.querySelector('.messagebody');
  if (!body) return;
  const html = deliverablesHTML(message);
  let host = body.querySelector(':scope > .deliverables-host');
  if (!html) { host?.remove(); return; }
  if (!host) { host = document.createElement('div'); host.className = 'deliverables-host'; body.append(host); }
  if (host.dataset.html === html) return;
  host.dataset.html = html; host.innerHTML = html;
  const chatId = V.chat;
  for (const button of host.querySelectorAll('.is-image')) {
    const img = button.querySelector('img');
    void thumbnail(chatId, button.dataset.deliverable).then(url => { if (url && img.isConnected) img.src = url; else if (!url) button.classList.add('is-missing'); });
  }
}

const messageById = id => (S.messages || []).find(message => message.id === id);
new MutationObserver(records => {
  for (const record of records) for (const node of record.addedNodes) {
    if (!(node instanceof Element)) continue;
    for (const element of node.matches?.('.message[id^="message-"]') ? [node] : node.querySelectorAll?.('.message[id^="message-"]') || []) {
      const message = messageById(element.id.slice('message-'.length));
      if (message?.toolActivity?.length) paintDeliverables(message, element);
    }
  }
}).observe(document.documentElement, {childList: true, subtree: true});

window.addEventListener('click', async event => {
  const button = event.target.closest('[data-deliverable]');
  if (!button) return;
  event.preventDefault(); event.stopImmediatePropagation();
  try { await hostRequest('chats/deliverable/open', {chatId: V.chat, path: button.dataset.deliverable}); }
  catch (error) { toast(error.message); }
}, true);
