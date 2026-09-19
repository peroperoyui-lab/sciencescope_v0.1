import { marked } from './vendor/marked.mjs';
import DOMPurify from './vendor/purify.mjs';

// Render model text, never model-supplied application controls or remote images.
export function renderMarkdown(text) {
  const clean = DOMPurify.sanitize(marked.parse(String(text ?? ''), {gfm:true, breaks:false}), {
    ALLOWED_TAGS:['p','br','strong','em','del','s','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','hr','table','thead','tbody','tr','th','td','a','input'],
    ALLOWED_ATTR:['href','title','start','align','type','checked','disabled'],
    ALLOW_DATA_ATTR:false,
  });
  const template = document.createElement('template');
  template.innerHTML = clean;
  for (const link of template.content.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) link.removeAttribute('href');
    else { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  }
  for (const input of template.content.querySelectorAll('input')) {
    if (input.type !== 'checkbox') input.remove();
    else input.disabled = true;
  }
  for (const pre of template.content.querySelectorAll('pre')) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'code-copy';
    button.dataset.copyCode = ''; button.textContent = '复制代码';
    pre.append(button);
  }
  for (const table of template.content.querySelectorAll('table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-table';
    table.replaceWith(wrapper); wrapper.append(table);
  }
  return template.innerHTML;
}

markdown = renderMarkdown;
const originalMessageHTML = messageHTML;
messageHTML = function(message) {
  // Keep the approved message actions/layout; display the actual model once.
  let html = originalMessageHTML(message);
  if (message.role === 'user') html = html.replace('<div class="messagehead">Joy', `<div class="messagehead">${esc(window.ScienceScopeProfile?.name()||'用户')}`);
  if (message.streaming) html = html.replace('<article ', '<article data-streaming ');
  return html.replace('<div class="message-text">', '<div class="message-text rendered-markdown">')
    .replace('<small>主专家</small>', message.name === '主专家' ? '' : '<small>主专家</small>');
};
window.addEventListener('click', async event => {
  const button = event.target.closest('[data-copy-code]');
  if (!button) return;
  event.preventDefault(); event.stopImmediatePropagation();
  try {
    await navigator.clipboard.writeText(button.parentElement.querySelector('code')?.textContent || '');
    button.textContent = '已复制';
  } catch { toast('复制失败，请选择代码后复制。'); }
}, true);
