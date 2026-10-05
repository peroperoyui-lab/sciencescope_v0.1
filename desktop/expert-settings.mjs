// Settings → 专家角色: the persisted expert panel used by 有序讨论 and @ invitations.
// Ids stay stable when a label changes; the host validates every field.
import {infoTip} from './info-tip.mjs';
import {hostRequest} from './host-client.mjs';

let roster = null, providers = [], skills = [], failure = '', feedback = '';
const option = (value, label, selected) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;

function modelChoices(current) {
  const choices = providers.flatMap(p => p.models.map(modelId => ({value: JSON.stringify({providerId: p.id, modelId}), label: `${p.name} / ${modelId}`})));
  const value = current ? JSON.stringify(current) : '';
  if (value && !choices.some(choice => choice.value === value)) choices.push({value, label: `${current.modelId}（当前服务列表中不存在）`});
  return option('', '使用对话所选模型', !value) + choices.map(choice => option(choice.value, choice.label, choice.value === value)).join('');
}

function card(expert, index, first, last) {
  return `<fieldset class="expert-card" data-expert-index="${index}" style="border:1px solid var(--line,#e3e5de);border-radius:10px;padding:12px 14px;margin:0 0 12px">
    <legend><small>${index + 1}</small> <span data-i18n-skip>${esc(expert.label || '未命名专家')}</span> <small data-i18n-skip>${esc(expert.id)}</small></legend>
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 160px"><label>名称</label><input name="label" maxlength="40" required value="${esc(expert.label)}"></div>
      <div class="field" style="flex:1 1 160px"><label>职责标签</label><input name="role" maxlength="40" value="${esc(expert.role || '')}"></div>
      <div class="field" style="flex:2 1 260px"><label>模型</label><select name="model">${modelChoices(expert.model)}</select></div>
      <div class="field" style="flex:1 1 160px"><label>思考强度${infoTip('只列出当前模型公开支持的强度。', {label:'思考强度说明'})}</label><select name="reasoningEffort">${option('', '模型默认', !expert.reasoningEffort)}${expert.reasoningEffort ? option(expert.reasoningEffort, expert.reasoningEffort, true) : ''}</select><small data-expert-effort-status></small></div>
    </div>
    <div class="field"><label>角色提示词${infoTip('写明职责、侧重和必查清单。提示词不授予工具权限。', {label: '角色提示词说明'})}</label><textarea name="persona" maxlength="16000" required style="min-height:120px">${esc(expert.persona)}</textarea></div>
    <div class="field"><label>绑定技能${infoTip('已启用的技能在下一轮提供给此专家，不改变文件或工具权限。', {label:'绑定技能说明'})}</label>
      <div style="display:flex;gap:12px;flex-wrap:wrap">${skills.filter(skill => skill.enabled && skill.valid !== false).map(skill => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="skills" value="${esc(skill.name)}" ${(expert.skills || []).includes(skill.name) ? 'checked' : ''}><span data-i18n-skip>${esc(skill.name)}</span></label>`).join('') || '<small>没有已启用的技能。</small>'}</div>
      ${(expert.skills || []).filter(name => !skills.some(skill => skill.name === name && skill.enabled && skill.valid !== false)).map(name => `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="skills" value="${esc(name)}" checked><span data-i18n-skip>${esc(name)}</span><small>技能不可用，请取消绑定或重新启用。</small></label>`).join('')}
    </div>
    <div class="row" style="gap:8px;align-items:center">
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="enabled" ${expert.enabled !== false ? 'checked' : ''}>启用</label>
      <span class="spacer"></span>
      <button type="button" class="btn tiny" data-expert-move="-1" ${first ? 'disabled' : ''}>上移</button>
      <button type="button" class="btn tiny" data-expert-move="1" ${last ? 'disabled' : ''}>下移</button>
      <button type="button" class="btn tiny" data-expert-remove>移除</button>
    </div>
  </fieldset>`;
}

export function expertSettingsContent() {
  if (!roster) return `<h2>专家角色</h2><p role="status">${esc(failure || '正在读取专家名册…')}</p>`;
  const active = roster.filter(expert => expert.enabled !== false && expert.kind !== 'reviewer');
  const models = new Set(active.map(expert => expert.model ? expert.model.modelId : '(对话模型)'));
  const sameModel = active.length > 1 && models.size === 1;
  return `<form data-expert-roster><h2>专家角色${infoTip('有序讨论时，所选专家读取同一份前文后并行独立作答，按下面的顺序展示，可指定一位审核专家最后核查。\n工作模式中用 @名称 邀请专家回答。\n专家的侧重由提示词决定，工具权限仍由对话的执行策略决定。', {label: '专家角色说明'})}</h2>
    ${sameModel ? '<p class="hint" role="note">当前参加讨论的专家都使用同一个模型。为不同专家选择不同厂商的模型，分歧通常更有信息量。</p>' : ''}
    ${['expert','reviewer'].map(kind => {
      const group = roster.map((expert,index) => ({expert,index})).filter(({expert}) => (expert.kind || 'expert') === kind);
      return `<section data-expert-group="${kind}"><div class="row"><h3>${kind === 'reviewer' ? '独立审核' : '参加专家'}${infoTip(kind === 'reviewer' ? '只在讨论最后审核各专家的回答，不参与作答。' : '参加有序讨论并作答，也可以被选为审核。', {label:kind === 'reviewer' ? '独立审核说明' : '参加专家说明'})}</h3><span class="spacer"></span><button type="button" class="btn tiny" data-expert-add="${kind}" ${group.length >= 8 ? 'disabled' : ''}>${kind === 'reviewer' ? '添加独立审核' : '添加专家'}</button></div>${group.map(({expert,index},position) => card(expert,index,position === 0,position === group.length-1)).join('') || '<p class="hint">此组尚无专家。</p>'}</section>`;
    }).join('')}
    <div class="saverow"><span class="spacer"></span><button type="submit" class="btn primary">保存名册</button></div>
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
      reasoningEffort: node.querySelector('[name="reasoningEffort"]').value || null,
      skills: [...node.querySelectorAll('[name="skills"]:checked')].map(input => input.value),
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
  if (button.hasAttribute('data-expert-add')) {
    const kind=button.dataset.expertAdd;
    roster.push({id: 'expert-' + crypto.randomUUID().slice(0, 8), kind, skills:[], label: kind === 'reviewer' ? '独立审核人' : '新专家', role: '', persona: kind === 'reviewer' ? 'You are an independent research reviewer. Check facts, evidence, methods and conclusions for consistency. Identify unsupported claims and concrete corrections. Answer in the language the user writes in.' : 'You are one expert on a ScienceScope research panel. Answer in the language the user writes in. Describe your focus here.', model: null, reasoningEffort: null, enabled: true});
    roster.sort((a,b) => Number(a.kind === 'reviewer') - Number(b.kind === 'reviewer'));
  }
  else {
    const index = Number(button.closest('[data-expert-index]').dataset.expertIndex);
    if (button.hasAttribute('data-expert-remove')) roster.splice(index, 1);
    else { const to = index + Number(button.dataset.expertMove); if(roster[to] && (roster[to].kind || 'expert') === (roster[index].kind || 'expert')) [roster[index], roster[to]] = [roster[to], roster[index]]; }
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
    [{experts: roster}, {providers}, {skills}] = await Promise.all([hostRequest('experts'), hostRequest('providers').catch(() => ({providers: []})), hostRequest('skills')]);
    roster.sort((a,b) => Number(a.kind === 'reviewer') - Number(b.kind === 'reviewer'));
    failure = '';
  } catch { failure = '专家名册读取失败，请重开此页重试。'; }
}
export const expertSettingsReady = refresh().then(() => { if (route === 'experts') render(); });

