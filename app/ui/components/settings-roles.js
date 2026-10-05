// Settings pages for AI participants, in the old interface's markup: the role
// pages (人格与记忆 for the main expert, 任务秘书, 全局助手) and the expert
// roster (专家角色). Each AI's definition is its file `agents/<id>.md`; saving
// writes a revision, so earlier versions can be restored.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { InfoTip } from './info-tip.js';

/** Model choices from the configured providers, plus the stored one if it disappeared. */
function useModelChoices() {
  const providers = useAppState((state) => state.settings?.providers ?? []);
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({
      value: JSON.stringify({ provider: provider.id, model: model.id }),
      label: `${provider.name ?? provider.id} / ${model.name ?? model.id}`,
      efforts: model.efforts ?? [],
    })),
  );
}

/** @param {{ model: any, onChange: (model: any) => void, emptyLabel: string }} props */
function ModelFields({ model, onChange, emptyLabel }) {
  const choices = useModelChoices();
  const value = model?.model
    ? JSON.stringify({ provider: model.provider, model: model.model })
    : '';
  const known = choices.find((choice) => choice.value === value);
  const efforts = known?.efforts ?? [];
  return html`<div class="field">
      <label>${t('模型')}</label>
      <select
        value=${value}
        onChange=${(event) => {
          const next = event.currentTarget.value;
          onChange(next ? { ...JSON.parse(next) } : null);
        }}
      >
        <option value="">${emptyLabel}</option>
        ${choices.map((choice) => html`<option key=${choice.value} value=${choice.value}>${choice.label}</option>`)}
        ${value && !known && html`<option value=${value}>${model.model}（${t('当前服务列表中不存在')}）</option>`}
      </select>
    </div>
    <div class="field">
      <label>${t('默认思考强度')}<${InfoTip} text=${t('只列出当前模型公开支持的强度。')} /></label>
      <select
        value=${model?.effort ?? ''}
        disabled=${!model?.model}
        onChange=${(event) =>
          onChange({ ...model, effort: event.currentTarget.value || undefined })}
      >
        <option value="">${t('模型默认')}</option>
        ${efforts.map((effort) => html`<option key=${effort} value=${effort}>${effort}</option>`)}
        ${model?.effort && !efforts.includes(model.effort) && html`<option value=${model.effort}>${model.effort}</option>`}
      </select>
    </div>`;
}

/** Saved versions of an AI's definition, each restorable. @param {{ participantId: string }} props */
function DefinitionHistory({ participantId }) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const [revisions, setRevisions] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open)
      actions.history({ resource: 'agent', key: participantId, limit: 20 }).then(setRevisions);
  }, [open, version]);
  return html`<details onToggle=${(event) => setOpen(event.currentTarget.open)}>
    <summary>${t('最近修改记录')}</summary>
    ${(revisions ?? []).map(
      (revision) =>
        html`<div class="listrow" key=${revision.id}>
          <span class="grow">${formatTime(revision.createdAt)}</span>
          ${
            revision.undoneBy
              ? html`<small>${t('已撤销')}</small>`
              : html`<button
                  class="btn tiny"
                  type="button"
                  onClick=${() => actions.attempt(() => actions.undo(revision.id))}
                >
                  ${t('撤销')}
                </button>`
          }
        </div>`,
    )}
  </details>`;
}

/**
 * The prompt and model of one built-in role.
 * @param {{ participantId: string, title: string, tip: string }} props
 */
