import { Marked } from './vendor/marked.mjs';
import DOMPurify from './vendor/purify.mjs';
import { mathExtensions, mathHTML } from './math-render.mjs';
import { hljs } from './vendor/reader-vendor.mjs';
const copyLabel=(copied=false)=>document.documentElement.lang==='en'?(copied?'Copied':'Copy code'):(copied?'已复制':'复制代码');

// Render model text, never model-supplied application controls or remote images.
export function renderMarkdown(text) {
  const formulas = new Map();
  const nonce = crypto.randomUUID();
  const parser = new Marked({gfm:true, breaks:false, extensions:mathExtensions((source, display) => {
    const id = `${nonce}-${formulas.size}`; formulas.set(id, {source, display});
    return `<span data-ss-math="${id}"></span>`;
  })});
  const clean = DOMPurify.sanitize(parser.parse(String(text ?? '')), {
    ALLOWED_TAGS:['p','br','strong','em','del','s','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','hr','table','thead','tbody','tr','th','td','a','input','span'],
    ALLOWED_ATTR:['href','title','start','align','type','checked','disabled','class','data-ss-math'],
    ALLOW_DATA_ATTR:false,
  });
  const template = document.createElement('template');
  template.innerHTML = clean;
  // The only retained source class is a fenced code language; raw HTML cannot
  // impersonate application controls by naming their styling classes.
  for (const node of template.content.querySelectorAll('[class]')) {
    const language = node.tagName === 'CODE' ? /(?:^|\s)language-([\w+-]+)/u.exec(node.className)?.[1] : null;
    node.removeAttribute('class');
    if (language && hljs.getLanguage(language)) {
      node.className = `hljs language-${language}`;
      node.innerHTML = DOMPurify.sanitize(hljs.highlight(node.textContent, {language, ignoreIllegals:true}).value, {ALLOWED_TAGS:['span'], ALLOWED_ATTR:['class']});
    }
  }
  for (const placeholder of template.content.querySelectorAll('[data-ss-math]')) {
    const formula = formulas.get(placeholder.dataset.ssMath);
    if (!formula) { placeholder.removeAttribute('data-ss-math'); continue; }
    placeholder.removeAttribute('data-ss-math');
    placeholder.className = formula.display ? 'ss-math-block' : 'ss-math-inline';
    placeholder.innerHTML = mathHTML(formula.source, formula.display);
  }
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
    button.dataset.copyCode = ''; button.textContent = copyLabel();
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
    button.dataset.copied='true';button.textContent = copyLabel(true);
  } catch { toast('复制失败，请选择代码后复制。'); }
}, true);
// These generated controls are UI, unlike the surrounding model text that the
// general translator intentionally skips. Translate only our own buttons.
new MutationObserver(()=>{for(const button of document.querySelectorAll('button[data-copy-code]'))button.textContent=copyLabel(button.dataset.copied==='true');}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
