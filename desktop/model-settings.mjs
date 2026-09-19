import { PROTOCOLS, validateProviderDraft } from './provider-draft.mjs';
import { hostRequest } from './host-client.mjs';

// Credentials go directly to DSH's write-only service, never prototype state,
// browser storage or exported snapshots. Unsaved non-secret fields stay local.
const drafts = [];
let editing = null;
let draft = emptyDraft();
let errors = {};
let host = {available:false, saveProvider:false, discoverModels:false};
let busy = false;
let notice = '';
let selectedModel = null;
window.ScienceScopeModels = {selected:()=>selectedModel, available:()=>host.available,select(model){selectedModel=model;S.settings.model=model?.modelId || '未连接模型';}};
function emptyDraft() { return { name: '', baseUrl: '', protocol: '', models: '' }; }
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const action = (label, name, extra = '', style = '') => `<button type="button" class="btn ${style}" data-api-action="${name}" ${extra}>${label}</button>`;
const error = name => `<span class="api-error" id="api-error-${name}">${escape(errors[name] || '')}</span>`;
const input = (name, title, placeholder) => `<div class="field"><label class="label" for="api-${name}">${title}</label><input id="api-${name}" data-api-field="${name}" value="${escape(draft[name])}" placeholder="${escape(placeholder)}" aria-describedby="api-error-${name}" aria-invalid="${!!errors[name]}">${error(name)}</div>`;

function providerRow(p,index) {
  const status = p.saved ? p.configured ? '已保存 · 未测试' : '已保存 · 未设置密钥' : '草稿 · 未连接';
  const models = p.models.map(model => p.saved
    ? action(escape(model),'select',`data-provider="${escape(p.id)}" data-model="${escape(model)}"`,'tag')
    : `<span class="tag">${escape(model)}</span>`).join('');
  return `<article class="card api-provider"><div class="between"><div><h2>${escape(p.name)}</h2><small class="muted">${escape(PROTOCOLS.find(x=>x.id===p.protocol)?.label)}</small></div><span class="tag">${status}</span></div><p class="api-address">${escape(p.baseUrl)}</p><div class="api-models">${models}</div><div class="saverow">${action('编辑','edit',`data-index="${index}"`)}${action(p.saved?'移除服务':'移除草稿','remove',`data-index="${index}"`)}</div></article>`;
}

modelsPage = function () {
  return `<div class="api-settings">${pageintro('模型与 API', '添加服务，再选择需要的模型。', action('＋ 添加服务', 'new', '', 'primary'))}
  <div class="api-notice">${escape(notice || (host.saveProvider ? '配置由本地 DSH 管理。保存后尚需实际请求验证模型可用。' : '宿主尚未就绪 · 草稿仅保留在本次窗口，刷新会清空。请勿输入真实密钥。'))}</div>
  ${drafts.length ? `<div class="stack">${drafts.map(providerRow).join('')}</div>` : `<div class="api-empty card"><div class="api-empty-icon">${ic('key')}</div><h2>连接你的模型服务</h2><p class="muted">使用自己的 API 服务；没有模型列表的服务，也可以手动添加。</p>${action('添加第一个服务', 'new', '', 'primary')}</div>`}
  </div>`;
};

providerPage = function () {
  return `<div class="settingform api-settings">${action('← 模型与 API', 'back')}${pageintro(editing === null ? '添加模型服务' : '编辑模型服务', '填写服务地址，明确选择协议。')}
  <div class="api-notice">${escape(notice || (host.saveProvider ? '保存到本地 DSH。密钥不进入聊天或研究材料。' : '当前只编辑配置草稿。真实凭证保存、连接测试与模型发现将在 DSH 接通后开放。'))}</div>
  <form id="api-provider-form" novalidate>
  ${input('name', '服务名称', '例如：我的研究模型')}
  <div class="field"><label class="label" for="api-protocol">API 格式</label><select id="api-protocol" data-api-field="protocol" aria-describedby="api-error-protocol" aria-invalid="${!!errors.protocol}"><option value="">选择服务明确支持的协议</option>${PROTOCOLS.map(p => `<option value="${p.id}" ${draft.protocol === p.id ? 'selected' : ''}>${escape(p.label)}</option>`).join('')}</select>${error('protocol')}</div>
  ${input('baseUrl', '接口地址 · Base URL', 'https://api.example.com/v1')}
  <div class="field"><label class="label" for="api-key-preview">API Key</label><input id="api-key-preview" type="password" ${host.saveProvider ? '' : 'disabled'} placeholder="${host.saveProvider ? '输入 API Key（不回显已存密钥）' : '凭证存储接通后可填写'}" autocomplete="off"><small class="muted">密钥不会保存在页面草稿或研究文件中。</small></div>
  <div class="between api-model-heading"><h3>模型</h3><button type="button" class="btn" data-api-action="discover" ${!host.discoverModels || busy ? 'disabled' : ''}>${busy ? '处理中…' : '获取模型列表'}</button></div>
  <div class="field"><label class="label" for="api-models">模型 ID <small class="muted">每行一个，可直接手动填写</small></label><textarea id="api-models" data-api-field="models" rows="4" placeholder="服务商提供的准确模型 ID" aria-describedby="api-error-models" aria-invalid="${!!errors.models}">${escape(draft.models)}</textarea>${error('models')}</div>
  <details class="card subtle"><summary>连接说明</summary><p class="muted">地址请按服务商文档填写；协议不会根据模型名自动猜测。模型列表由 DSH 查询，不支持列表的服务可直接手填模型 ID。编辑时留空密钥会保留原密钥。</p></details>
  <div class="saverow">${action('取消', 'back')}<button type="submit" class="btn primary" ${busy ? 'disabled' : ''}>${busy ? '保存中…' : host.saveProvider ? '保存服务' : '保存草稿'}</button></div>
  <p class="muted api-footnote">保存草稿 ≠ 已连接 ≠ 模型可用</p>
  </form></div>`;
};

