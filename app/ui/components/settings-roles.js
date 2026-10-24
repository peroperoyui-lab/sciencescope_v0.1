// Settings → 专家 (design system PageSettingsExperts, PageSettingsExpertDetail):
// the roster of the main expert, the discussion experts and the independent
// reviewers, and one detail page for any AI role (the secretary and the
// assistant open it too). Each AI's definition is its file `agents/<id>.md`;
// every change writes a revision that can be undone.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { thinkingChoices, useModelCatalog } from '../model-catalog.js';
import { navigate } from '../route.js';
import { effortName } from './model-picker.js';
import { usePopover } from './popover.js';
import { SkillBinding } from './settings-skills.js';
import { AutoText, Head, Row, Saved, Section, Seg, Select, Switch } from './settings-kit.js';

const BUILT_IN = {
  agent_main: { name: '主专家', avatar: '主', back: ['experts', '专家'] },
  agent_secretary: { name: '任务秘书', avatar: '秘', back: ['secretary', '任务秘书'] },
  agent_assistant: { name: '全局助手', avatar: '助', back: ['assistant', '全局助手'] },
};

const NEW_PROMPTS = {
  expert:
    'You are one expert on a ScienceScope research panel. Answer in the language the user writes in. Describe your focus here.',
  reviewer:
    'You are an independent research reviewer. Check facts, evidence, methods and conclusions for consistency. Identify unsupported claims and concrete corrections. Answer in the language the user writes in.',
};

/** The first character of a name, for the avatar. @param {string} name */
export const avatarOf = (name) => [...(name || '?').trim()][0] ?? '?';

/** "deepseek-v4-pro", or 跟随对话 when the role uses the conversation's model. @param {any} model */
export const modelLabel = (model) => model?.model ?? t('跟随对话');

/** Every model of the configured providers, with its thinking levels. */
function useModelChoices() {
  const providers = useModelCatalog();
  return providers.flatMap((provider) =>
    provider.models.map((model) => ({
      key: JSON.stringify({ provider: provider.id, model: model.id }),
      provider: provider.name ?? provider.id,
      text: model.name ?? model.id,
      efforts: thinkingChoices(model),
    })),
  );
}

