// Interface language (中文 / English). The approved prototype renders Chinese
// markup we do not edit, so translation happens at the display layer: text
// nodes and interface attributes are rewritten from a dictionary as the DOM
// changes, and restored exactly when switching back to Chinese.
// Rules:
// - Never touch user or model content: messages, rendered Markdown, inputs,
//   editable areas and anything marked [data-i18n-skip].
// - A text is translated only when all of its Chinese is known interface text
//   (whole string, a pattern, or known fragments); otherwise it is left as is,
//   so user data such as a project named "新对话测试" is never half-translated.
import {EN, EN_PATTERNS} from './i18n-en.mjs';

export const LANGUAGES = [['zh-CN', '中文'], ['en', 'English']];
const CJK = /[㐀-鿿]/u;
const ATTRS = ['placeholder', 'title', 'aria-label', 'data-info-tip', 'alt'];
const SKIP = '.message-text,.rendered-markdown,.mdview,.markdown-body,textarea,[contenteditable="true"],[data-i18n-skip],.file-preview-doc,pre,code';
const PUNCT = [[/，/g, ', '], [/、/g, ', '], [/；/g, '; '], [/：/g, ': '], [/。/g, '. '], [/？/g, '? '], [/！/g, '! '], [/（/g, ' ('], [/）/g, ') '], [/[“”]/g, '"'], [/[‘’]/g, "'"], [/…/g, '…'], [/—/g, '—']];

let language = 'zh-CN';
let fragmentRe = null;
const patterns = EN_PATTERNS.map(([source, replacement]) => [new RegExp(`^${source}$`, 'u'), replacement]);
const misses = new Set();

function fragmentPattern() {
  if (!fragmentRe) {
    const keys = Object.keys(EN).filter(key => key.length >= 2).sort((a, b) => b.length - a.length).map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    fragmentRe = keys.length ? new RegExp(keys.join('|'), 'gu') : /$^/u;
  }
  return fragmentRe;
}

const tidy = text => PUNCT.reduce((value, [re, to]) => value.replace(re, to), text).replace(/ {2,}/g, ' ').replace(/ ([,.;:!?)])/g, '$1').replace(/\( /g, '(').trim();

/** English for a Chinese interface string, or null when it is not all known. */
export function translate(text) {
  if (!CJK.test(text)) return text;
  const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0], core = text.trim();
  const done = value => lead + value + trail;
  if (Object.hasOwn(EN, core)) return done(EN[core]);
  for (const [re, replacement] of patterns) {
    const match = re.exec(core);
    if (!match) continue;
    // A captured name that is not interface text (a project, an expert) stays as is.
    const parts = match.slice(1).map(part => part === undefined ? '' : CJK.test(part) ? translate(part) ?? part : part);
    return done(replacement.replace(/\$(\d)/g, (_, index) => parts[Number(index) - 1] ?? ''));
  }
  const replaced = core.replace(fragmentPattern(), match => ` ${EN[match]} `);
  if (CJK.test(replaced)) { misses.add(core); return null; }
  return done(tidy(replaced));
}

const originals = new WeakMap(); // text node → original; element → {attr: original}
const written = new WeakMap();   // text node → value we wrote
const skipped = node => !!(node.parentElement || node).closest?.(SKIP);

function textNode(node) {
  if (skipped(node)) return;
  let original = originals.get(node);
  if (original === undefined || node.nodeValue !== written.get(node)) original = node.nodeValue; // the app changed it
  if (!CJK.test(original)) return;
  const english = translate(original);
  if (english === null || english === node.nodeValue) return;
  originals.set(node, original); written.set(node, english); node.nodeValue = english;
}
function attributes(element) {
  if (element.closest?.('[data-i18n-skip]')) return;
  let saved = originals.get(element);
  for (const name of ATTRS) {
    const value = element.getAttribute?.(name);
    if (!value) continue;
    const previous = saved?.[name];
    const original = previous && value === previous.english ? previous.zh : value;
    if (!CJK.test(original)) continue;
    const english = translate(original);
    if (english === null || english === value) continue;
    saved ??= {}; saved[name] = {zh: original, english}; originals.set(element, saved);
    element.setAttribute(name, english);
  }
}
function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) { textNode(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (root.matches?.(SKIP)) { attributes(root); return; }
  attributes(root);
  // Skipped zones keep their content but still get interface attributes (placeholder, title).
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {acceptNode: node => { if (node.nodeType === Node.ELEMENT_NODE && node.matches(SKIP)) { attributes(node); return NodeFilter.FILTER_REJECT; } return NodeFilter.FILTER_ACCEPT; }});
  for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeType === Node.TEXT_NODE ? textNode(node) : attributes(node);
}
function restore(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = root; node; node = walker.nextNode()) {
    const saved = originals.get(node);
    if (saved === undefined) continue;
    if (node.nodeType === Node.TEXT_NODE) { if (node.nodeValue === written.get(node)) node.nodeValue = saved; }
    else for (const [name, {zh, english}] of Object.entries(saved)) if (node.getAttribute(name) === english) node.setAttribute(name, zh);
    originals.delete(node);
  }
}

let observer = null, originalTitle = null;
export function setLanguage(next) {
  next = next === 'en' ? 'en' : 'zh-CN';
  if (next === language) return;
  language = next;
  document.documentElement.lang = next;
  if (next === 'en') {
    walk(document.body);
    originalTitle = document.title; document.title = translate(document.title) ?? document.title;
    observer ??= new MutationObserver(records => {
      if (language !== 'en') return;
      for (const record of records) {
        if (record.type === 'characterData') textNode(record.target);
        else if (record.type === 'attributes') attributes(record.target);
        else for (const node of record.addedNodes) walk(node);
      }
    });
    observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS});
  } else {
    observer?.disconnect();
    restore(document.body);
    if (originalTitle !== null) document.title = originalTitle;
  }
}
export const getLanguage = () => language;

if (typeof window !== 'undefined') {
  document.documentElement.lang = 'zh-CN';
  // Apply the last chosen language at once; the saved preference confirms it.
  try { if (localStorage.getItem('sciencescope-language') === 'en') setLanguage('en'); } catch {}
  window.ScienceScopeI18n = Object.freeze({setLanguage, getLanguage, translate, misses: () => [...misses]});
}
