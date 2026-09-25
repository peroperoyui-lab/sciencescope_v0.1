// Settings → 专家角色: the persisted expert panel used by 有序讨论 and @ invitations.
// Ids stay stable when a label changes; the host validates every field.
import {infoTip} from './info-tip.mjs';
import {hostRequest} from './host-client.mjs';

let roster = null, providers = [], failure = '', feedback = '';
const option = (value, label, selected) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;

function modelChoices(current) {
  const choices = providers.flatMap(p => p.models.map(modelId => ({value: JSON.stringify({providerId: p.id, modelId}), label: `${p.name} / ${modelId}`})));
  const value = current ? JSON.stringify(current) : '';
  if (value && !choices.some(choice => choice.value === value)) choices.push({value, label: `${current.modelId}（当前服务列表中不存在）`});
  return option('', '使用对话所选模型', !value) + choices.map(choice => option(choice.value, choice.label, choice.value === value)).join('');
}

function card(expert, index, count) {
  return `<fieldset class="expert-card" data-expert-index="${index}" style="border:1px solid var(--line,#e3e5de);border-radius:10px;padding:12px 14px;margin:0 0 12px">
    <legend><small>${index + 1}</small> ${esc(expert.label || '未命名专家')} <small>${esc(expert.id)}</small></legend>
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 160px"><label>名称</label><input name="label" maxlength="40" required value="${esc(expert.label)}"></div>
      <div class="field" style="flex:1 1 160px"><label>职责标签</label><input name="role" maxlength="40" value="${esc(expert.role || '')}"></div>
      <div class="field" style="flex:2 1 260px"><label>模型</label><select name="model">${modelChoices(expert.model)}</select></div>
    </div>
    <div class="field"><label>角色提示词${infoTip('写明职责、侧重和必查清单。提示词不授予工具权限。', {label: '角色提示词说明'})}</label><textarea name="persona" maxlength="16000" required style="min-height:120px">${esc(expert.persona)}</textarea></div>
    <div class="row" style="gap:8px;align-items:center">
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="enabled" ${expert.enabled !== false ? 'checked' : ''}>参加讨论</label>
      <span class="spacer"></span>
      <button type="button" class="btn tiny" data-expert-move="-1" ${index === 0 ? 'disabled' : ''}>上移</button>
      <button type="button" class="btn tiny" data-expert-move="1" ${index === count - 1 ? 'disabled' : ''}>下移</button>
      <button type="button" class="btn tiny" data-expert-remove>移除</button>
    </div>
  </fieldset>`;
}

export function expertSettingsContent() {
  if (!roster) return `<h2>专家角色</h2><p role="status">${esc(failure || '正在读取专家名册…')}</p>`;
  const active = roster.filter(expert => expert.enabled !== false);
  const models = new Set(active.map(expert => expert.model ? expert.model.modelId : '(对话模型)'));
  const sameModel = active.length > 1 && models.size === 1;
  return `<form data-expert-roster><h2>专家角色${infoTip('有序讨论时，所选专家读取同一份前文后并行独立作答，按下面的顺序展示，可指定一位审核专家最后核查。\n工作模式中用 @名称 邀请专家回答。\n专家的侧重由提示词决定，工具权限仍由对话的执行策略决定。', {label: '专家角色说明'})}</h2>
    ${sameModel ? '<p class="hint" role="note">当前参加讨论的专家都使用同一个模型。为不同专家选择不同厂商的模型，分歧通常更有信息量。</p>' : ''}
    ${roster.map((expert, index) => card(expert, index, roster.length)).join('') || '<p class="hint">名册为空；讨论前请至少添加一位专家。</p>'}
    <div class="saverow"><button type="button" class="btn" data-expert-add ${roster.length >= 8 ? 'disabled' : ''}>添加专家</button><span class="spacer"></span><button type="submit" class="btn primary">保存名册</button></div>
    <p data-expert-feedback role="status">${esc(feedback)}</p>
  </form>`;
}

// Read the form back into the working copy before any structural change, so
// edits in other cards survive add/move/remove.
function collect(form) {
  return [...form.querySelectorAll('[data-expert-index]')].map(node => {
    const previous = roster[Number(node.dataset.expertIndex)];
    const model = node.querySelector('[name="model"]').value;
    return {...previous, label: node.querySelector('[name="label"]').value, role: node.querySelector('[name="role"]').value,
      persona: node.querySelector('[name="persona"]').value, model: model ? JSON.parse(model) : null,
      enabled: node.querySelector('[name="enabled"]').checked};
  });
}
function repaint(form) { const template = document.createElement('template'); template.innerHTML = expertSettingsContent(); form.replaceWith(template.content.firstElementChild); }

window.addEventListener('click', event => {
  const button = event.target.closest('[data-expert-add],[data-expert-move],[data-expert-remove]');
  const form = button?.closest('[data-expert-roster]');
  if (!form) return;
  event.preventDefault(); event.stopImmediatePropagation();
  roster = collect(form); feedback = '有未保存的修改。';
  if (button.hasAttribute('data-expert-add')) roster.push({id: 'expert-' + crypto.randomUUID().slice(0, 8), label: '新专家', role: '', persona: 'You are one expert on a ScienceScope research panel. Answer in the language the user writes in. Describe your focus here.', model: null, reasoningEffort: null, enabled: true});
  else {
    const index = Number(button.closest('[data-expert-index]').dataset.expertIndex);
    if (button.hasAttribute('data-expert-remove')) roster.splice(index, 1);
    else { const to = index + Number(button.dataset.expertMove); [roster[index], roster[to]] = [roster[to], roster[index]]; }
  }
  repaint(form);
}, true);

window.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.matches?.('[data-expert-roster]')) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const next = collect(form);
  const button = form.querySelector('[type="submit"]'); button.disabled = true;
  try {
    ({experts: roster} = await hostRequest('experts', {experts: next.map(({position, ...expert}) => expert)}));
    feedback = `已保存 ${roster.length} 位专家；下一轮讨论生效。`;
    await window.ScienceScopeDiscussion?.reload();
  } catch (error) { roster = next; feedback = error.message; }
  repaint(document.querySelector('[data-expert-roster]') || form);
}, true);

async function refresh() {
  try {
    [{experts: roster}, {providers}] = await Promise.all([hostRequest('experts'), hostRequest('providers').catch(() => ({providers: []}))]);
    failure = '';
  } catch { failure = '专家名册读取失败，请重开此页重试。'; }
}
export const expertSettingsReady = refresh().then(() => { if (route === 'experts') render(); });