async function loadEfforts(card) {
  const select=card.querySelector('[name="model"]'), effort=card.querySelector('[name="reasoningEffort"]');
  const value=select.value, current=effort.value;
  const model=value ? JSON.parse(value) : window.ScienceScopeModels?.selected();
  const note=card.querySelector('[data-expert-effort-status]');
  if(!model){note.textContent='选择模型后可读取支持的强度。';return;}
  try {
    const info=await hostRequest('model-info?'+new URLSearchParams(model));
    if(!card.isConnected || select.value!==value)return;
    const choices=info.reasoning?.efforts || [];
    effort.innerHTML=option('','模型默认',!current)+choices.map(item=>option(item.id,item.name,item.id===current)).join('')+(current&&!choices.some(item=>item.id===current)?option(current,current,true):'');
    note.textContent=current&&!choices.some(item=>item.id===current)?'已保存的强度不在当前模型能力中，请重新选择。':choices.length?'':'此模型未声明可调强度，使用默认。';
  }catch{if(card.isConnected)note.textContent='模型能力读取失败，保存前请核对模型配置。';}
}
window.addEventListener('input',event=>{const form=event.target.closest('[data-expert-roster]');if(form)roster=collect(form);},true);
window.addEventListener('change',event=>{
  const form=event.target.closest('[data-expert-roster]');if(!form)return;
  const card=event.target.closest('[data-expert-index]');
  if(event.target.name==='model'){card.querySelector('[name="reasoningEffort"]').innerHTML=option('','模型默认',true);void loadEfforts(card);}
  roster=collect(form);
},true);
const mountedCards=new WeakSet();new MutationObserver(()=>{for(const card of document.querySelectorAll('[data-expert-index]'))if(!mountedCards.has(card)){mountedCards.add(card);void loadEfforts(card);}}).observe(document.body,{childList:true,subtree:true});

// Skills and providers can be edited elsewhere without restarting the client.
// Refresh their choices on entry, keeping this page's unsaved expert edits.
let onExpertPage=false;
new MutationObserver(()=>{
  if(route!=='experts'){onExpertPage=false;return;}
  if(onExpertPage)return;onExpertPage=true;
  void Promise.all([hostRequest('skills'),hostRequest('providers')]).then(([catalog,models])=>{
    if(JSON.stringify(skills)===JSON.stringify(catalog.skills)&&JSON.stringify(providers)===JSON.stringify(models.providers))return;
    const form=route==='experts'?document.querySelector('[data-expert-roster]'):null;
    if(form)roster=collect(form);
    skills=catalog.skills;providers=models.providers;
    if(form)repaint(form);
  }).catch(error=>{const node=route==='experts'?document.querySelector('[data-expert-feedback]'):null;if(node)node.textContent=error.message;});
}).observe(document.body,{childList:true,subtree:true});
