// Creation details (user request 2026-09-25): creating a project or an
// independent chat asks for the working folder and the Python environment.
// - Projects keep the approved "创建研究项目" page; its 工作目录 field and
//   buttons are wired here, and a Python 环境 field is added below them.
// - Independent chats open a small in-app dialog first; confirming enters the
//   unchanged welcome draft. Chats created inside a project inherit it.
// Python environments are managed by the host (/api/python/*, T11). Until that
// API exists the field says so and the system Python is used — nothing here
// pretends an environment was applied.
import './workspace.mjs';
import {hostRequest} from './host-client.mjs';

const PROTOTYPE_PATH = '<安装目录>/data/projects/新项目';

async function pythonEnvs() {
  try { return await hostRequest('python/envs'); } catch { return null; }
}

function envField(id, envs) {
  if (!envs?.envs) return `<div class="field creation-python"><label class="label" for="${id}">Python 环境</label><select id="${id}" disabled><option>系统 Python</option></select><p class="hint">Python 环境管理即将提供；在此之前，模型使用这台电脑上已安装的 Python。</p></div>`;
  const selected = envs.defaultEnvId || envs.envs[0]?.id || 'system';
  const options = envs.envs.map(env => `<option value="${esc(env.id)}" ${env.id === selected ? 'selected' : ''}>${esc(env.name)}${env.version ? ` · Python ${esc(env.version)}` : ''}</option>`).join('');
  const system = `<option value="system" ${selected === 'system' ? 'selected' : ''}>系统 Python${envs.system?.available ? ` · ${esc(envs.system.version || '')}` : '（未检测到）'}</option>`;
  return `<div class="field creation-python"><label class="label" for="${id}">Python 环境</label><select id="${id}">${options}${system}</select><p class="hint">模型运行 Python 时使用这个环境。以后可以在对话菜单中更换。</p></div>`;
}

// Native folder picker (Tauri command `pick_folder`, T11). Never falls back to a
// browser dialog; pasting a full path always works.
async function pickFolder() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (typeof invoke !== 'function') { toast('文件夹选择框只在桌面客户端中可用；也可以直接粘贴完整路径。'); return null; }
  try { return await invoke('pick_folder', {title: '选择工作文件夹'}); }
  catch { toast('当前桌面客户端还不支持文件夹选择框（等待更新），请直接粘贴完整路径。'); return null; }
}

async function checkFolder(folder) {
  return hostRequest('folders/check', {folder});
}

// ---------- project page ----------
let projectEnvs = null;
async function enhanceProjectPage() {
  const input = document.getElementById('new-project-path');
  if (!input || input.dataset.enhanced) return;
  input.dataset.enhanced = '1';
  if (input.value === PROTOTYPE_PATH) input.value = '';
  input.placeholder = '默认：在 ScienceScope 数据目录下新建';
  const row = input.closest('.field')?.nextElementSibling;
  const note = document.createElement('p'); note.className = 'hint creation-note'; note.dataset.projectFolderNote = '';
  note.textContent = '留空则自动新建；选择已有文件夹时，其中的文件不会被移动或覆盖。';
  (row || input).after(note);
  projectEnvs = await pythonEnvs();
  if (!document.getElementById('new-project-python')) note.insertAdjacentHTML('afterend', envField('new-project-python', projectEnvs));
}
window.addEventListener('click', async event => {
  const pick = event.target.closest('[data-action="pick-project-folder"]');
  const reset = event.target.closest('[data-action="default-project-dir"]');
  if (!pick && !reset) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const input = document.getElementById('new-project-path'); if (!input) return;
  if (reset) { input.value = ''; return; }
  const folder = await pickFolder(); if (folder) input.value = folder;
}, true);

/** Called by the create-project action before the project is added. */
async function projectChoice() {
  const folderText = document.getElementById('new-project-path')?.value.trim() || '';
  const note = document.querySelector('[data-project-folder-note]');
  let folder = null;
  if (folderText && folderText !== PROTOTYPE_PATH) {
    try {
      const checked = await checkFolder(folderText);
      folder = checked.folder;
      if (checked.warning && !await window.ScienceScopeWorkspace.confirmAction('使用这个文件夹？', checked.warning, '仍然使用')) return null;
    } catch (error) { if (note) { note.textContent = error.message; note.dataset.error = ''; } toast(error.message); return null; }
  }
  const select = document.getElementById('new-project-python');
  return {folder, envId: select && !select.disabled ? select.value : null};
}
/** Called after the project exists on the host. */
async function applyProjectChoice(project, choice) {
  if (choice.folder) await hostRequest('workbench/bind', {projectId: project.id, folder: choice.folder});
  if (choice.envId && projectEnvs?.envs) await hostRequest('python/bind', {scope: 'project', targetId: project.id, envId: choice.envId});
}