function navigate(page) { closeMenu(); go(page); }
window.addEventListener('input', event => {
  const field = event.target.dataset?.apiField;
  if (field && Object.hasOwn(draft, field)) draft[field] = event.target.value;
}, true);
window.addEventListener('change', event => {
  const field = event.target.dataset?.apiField;
  if (field && Object.hasOwn(draft, field)) draft[field] = event.target.value;
}, true);
window.addEventListener('submit', async event => {
  if (event.target.id !== 'api-provider-form') return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (busy) return;
  const result = validateProviderDraft(draft);
  if (!result.ok) {
    errors = result.errors; render();
    document.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  if (host.saveProvider) {
    busy = true;
    const keyField = document.getElementById('api-key-preview');
    const apiKey = keyField?.value || '';
    if (keyField) keyField.value = '';
    try {
      await hostRequest('providers/save', {...result.value, id:editing === null ? undefined : drafts[editing]?.id, apiKey});
      await refreshProviders();
      notice = '已保存到 DSH；尚未验证模型实际可用。';
    } catch (error) { notice = error.message; busy = false; render(); return; }
    finally { busy = false; }
  } else if (editing === null) drafts.push(result.value); else drafts[editing] = result.value;
  errors = {}; draft = emptyDraft(); editing = null;
  navigate('models');
}, true);
window.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target) return;
  const modelMenu = target.dataset.v === 'model-menu' || target.dataset.action === 'model-menu';
  const operation = target.dataset.apiAction;
  if (!modelMenu && !operation) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (modelMenu) {
    const choices = host.available ? drafts.filter(p => p.id).flatMap(p => p.models.map(id => ({text:`${p.name} / ${id}`, act:'api-select-model', attrs:`data-provider="${escape(p.id)}" data-model="${escape(id)}"`}))) : [];
    menu([...choices, {sep:true}, navItem('管理模型与 API', 'models', undefined, 'gear')], target, '模型');
    return;
  }
  const index = Number(target.dataset.index);
  if (busy) return;
  if (operation === 'select') {
    selectedModel = {providerId:target.dataset.provider,modelId:target.dataset.model};
    S.settings.model = target.dataset.model;
    toast('已选择模型，将用于下一次发送。');
    go('work'); return;
  }
  if (operation === 'discover') {
    const check = validateProviderDraft({...draft,models:['discovery-placeholder']});
    if (!check.ok) { errors = check.errors; render(); return; }
    busy = true;
    const key = document.getElementById('api-key-preview');
    const apiKey = key?.value || '';
    try {
      const result = await hostRequest('providers/discover', {...check.value,id:editing === null ? undefined : drafts[editing]?.id,apiKey});
      draft.models = [...new Set([...draft.models.split('\n').map(x=>x.trim()).filter(Boolean),...result.models.map(m => typeof m === 'string' ? m : m.id)])].join('\n');
      notice = result.models.length ? '已获取模型列表，请确认后保存。' : '服务未返回模型，可以手动填写模型 ID。';
      document.getElementById('api-models').value = draft.models;
      toast(notice);
    } catch(error) { toast(error.message + '；仍可手动填写模型 ID。'); }
    finally { busy = false; }
    return;
  }
  if (operation === 'new') { editing = null; draft = emptyDraft(); errors = {}; navigate('provider'); }
  else if (operation === 'edit' && drafts[index]) { editing = index; draft = {...drafts[index], models: drafts[index].models.join('\n')}; errors = {}; navigate('provider'); }
  else if (operation === 'remove' && drafts[index]) {
    if (drafts[index].saved) {
      const approved = window.ScienceScopeWorkspace?.confirmAction
        ? await window.ScienceScopeWorkspace.confirmAction('移除模型服务','移除这个服务及由它管理的密钥？\n已有聊天记录不会删除，使用它的聊天将暂时不能继续。','移除服务')
        : confirm('移除这个服务及由它管理的密钥？已有聊天记录不会删除。');
      if (!approved) return;
      try { await hostRequest('providers/remove',{id:drafts[index].id}); await refreshProviders(); render(); }
      catch(error) { toast(error.message); }
      return;
    }
    drafts.splice(index, 1); render();
  }
  else if (operation === 'back') { errors = {}; navigate('models'); }
}, true);

const originalFooter = typeof footer === 'function' ? footer : null;
if (originalFooter) footer = () => originalFooter().replace('交互原型 · 未连接模型',host.saveProvider ? `桌面开发版 · DSH 已接入 · ${host.tokenStreaming ? '流式输出' : '消息级输出'}` : '桌面开发版 · 等待 DSH 服务');
S.settings.model = '未连接模型';
render();

window.addEventListener('click', event => {
  const target = event.target.closest('[data-v="api-select-model"]');
  if (!target) return;
  event.preventDefault(); event.stopImmediatePropagation();
  selectedModel = {providerId:target.dataset.provider, modelId:target.dataset.model};
  S.settings.model = target.dataset.model;
  closeMenu(); render();
},true);

async function refreshProviders() {
  const result = await hostRequest('providers');
  drafts.splice(0,drafts.length,...result.providers);
}
hostRequest('status').then(async status => {
  host = status;
  if (host.available) await refreshProviders();
  render();
}).catch(()=>{});
