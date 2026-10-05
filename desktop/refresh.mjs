// Small interaction details that accompany refresh.css. Each one is additive:
// it never replaces an existing handler or changes what a button does.
import './workspace.mjs';
import {hostRequest} from './host-client.mjs';

// 1. A pinned project is a shortcut, not a second copy of its chats: the full
//    tree below already lists them, so the pinned row stays collapsed.
const baseProjectRow = projectRow;
projectRow = function(project, pinned = false) {
  if (!pinned) return baseProjectRow(project, false);
  const saved = S.projectExpanded[project.id];
  S.projectExpanded[project.id] = false;
  try {
    return baseProjectRow(project, true).replace(/<button[^>]*data-v="toggle-project"[\s\S]*?<\/button>/, '<span class="tree-arrow-spacer" aria-hidden="true"></span>');
  } finally {
    if (saved === undefined) delete S.projectExpanded[project.id]; else S.projectExpanded[project.id] = saved;
  }
};

// 2. The status bar states the real runtime state instead of the prototype text.
let runtimeReady = null;
async function checkRuntime() {
  try { runtimeReady = !!(await hostRequest('status')).available; } catch { runtimeReady = false; }
  paintRuntime();
}
function paintRuntime() {
  const foot = document.querySelector('.foot'); if (!foot || runtimeReady === null) return;
  foot.dataset.runtime = runtimeReady ? 'ready' : 'offline';
  const text = foot.querySelector('.foot-text');
  if (text) text.textContent = runtimeReady ? '本机运行时已连接' : '运行时未连接 · 请检查模型设置';
}
setInterval(() => { if (!document.hidden) void checkRuntime(); }, 30000);

// 3. Copy feedback in place: the icon's label reads "已复制" for 1.6s.
window.addEventListener('click', event => {
  const button = event.target.closest('[data-v="copy-message"],.code-copy');
  if (!button) return;
  const label = button.querySelector('span:last-child') || button;
  const before = label.textContent;
  setTimeout(() => {
    button.dataset.copied = '';
    if (!button.classList.contains('code-copy')) label.textContent = '已复制';
    setTimeout(() => { delete button.dataset.copied; if (!button.classList.contains('code-copy')) label.textContent = before; }, 1600);
  }, 0);
}, true);

// 4. Esc stops the running reply when nothing else (menu, dialog, palette,
//    text being composed) wants the key.
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
  if (document.querySelector('dialog[open],.menu-popup,.command-palette,#modal')) return;
  const input = document.activeElement;
  if (input?.matches?.('textarea,input') && input.value) return;
  const stop = document.querySelector('[data-composer="main"] [data-main-stop]');
  if (stop && V.pending.has(V.chat)) { event.preventDefault(); stop.click(); }
});

const after = window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender = (...args) => { after?.(...args); paintRuntime(); };
void checkRuntime();