export function RolePage({ participantId, title, tip }) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const [definition, setDefinition] = useState(/** @type {any} */ (null));
  const [saved, setSaved] = useState(0);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    actions.attempt(async () => {
      const participant = await actions.getParticipant(participantId);
      setDefinition(participant.definition);
      const history = await actions.history({ resource: 'agent', key: participantId, limit: 100 });
      setSaved(history.length);
    });
  }, [participantId, version]);

  if (!definition) return html`<p role="status">${t('正在读取…')}</p>`;
  async function submit(event) {
    event.preventDefault();
    const result = await actions.attempt(() =>
      actions.updateParticipant(participantId, {
        prompt: definition.prompt,
        model: definition.model,
      }),
    );
    if (result !== undefined) setFeedback(t('已保存，下一轮发言生效。'));
  }
  return html`<section>
    <form onSubmit=${submit}>
      <h2>${title}<${InfoTip} text=${tip} /></h2>
      <div class="field">
        <label>${t('角色 system prompt')}</label>
        <textarea
          required
          style="min-height:240px"
          value=${definition.prompt}
          onInput=${(event) => setDefinition({ ...definition, prompt: event.currentTarget.value })}
        ></textarea>
      </div>
      <${ModelFields}
        model=${definition.model}
        emptyLabel=${t('由输入框选择')}
        onChange=${(model) => setDefinition({ ...definition, model })}
      />
      <p>
        ${t('已保存版本 {n}', { n: saved })}<${InfoTip}
          text=${t('保存后从下一轮发言开始使用，已有对话的历史保留。每次保存都留有记录，可以撤销。')}
        />
      </p>
      <p role="status">${feedback}</p>
      <div class="saverow"><button type="submit" class="btn primary">${t('保存配置')}</button></div>
      <${DefinitionHistory} participantId=${participantId} />
    </form>
  </section>`;
}

const NEW_PROMPTS = {
  expert:
    'You are one expert on a ScienceScope research panel. Answer in the language the user writes in. Describe your focus here.',
  reviewer:
    'You are an independent research reviewer. Check facts, evidence, methods and conclusions for consistency. Identify unsupported claims and concrete corrections. Answer in the language the user writes in.',
};
const MAX_PER_GROUP = 8;

/** @param {{ expert: any, index: number, first: boolean, last: boolean, onChange: any, onMove: any, onRemove: any }} props */
function ExpertCard({ expert, index, first, last, onChange, onMove, onRemove }) {
  const set = (key) => (event) => onChange({ ...expert, [key]: event.currentTarget.value });
  return html`<fieldset
    class="expert-card"
    style="border:1px solid var(--line,#e3e5de);border-radius:10px;padding:12px 14px;margin:0 0 12px"
  >
    <legend>
      <small>${index + 1}</small> ${expert.name || t('未命名专家')}
      <small>${expert.id ?? ''}</small>
    </legend>
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <div class="field" style="flex:1 1 160px">
        <label>${t('名称')}</label><input required value=${expert.name} onInput=${set('name')} />
      </div>
      <div class="field" style="flex:1 1 160px">
        <label>${t('职责标签')}</label><input value=${expert.role} onInput=${set('role')} />
      </div>
      <div class="row" style="flex:3 1 420px;gap:10px">
        <${ModelFields}
          model=${expert.model}
          emptyLabel=${t('使用对话所选模型')}
          onChange=${(model) => onChange({ ...expert, model })}
        />
      </div>
    </div>
    <div class="field">
      <label
        >${t('角色提示词')}<${InfoTip}
          text=${t('写明职责、侧重和必查清单。提示词不授予工具权限。')}
      /></label>
      <textarea
        required
        style="min-height:120px"
        value=${expert.prompt}
        onInput=${set('prompt')}
      ></textarea>
    </div>
    <div class="row" style="gap:8px;align-items:center">
      <label style="display:flex;gap:6px;align-items:center">
        <input
          type="checkbox"
          checked=${expert.enabled !== false}
          onChange=${(event) => onChange({ ...expert, enabled: event.currentTarget.checked })}
        />${t('启用')}
      </label>
      <span class="spacer"></span>
      <button type="button" class="btn tiny" disabled=${first} onClick=${() => onMove(-1)}>
        ${t('上移')}
      </button>
      <button type="button" class="btn tiny" disabled=${last} onClick=${() => onMove(1)}>
        ${t('下移')}
      </button>
      <button type="button" class="btn tiny" onClick=${onRemove}>${t('移除')}</button>
    </div>
  </fieldset>`;
}