/** "主专家 · 统筹当前任务 · 跟随对话 · 1 个技能" without the name. @param {any} definition */
function summaryOf(definition) {
  const skills = definition.skills?.length ?? 0;
  return [
    definition.role,
    modelLabel(definition.model),
    skills ? t('{n} 个技能', { n: skills }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * One AI on the roster, opening its detail page.
 * @param {{ participant: any, menu?: any, toggle?: boolean }} props
 */
export function RoleRow({ participant, menu, toggle = false }) {
  const actions = useActions();
  const definition = participant.definition;
  const name = definition.name || t(BUILT_IN[participant.id]?.name ?? '未命名专家');
  const enabled = definition.enabled !== false;
  const open = () => navigate({ view: 'settings', id: `experts/${participant.id}` });
  return html`<div
    class=${`ss-list-row ss-list-row--2 ss-list-row--link ${enabled ? '' : 'ss-list-row--done'}`}
    data-expert=${participant.id}
    onClick=${(event) => !event.target.closest('button, input') && open()}
  >
    <span class="ss-avatar">${BUILT_IN[participant.id]?.avatar ?? avatarOf(name)}</span>
    <div class="ss-list-row__main">
      <span class="ss-list-row__title">${name}</span>
      <span class="ss-list-row__sub">${summaryOf(definition)}</span>
    </div>
    ${
      toggle &&
      html`<${Switch}
        label=${t('启用 {name}', { name })}
        checked=${enabled}
        onChange=${(on) =>
          actions.attempt(() => actions.updateParticipant(participant.id, { enabled: on }))}
      />`
    }
    ${menu}
    <button
      type="button"
      class="ss-icon-btn ss-icon-btn--sm"
      aria-label=${t('打开 {name}', { name })}
      onClick=${open}
    >
      <${Lucide} name="chevron-right" />
    </button>
  </div>`;
}

/** 上移 / 下移 / 复制一份 / 删除专家 for one roster row. */
function ExpertMenu({ participant, first, last, onMove, onCopy, onRemove }) {
  const pop = usePopover({ placement: 'bottom-end' });
  const name = participant.definition.name;
  const item = (icon, text, run, extra = {}) =>
    html`<button
      type="button"
      role="menuitem"
      class=${`ss-menu__item ${extra.danger ? 'ss-menu__item--danger' : ''}`}
      aria-disabled=${extra.disabled ? 'true' : undefined}
      onClick=${() => {
        if (extra.disabled) return;
        pop.setOpen(false);
        run();
      }}
    >
      <${Lucide} name=${icon} />${text}
    </button>`;
  return html`<button
      type="button"
      ref=${pop.trigger}
      class="ss-icon-btn ss-icon-btn--sm"
      aria-label=${t('{name}的更多操作', { name })}
      aria-haspopup="menu"
      aria-expanded=${pop.open}
      data-tip=${t('更多')}
      onClick=${pop.toggle}
    >
      <${Lucide} name="ellipsis" />
    </button>
    ${
      pop.open &&
      html`<div ref=${pop.layer} class="ss-menu" role="menu" aria-label=${name}>
        ${item('arrow-up', t('上移'), () => onMove(-1), { disabled: first })}
        ${item('arrow-down', t('下移'), () => onMove(1), { disabled: last })}
        ${item('copy', t('复制一份'), onCopy)}
        <div class="ss-menu__sep" role="separator"></div>
        ${item('trash-2', t('删除专家'), onRemove, { danger: true })}
      </div>`
    }`;
}

/** Names that share one model, for the 同一个模型 note, or null. @param {any[]} experts */
function sameModel(experts) {
  const groups = new Map();
  for (const expert of experts) {
    const key = expert.definition.model?.model ?? '';
    groups.set(key, [...(groups.get(key) ?? []), expert.definition.name]);
  }
  const shared = [...groups.values()].find((names) => names.length > 1);
  if (!shared) return null;
  return shared.length === 2 ? shared.join(t('和')) : shared.join('、');
}

/** Settings → 专家: the roster. */
export function ExpertsPage() {
  const actions = useActions();
  const definitions = useAppState((state) => state.participantDefinitions);
  useEffect(() => {
    void actions.attempt(() => actions.loadParticipantDefinitions());
  }, []);
  const all = Object.values(definitions ?? {}).filter((participant) => participant.definition);
  const main = all.find((participant) => participant.id === 'agent_main');
  const panel = (kind) =>
    all
      .filter((participant) => participant.definition.panel === kind)
      .sort((a, b) => (a.definition.position ?? 0) - (b.definition.position ?? 0));
  const experts = panel('expert');
  const reviewers = panel('reviewer');
  const shared = sameModel(experts.filter((expert) => expert.definition.enabled !== false));

  async function add(kind, from = null) {
    const roster = [...experts, ...reviewers];
    const source = from?.definition;
    const name = source
      ? t('{name}（副本）', { name: source.name })
      : kind === 'reviewer'
        ? t('独立审核人')
        : t('新专家');
    const definition = {
      name,
      role: source?.role ?? '',
      prompt: source?.prompt ?? NEW_PROMPTS[kind],
      model: source?.model ?? null,
      skills: source?.skills ?? [],
      panel: kind,
      enabled: true,
      position: roster.length,
    };
    const created = await actions.attempt(() =>
      actions.createParticipant({ kind: 'ai', name, definition }),
    );
    if (created?.id) navigate({ view: 'settings', id: `experts/${created.id}` });
  }
  /** @param {any[]} group @param {number} index @param {number} step */
  async function move(group, index, step) {
    const next = group.slice();
    [next[index], next[index + step]] = [next[index + step], next[index]];
    await actions.attempt(async () => {
      for (const [position, participant] of next.entries())
        if (participant.definition.position !== position)
          await actions.updateParticipant(participant.id, { position });
    });
  }
  const remove = (participant) =>
    actions.attempt(() => actions.updateParticipant(participant.id, { panel: null }));

  /** @param {any[]} group */
  const rows = (group) =>
    html`<div class="ss-list">
      ${group.map(
        (participant, index) =>
          html`<${RoleRow}
            key=${participant.id}
            participant=${participant}
            toggle
            menu=${html`<${ExpertMenu}
              participant=${participant}
              first=${index === 0}
              last=${index === group.length - 1}
              onMove=${(step) => move(group, index, step)}
              onCopy=${() => add(participant.definition.panel, participant)}
              onRemove=${() => remove(participant)}
            />`}
          />`,
      )}
    </div>`;

  return html`<div class="ss-settings__inner" data-settings="experts">
    <${Head}
      title=${t('专家')}
      desc=${t('点开一位专家，改名字、提示词、模型和技能。改了自动保存，下一轮发言生效。')}
      tip=${t('有序讨论时，选中的专家读同一份前文、各自作答，按这里的顺序显示；独立审核在最后核查。平时在输入框里用 @名字 请某位专家发言。')}
    />
    <${Section} title=${t('主专家')} tip=${t('主专家负责统筹，一般不给它特定角色。')}>
      ${main && html`<div class="ss-list"><${RoleRow} participant=${main} /></div>`}
    <//>
    <${Section}
      title=${t('参加讨论的专家')}
      count=${experts.length}
      extra=${html`<button type="button" class="ss-btn ss-btn--sm" onClick=${() => add('expert')}>
        <${Lucide} name="plus" />${t('添加专家')}
      </button>`}
    >
      ${
        experts.length
          ? rows(experts)
          : html`<p class="ss-settings__desc">
              ${t('还没有专家。添加几位不同方向的专家，有序讨论时各自作答。')}
            </p>`
      }
      ${
        shared &&
        html`<div class="ss-callout ss-callout--warn" style="margin-top:8px">
          <${Lucide} name="lightbulb" />
          <div class="ss-callout__body">
            ${t('{names}用的是同一个模型。换成不同厂商的模型，观点更不容易雷同。', { names: shared })}
          </div>
        </div>`
      }
    <//>
    <${Section}
      title=${t('独立审核')}
      tip=${t('只在有序讨论最后核查各位专家的回答，不参与作答。审核意见经你采纳才进入后面的对话。')}
      extra=${html`<button
        type="button"
        class="ss-btn ss-btn--ghost ss-btn--sm"
        onClick=${() => add('reviewer')}
      >
        <${Lucide} name="plus" />${t('添加审核')}
      </button>`}
    >
      ${reviewers.length ? rows(reviewers) : html`<p class="ss-settings__desc">${t('没有独立审核。')}</p>`}
    <//>
  </div>`;
}

/** Saved versions of an AI's definition, each with 撤销. @param {{ participantId: string }} props */
function DefinitionHistory({ participantId }) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const definition = useAppState((state) => state.participantDefinitions?.[participantId]);
  const [revisions, setRevisions] = useState(/** @type {any[] | null} */ (null));
  useEffect(() => {
    void actions.attempt(async () =>
      setRevisions(await actions.history({ resource: 'agent', key: participantId, limit: 20 })),
    );
  }, [participantId, version, definition]);
  if (!revisions?.length) return null;
  return html`<${Section} title=${t('修改记录')} count=${revisions.length}>
    <div class="ss-list" data-definition-history>
      ${revisions.map((revision, index) => {
        // The oldest revision of a short history created the file; undoing it would remove the role.
        const first = index === revisions.length - 1 && revisions.length < 20;
        const what = revision.op === 'undo' ? t('撤销了一次修改') : first ? t('新建') : t('修改');
        return html`<div class="ss-list-row" key=${revision.id}>
          <div class="ss-list-row__main">
            <span class="ss-list-row__title">${what}</span>
          </div>
          <span class="ss-list-row__meta ss-list-row__meta--time">
            ${formatTime(revision.createdAt)}
          </span>
          ${
            revision.undoneBy
              ? html`<span class="ss-list-row__meta">${t('已撤销')}</span>`
              : !first &&
                revision.op !== 'undo' &&
                html`<button
                  type="button"
                  class="ss-btn ss-btn--ghost ss-btn--sm"
                  onClick=${() => actions.attempt(() => actions.undo(revision.id))}
                >
                  ${t('撤销')}
                </button>`
          }
        </div>`;
      })}
    </div>
  <//>`;
}

/**
 * One AI role: name, model, prompt and skills, saved as they change.
 * @param {{ participantId: string }} props
 */
export function RoleDetail({ participantId }) {
  const actions = useActions();
  const participant = useAppState((state) => state.participantDefinitions?.[participantId]);
  const choices = useModelChoices();
  const [savedAt, setSavedAt] = useState(0);
  useEffect(() => {
    if (!participant) void actions.attempt(() => actions.loadParticipantDefinitions());
  }, [participantId]);
  if (!participant?.definition)
    return html`<div class="ss-settings__inner"><p role="status">${t('正在读取…')}</p></div>`;
  const definition = participant.definition;
  const builtIn = BUILT_IN[participantId];
  const onPanel = Boolean(definition.panel);
  const name = definition.name || t(builtIn?.name ?? '未命名专家');
  const back = builtIn?.back ?? ['experts', '专家'];
  /** @param {Record<string, any>} changes */
  const save = async (changes) => {
    const result = await actions.attempt(() => actions.updateParticipant(participantId, changes));
    if (result !== undefined) setSavedAt(Date.now());
  };
  const model = definition.model;
  const modelKey = model?.model
    ? JSON.stringify({ provider: model.provider, model: model.model })
    : '';
  const known = choices.find((choice) => choice.key === modelKey);
  const efforts = known?.efforts ?? [];
  const groups = [...new Set(choices.map((choice) => choice.provider))];
  const modelOptions = [
    { value: '', text: t('跟随对话') },
    ...groups.flatMap((group) => [
      { group },
      ...choices
        .filter((choice) => choice.provider === group)
        .map((choice) => ({ value: choice.key, text: choice.text })),
    ]),
    ...(modelKey && !known
      ? [{ value: modelKey, text: t('{model}（服务商里已经没有）', { model: model.model }) }]
      : []),
  ];

  return html`<div
    class="ss-settings__inner"
    data-settings="expert"
    data-participant=${participantId}
  >
    <${Head}
      back=${{ id: back[0], label: t(back[1]) }}
      title=${html`<span class="ss-settings__role">
        <span class="ss-avatar ss-avatar--lg">${builtIn?.avatar ?? avatarOf(name)}</span>${name}
      </span>`}
      end=${html`<${Saved} at=${savedAt} text=${t('已保存 · 下一轮发言生效')} />`}
    />
    <${Section} title=${t('基本')}>
      ${
        onPanel &&
        html`<${Row} label=${t('名称')}>
            <${AutoText}
              label=${t('名称')}
              width=${240}
              value=${definition.name}
              onSave=${(next) => next.trim() && save({ name: next.trim() })}
            />
          <//>
          <${Row} label=${t('职责标签')} desc=${t('显示在名字旁边')}>
            <${AutoText}
              label=${t('职责标签')}
              width=${240}
              value=${definition.role ?? ''}
              onSave=${(role) => save({ role: role.trim() })}
            />
          <//>`
      }
      <${Row} label=${t('模型')} desc=${t('「跟随对话」就用输入框里选的模型')}>
        <${Select}
          label=${t('模型')}
          width=${240}
          value=${modelKey}
          options=${modelOptions}
          onChange=${(key) => save({ model: key ? JSON.parse(key) : null })}
        />
      <//>
      <${Row}
        label=${t('默认思考强度')}
        desc=${model?.model ? t('只列这个模型支持的档位') : t('先选一个模型')}
      >
        ${
          efforts.length > 0 &&
          html`<${Seg}
            label=${t('默认思考强度')}
            value=${model?.effort ?? ''}
            options=${[['', t('模型默认')], ...efforts.map((effort) => [effort, effortName(effort)])]}
            onChange=${(effort) => save({ model: { ...model, effort: effort || undefined } })}
          />`
        }
      <//>
    <//>
    <${Section} title=${t('提示词')} tip=${t('停止输入一秒后自动保存，每次保存都能在下面撤销。')}>
      <${AutoText}
        multiline
        label=${t('提示词')}
        value=${definition.prompt}
        attrs=${{ style: 'min-height:180px' }}
        onSave=${(prompt) => prompt.trim() && save({ prompt })}
      />
      <p class="ss-field__hint">
        ${t('写清职责、关注点和检查清单。提示词不改变工具权限，那由对话的执行方式决定。')}
      </p>
    <//>
    <section class="ss-setting-section">
      <${SkillBinding} value=${definition.skills ?? []} onChange=${(skills) => save({ skills })} />
    </section>
    <${DefinitionHistory} participantId=${participantId} />
  </div>`;
}