// ---------- independent chat dialog ----------
async function openChatDialog() {
  const envs = await pythonEnvs();
  modal('新建独立对话', `<div class="creation-dialog-body">
    <div class="field"><span class="label">工作文件夹</span>
      <label class="creation-choice"><input type="radio" name="chat-folder" value="new" checked><span><b>为这个对话新建文件夹</b><small>在 ScienceScope 数据目录下，与其他对话互不干扰</small></span></label>
      <label class="creation-choice"><input type="radio" name="chat-folder" value="shared"><span><b>独立对话公共文件夹</b><small>所有独立对话共用一个文件夹</small></span></label>
      <label class="creation-choice"><input type="radio" name="chat-folder" value="existing"><span><b>使用已有文件夹</b><small>文件不会被移动或覆盖；"询问"模式下模型只能写这个文件夹</small></span></label>
      <div class="creation-folder-row"><input id="chat-folder-path" placeholder="完整路径，例如 D:\\研究\\资料" aria-label="已有文件夹路径" disabled><button type="button" class="btn tiny" data-creation-pick disabled>选择…</button></div>
      <p class="hint creation-note" data-chat-folder-note></p>
    </div>
    ${envField('chat-python', envs)}
    <div class="saverow"><button type="button" class="btn" data-creation-cancel>取消</button><button type="button" class="btn primary" data-creation-start>开始对话</button></div>
  </div>`, 'creation-dialog');
  const root = document.querySelector('#modal .creation-dialog');
  if (!root) return;
  const path = root.querySelector('#chat-folder-path'); const pick = root.querySelector('[data-creation-pick]'); const note = root.querySelector('[data-chat-folder-note]');
  let confirmedWarning = null;
  const mark = () => { for (const choice of root.querySelectorAll('.creation-choice')) choice.toggleAttribute('data-selected', choice.querySelector('input').checked); };
  mark();
  root.addEventListener('change', event => {
    if (event.target.name !== 'chat-folder') return;
    mark();
    const existing = event.target.value === 'existing';
    path.disabled = pick.disabled = !existing; note.textContent = ''; delete note.dataset.error;
    if (existing) path.focus();
  });
  pick.addEventListener('click', async () => { const folder = await pickFolder(); if (folder) { path.value = folder; note.textContent = ''; } });
  root.querySelector('[data-creation-cancel]').addEventListener('click', () => document.getElementById('modal')?.remove());
  root.querySelector('[data-creation-start]').addEventListener('click', async () => {
    const mode = root.querySelector('input[name="chat-folder"]:checked').value;
    const choice = {mode};
    if (mode === 'existing') {
      try {
        const checked = await checkFolder(path.value.trim());
        choice.folder = checked.folder;
        if (checked.warning && confirmedWarning !== checked.folder) { confirmedWarning = checked.folder; note.textContent = checked.warning + ' 再点一次"开始对话"确认。'; delete note.dataset.error; return; }
      } catch (error) { note.textContent = error.message; note.dataset.error = ''; return; }
    }
    const select = root.querySelector('#chat-python');
    document.getElementById('modal')?.remove();
    const draft = newThread(null);
    draft.workspaceChoice = choice;
    draft.pythonEnvId = select && !select.disabled ? select.value : null;
  });
}

/** Single entry for "new chat": project chats inherit, independent chats ask.
 * An unsent independent draft made through the dialog already carries its
 * choices, so it just reopens (the startup welcome draft has none and asks). */
function newChat(projectId) {
  if (projectId || window.ScienceScopeWorkspace.draftFor('independent')?.workspaceChoice) return newThread(projectId);
  void openChatDialog();
  return null;
}

const after = window.ScienceScopeWorkspace.afterRender;
window.ScienceScopeWorkspace.afterRender = (...args) => { after?.(...args); if (route === 'project-new') void enhanceProjectPage(); };

window.ScienceScopeCreation = Object.freeze({newChat, projectChoice, applyProjectChoice, openChatDialog});