/** The roster for discussions and @ invitations. */
export function ExpertsPage() {
  const actions = useActions();
  const participants = useAppState((state) => state.participants);
  const [roster, setRoster] = useState(/** @type {any[] | null} */ (null));
  const [removed, setRemoved] = useState(/** @type {string[]} */ ([]));
  const [feedback, setFeedback] = useState('');

  async function load() {
    const ais = participants.filter((p) => p.kind === 'ai');
    const full = await Promise.all(ais.map((p) => actions.getParticipant(p.id)));
    setRoster(
      full
        .filter((p) => p.definition.panel)
        .map((p) => ({ id: p.id, ...p.definition }))
        .sort((a, b) => a.position - b.position),
    );
    setRemoved([]);
  }
  useEffect(() => {
    actions.attempt(load);
  }, []);
  if (!roster)
    return html`<h2>${t('专家角色')}</h2>
      <p role="status">${t('正在读取专家名册…')}</p>`;

  const change = (next) => {
    setRoster(next);
    setFeedback(t('有未保存的修改。'));
  };
  const active = roster.filter((expert) => expert.enabled !== false && expert.panel === 'expert');
  const models = new Set(active.map((expert) => expert.model?.model ?? '(conversation)'));

  async function save(event) {
    event.preventDefault();
    const result = await actions.attempt(async () => {
      for (const id of removed) await actions.updateParticipant(id, { panel: null });
      for (const [position, expert] of roster.entries()) {
        const definition = {
          name: expert.name.trim(),
          role: expert.role.trim(),
          prompt: expert.prompt,
          model: expert.model,
          panel: expert.panel,
          enabled: expert.enabled !== false,
          position,
        };
        if (expert.id) await actions.updateParticipant(expert.id, definition);
        else await actions.createParticipant({ kind: 'ai', name: definition.name, definition });
      }
      await load();
      return true;
    });
    if (result) setFeedback(t('名册已保存。'));
  }

  return html`<form onSubmit=${save}>
    <h2>
      ${t('专家角色')}<${InfoTip}
        text=${t('有序讨论时，所选专家读取同一份前文后并行独立作答，按下面的顺序展示，可指定一位审核专家最后核查。\n工作模式中用 @名称 邀请专家回答。\n专家的侧重由提示词决定，工具权限仍由对话的执行策略决定。')}
      />
    </h2>
    ${
      active.length > 1 &&
      models.size === 1 &&
      html`<p class="hint" role="note">
        ${t('当前参加讨论的专家都使用同一个模型。为不同专家选择不同厂商的模型，分歧通常更有信息量。')}
      </p>`
    }
    ${['expert', 'reviewer'].map((kind) => {
      const group = roster
        .map((expert, index) => ({ expert, index }))
        .filter(({ expert }) => expert.panel === kind);
      return html`<section key=${kind}>
        <div class="row">
          <h3>
            ${kind === 'reviewer' ? t('独立审核') : t('参加专家')}<${InfoTip}
              text=${kind === 'reviewer' ? t('只在讨论最后审核各专家的回答，不参与作答。') : t('参加有序讨论并作答，也可以被选为审核。')}
            />
          </h3>
          <span class="spacer"></span>
          <button
            type="button"
            class="btn tiny"
            disabled=${group.length >= MAX_PER_GROUP}
            onClick=${() =>
              change([
                ...roster,
                {
                  name: kind === 'reviewer' ? t('独立审核人') : t('新专家'),
                  role: '',
                  prompt: NEW_PROMPTS[kind],
                  model: null,
                  panel: kind,
                  enabled: true,
                },
              ])}
          >
            ${kind === 'reviewer' ? t('添加独立审核') : t('添加专家')}
          </button>
        </div>
        ${group.map(
          ({ expert, index }, n) =>
            html`<${ExpertCard}
              key=${expert.id ?? `new-${index}`}
              expert=${expert}
              index=${n}
              first=${n === 0}
              last=${n === group.length - 1}
              onChange=${(next) => change(roster.map((e, i) => (i === index ? next : e)))}
              onMove=${(step) => {
                const target = group[n + step].index;
                const next = roster.slice();
                [next[index], next[target]] = [next[target], next[index]];
                change(next);
              }}
              onRemove=${() => {
                if (expert.id) setRemoved([...removed, expert.id]);
                change(roster.filter((_, i) => i !== index));
              }}
            />`,
        )}
      </section>`;
    })}
    <div class="saverow">
      <span class="spacer"></span
      ><button type="submit" class="btn primary">${t('保存名册')}</button>
    </div>
    <p role="status">${feedback}</p>
  </form>`;
}
