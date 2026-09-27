import { marked } from './vendor/marked.mjs';
import DOMPurify from './vendor/purify.mjs';
import katex from './vendor/katex/katex.mjs';

// Math ($$…$$, \[…\], $…$, \(…\)) is taken out before Markdown parsing so
// marked does not eat backslashes or underscores, then rendered by KaTeX and
// put back after sanitizing. KaTeX runs with trust off: model input cannot
// produce links, scripts or styles through it. Code spans and blocks keep
// their dollars. Inline $…$ follows the Pandoc rule (no space inside the
// delimiters, no digit right after the closing $) so "$5 and $10" stays text.
const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?=\S)((?:\\\$|[^$\n])+?)(?<=\S)\$(?!\d)/g;
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`+[^`]*`+)/g;
function extractMath(text) {
  const found = [];
  const out = text.split(CODE).map((part, index) => index % 2 ? part : part.replace(MATH, (_match, block, bracket, paren, inline) => {
    const display = block !== undefined || bracket !== undefined;
    found.push({tex: block ?? bracket ?? paren ?? inline, display});
    return `SSMATH${found.length - 1}X`;
  })).join('');
  return {text: out, found};
}
function renderMath({tex, display}) {
  const html = katex.renderToString(tex.trim(), {displayMode: display, throwOnError: false, trust: false, output: 'htmlAndMathml', strict: 'ignore'});
  return display ? `<div class="math-display">${html}</div>` : html;
}

// Render model text, never model-supplied application controls or remote images.
export function renderMarkdown(text) {
  const math = extractMath(String(text ?? ''));
  const clean = DOMPurify.sanitize(marked.parse(math.text, {gfm:true, breaks:false}), {
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
  let html = template.innerHTML;
  if (math.found.length) html = html.replace(/<p>SSMATH(\d+)X<\/p>/g, (_m, i) => renderMath({...math.found[i], display: true}))
    .replace(/SSMATH(\d+)X/g, (_m, i) => renderMath(math.found[i]));
  return html;
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
