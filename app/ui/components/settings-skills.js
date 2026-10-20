// Settings → 技能 (design system PageSettingsSkills): the skills from
// `GET /api/skills`, imported ones first. Each can be switched off
// (`settings.skills.disabled`) and read; a built-in one is changed by copying
// it, and the copy replaces it until deleted. SkillBinding is the 绑定的技能
// field on the role and expert pages (the participant's `skills`).
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';
import { Dialog } from './dialog.js';
import { usePopover } from './popover.js';
import { Info } from './settings-models.js';

/** The native file dialog, when running inside the desktop shell. */
const picker = () => globalThis.__TAURI__?.dialog?.open ?? null;

/** The display name: `metadata.title` in SKILL.md, else the name. @param {any} skill */
export const skillTitle = (skill) => skill.title ?? skill.name;

/** The description without a leading "标题：" that repeats the title. @param {any} skill */
const summary = (skill) =>
  skill.title && skill.description.startsWith(`${skill.title}：`)
    ? skill.description.slice(skill.title.length + 1)
    : skill.description;

/** @param {File} file */
async function base64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** @param {{ skill: any, onClose: () => void, onCopy: () => void }} props */
function SkillDialog({ skill, onClose, onCopy }) {
  const builtin = skill.source === 'builtin';
  return html`<${Dialog}
    title=${skillTitle(skill)}
    size="lg"
    onClose=${onClose}
    foot=${html`${
        builtin &&
        html`<span class="ss-muted ss-dialog__note"
            >${t('内置技能不能直接改，复制一份后改副本')}</span
          >
          <button type="button" class="ss-btn" onClick=${onCopy}>
            <${Lucide} name="copy" />${t('复制一份来修改')}
          </button>`
      }
      <button type="button" class="ss-btn ss-btn--primary" onClick=${onClose}>
        ${t('关闭')}
      </button>`}
  >
    <div class="ss-stack">
      <dl class="ss-props">
        <dt>${t('名称')}</dt>
        <dd class="ss-mono">${skill.name}</dd>
        <dt>${t('一句话说明')}</dt>
        <dd>${skill.description}</dd>
        <dt>${t('位置')}</dt>
        <dd class="ss-mono ss-truncate" title=${skill.directory}>${skill.directory}</dd>
      </dl>
      <div
        class="ss-prose ss-skill__body"
        dangerouslySetInnerHTML=${{ __html: renderMarkdown(skill.body ?? '') }}
      ></div>
    </div>
  </${Dialog}>`;
}

/** @param {{ onClose: () => void, onImport: (path: string) => Promise<any> }} props */
function PathDialog({ onClose, onImport }) {
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  async function submit() {
    if (!path.trim()) return setError(t('请填写文件夹路径。'));
    try {
      await onImport(path.trim());
      onClose();
    } catch (failure) {
      setError(failure.message);
    }
  }
  return html`<${Dialog}
    title=${t('从文件夹导入技能')}
    size="sm"
    onClose=${onClose}
    onSubmit=${submit}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary">${t('导入')}</button>`}
  >
    <label class="ss-field">
      <span class="ss-field__label">${t('技能文件夹')}</span>
      <span class="ss-input" data-invalid=${error ? '' : undefined}>
        <input
          class="ss-mono"
          placeholder="D:\\skills\\stats-review"
          value=${path}
          onInput=${(event) => setPath(event.currentTarget.value)}
        />
      </span>
      ${
        error
          ? html`<span class="ss-field__error" role="alert"
              ><${Lucide} name="circle-alert" small />${error}</span
            >`
          : html`<span class="ss-field__hint">${t('文件夹里要有 SKILL.md。')}</span>`
      }
    </label>
  </${Dialog}>`;
}

/** @param {{ skill: any, onClose: () => void, onDelete: () => void }} props */
function DeleteDialog({ skill, onClose, onDelete }) {
  return html`<${Dialog}
    title=${skill.overrides ? t('删除副本，恢复内置？') : t('删除技能「{name}」？', { name: skillTitle(skill) })}
    size="sm"
    onClose=${onClose}
    onSubmit=${onDelete}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--danger">${t('删除')}</button>`}
  >
    <p>
      ${skill.overrides ? t('你对这份副本的修改会丢失，之后用回内置的版本。') : t('技能文件夹会从 ScienceScope 里删除，不能撤销。')}
    </p>
  </${Dialog}>`;
}

export function SkillsPage() {
  const actions = useActions();
  const disabled = useAppState((state) => state.settings?.skills?.disabled ?? []);
  const [skills, setSkills] = useState(/** @type {any[] | null} */ (null));
  const [dialog, setDialog] = useState(/** @type {any} */ (null));
  const load = async () => setSkills(await actions.listSkills());
  useEffect(() => {
    void actions.attempt(load);
  }, []);
  if (!skills) return html`<p role="status">${t('正在读取…')}</p>`;

  const run = (work) =>
    actions.attempt(async () => {
      await work();
      await load();
    });
  const view = (skill) =>
    actions.attempt(async () =>
      setDialog({ kind: 'view', skill: await actions.readSkill(skill.name) }),
    );
  const copy = (skill) =>
    run(async () => {
      await actions.copySkill(skill.name);
      setDialog(null);
      actions.toast(t('已复制。改副本里的 SKILL.md，下一轮生效。'));
    });
  const toggle = (skill, on) =>
    actions.attempt(() =>
      actions.updateSettings({
        skills: {
          disabled: on ? disabled.filter((name) => name !== skill.name) : [...disabled, skill.name],
        },
      }),
    );
  const importFrom = (input) => run(() => actions.importSkill(input));
  async function importFolder() {
    const pick = picker();
    if (!pick) return setDialog({ kind: 'path' });
    const chosen = await pick({ directory: true });
    if (chosen) await importFrom({ path: String(chosen) });
  }
  async function importZip(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) await importFrom({ dataBase64: await base64(file) });
  }
  const openImport = (event) =>
    actions.openMenu(event, [
      { text: t('从文件夹导入…'), icon: 'folder', run: importFolder },
      {
        text: t('从 ZIP 导入…'),
        icon: 'archive',
        run: () => /** @type {HTMLInputElement} */ (document.getElementById('skill-zip'))?.click(),
      },
    ]);
  const openMenu = (event, skill) => {
    const open = {
      text: t('打开文件夹'),
      icon: 'folder-open',
      run: () => actions.attempt(() => actions.openSkillFolder(skill.name)),
    };
    const remove = (text, icon) => ({
      text,
      icon,
      danger: true,
      run: () => setDialog({ kind: 'delete', skill }),
    });
    actions.openMenu(event, [
      { text: t('查看正文'), icon: 'eye', run: () => view(skill) },
      ...(skill.source === 'builtin'
        ? [{ text: t('复制一份来修改'), icon: 'copy', run: () => copy(skill) }]
        : skill.overrides
          ? [
              { ...open, text: t('打开我的副本') },
              { sep: true },
              remove(t('删除副本，恢复内置'), 'undo-2'),
            ]
          : [open, { sep: true }, remove(t('删除'), 'trash-2')]),
    ]);
  };

  // The switch follows the setting at once; the list reloads only on file changes.
  const enabled = (skill) => !skill.error && !disabled.includes(skill.name);
  const imported = skills.filter((skill) => skill.source === 'user' && !skill.overrides);
  const builtin = skills.filter((skill) => skill.source === 'builtin' || skill.overrides);
  const row = (skill) =>
    skill.error
      ? html`<div class="ss-list-row ss-list-row--2" key=${skill.name} data-skill=${skill.name}>
          <span class="ss-dot ss-dot--danger ss-list-row__icon"></span>
          <span class="ss-list-row__main">
            <span class="ss-list-row__title ss-mono">${skill.name}</span>
            <span class="ss-list-row__sub ss-list-row__sub--danger">
              ${t('{error}修好后自动出现。', { error: t(skill.error) })}
            </span>
          </span>
          <button
            type="button"
            class="ss-btn ss-btn--ghost ss-btn--sm"
            onClick=${() => actions.attempt(() => actions.openSkillFolder(skill.name))}
          >
            <${Lucide} name="folder-open" />${t('打开文件夹')}
          </button>
        </div>`
      : html`<div
          class=${`ss-list-row ss-list-row--2 ${enabled(skill) ? '' : 'ss-list-row--done'}`}
          key=${skill.name}
          data-skill=${skill.name}
        >
          <${Lucide} name="graduation-cap" class="ss-list-row__icon" />
          <button
            type="button"
            class="ss-list-row__main ss-list-row__open"
            onClick=${() => view(skill)}
          >
            <span class="ss-list-row__title">${skillTitle(skill)}</span>
            <span class="ss-list-row__sub"
              ><span class="ss-mono">${skill.name}</span> · ${summary(skill)}</span
            >
          </button>
          ${
            skill.boundRoles.length > 0 &&
            html`<span class="ss-tag" data-tip=${t('绑定了这个技能的角色')}
              ><${Lucide}
                name="users"
              />${skill.boundRoles.map((role) => role.name).join('、')}</span
            >`
          }
          ${skill.overrides && html`<span class="ss-tag ss-tag--ok">${t('用的是你的副本')}</span>`}
          <input
            type="checkbox"
            role="switch"
            class="ss-switch"
            aria-label=${t('启用 {name}', { name: skillTitle(skill) })}
            checked=${enabled(skill)}
            onChange=${(event) => toggle(skill, event.currentTarget.checked)}
          />
          <span class="ss-list-row__actions">
            <button
              type="button"
              class="ss-icon-btn ss-icon-btn--sm"
              aria-label=${t('更多')}
              data-tip=${t('更多')}
              onClick=${(event) => openMenu(event, skill)}
            >
              <${Lucide} name="ellipsis" />
            </button>
          </span>
        </div>`;

  return html`<div class="ss-settings__inner" data-settings="skills">
    <h2 class="ss-settings__title">
      ${t('技能')}<${Info}
        text=${t('技能是一份写给 AI 的做事说明（SKILL.md 文件夹，可以带参考文件和脚本），格式和 Claude、Codex 通用。所有角色都能用：AI 平时只看到名称和一句说明，用到时才读正文。也可以在专家设置里给某位专家绑定，它每次开口前就读好。')}
      />
    </h2>
    <p class="ss-settings__desc">
      ${t('{builtin} 个内置、{user} 个你导入的。停用的技能不会出现在 AI 的技能目录里。', {
        builtin: builtin.length,
        user: imported.length,
      })}
    </p>
    <section class="ss-setting-section">
      <div class="ss-setting-section__head">
        <h3 class="ss-setting-section__title">
          ${t('你导入的')}<span class="ss-count">${imported.length}</span>
        </h3>
        <button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          onClick=${() => actions.attempt(() => actions.openFolder('skills'))}
        >
          <${Lucide} name="folder-open" />${t('打开技能文件夹')}
        </button>
        <button type="button" class="ss-btn ss-btn--sm" aria-haspopup="menu" onClick=${openImport}>
          <${Lucide} name="import" />${t('导入技能')}<${Lucide} name="chevron-down" />
        </button>
        <input id="skill-zip" type="file" accept=".zip" hidden onChange=${importZip} />
      </div>
      ${
        imported.length
          ? html`<div class="ss-list">${imported.map(row)}</div>`
          : html`<p class="ss-muted">
              ${t('还没有。导入别人写好的 SKILL.md 文件夹或 ZIP，或者复制一个内置技能来改。')}
            </p>`
      }
    </section>
    <section class="ss-setting-section">
      <div class="ss-setting-section__head">
        <h3 class="ss-setting-section__title">
          ${t('内置')}<span class="ss-count">${builtin.length}</span>
        </h3>
      </div>
      <div class="ss-list">${builtin.map(row)}</div>
    </section>
    ${
      dialog?.kind === 'view' &&
      html`<${SkillDialog}
        skill=${dialog.skill}
        onClose=${() => setDialog(null)}
        onCopy=${() => copy(dialog.skill)}
      />`
    }
    ${
      dialog?.kind === 'path' &&
      html`<${PathDialog}
        onClose=${() => setDialog(null)}
        onImport=${async (path) => {
          await actions.importSkill({ path });
          await load();
        }}
      />`
    }
    ${
      dialog?.kind === 'delete' &&
      html`<${DeleteDialog}
        skill=${dialog.skill}
        onClose=${() => setDialog(null)}
        onDelete=${() =>
          run(async () => {
            await actions.deleteSkill(dialog.skill.name);
            setDialog(null);
          })}
      />`
    }
  </div>`;
}

/**
 * 绑定的技能: chips for the bound skills and a checklist to change them. A
 * bound skill is read before every turn of that role.
 * @param {{ value: string[], onChange: (skills: string[]) => void }} props
 */
export function SkillBinding({ value, onChange }) {
  const actions = useActions();
  const [skills, setSkills] = useState(/** @type {any[]} */ ([]));
  const [query, setQuery] = useState('');
  const pop = usePopover({ placement: 'bottom-start' });
  useEffect(() => {
    void actions.attempt(async () => setSkills(await actions.listSkills()));
  }, []);
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const set = (name, on) => onChange(on ? [...value, name] : value.filter((item) => item !== name));
  const words = query.trim().toLowerCase();
  const choices = skills.filter(
    (skill) =>
      !skill.error &&
      (!words || `${skill.name} ${skillTitle(skill)}`.toLowerCase().includes(words)),
  );
  return html`<div class="ss-field" data-skill-binding>
    <span class="ss-field__label"
      >${t('绑定的技能')}<${Info}
        text=${t('绑定的技能在这位角色每次发言前就读进来，不用它自己去找。没绑定的技能它也能按需使用。')}
    /></span>
    <div class="ss-chips ss-chips--inline">
      ${value.map((name) => {
        const skill = byName.get(name);
        return html`<span
          class="ss-chip"
          key=${name}
          title=${skill ? summary(skill) : t('找不到这个技能')}
        >
          <${Lucide} name="graduation-cap" small /><b>${skill ? skillTitle(skill) : name}</b>
          <button
            type="button"
            aria-label=${t('取消绑定 {name}', { name: skill ? skillTitle(skill) : name })}
            onClick=${() => set(name, false)}
          >
            <${Lucide} name="x" />
          </button>
        </span>`;
      })}
      <button
        type="button"
        ref=${pop.trigger}
        class="ss-btn ss-btn--ghost ss-btn--sm"
        aria-haspopup="dialog"
        aria-expanded=${pop.open}
        onClick=${pop.toggle}
      >
        <${Lucide} name="plus" />${t('添加')}
      </button>
    </div>
    ${
      pop.open &&
      html`<div
        ref=${pop.layer}
        class="ss-pop ss-pop--list"
        role="dialog"
        aria-label=${t('绑定的技能')}
      >
        <div class="ss-pop__body">
          <label class="ss-input ss-input--sm">
            <${Lucide} name="search" small />
            <input
              placeholder=${t('搜索技能')}
              aria-label=${t('搜索技能')}
              value=${query}
              onInput=${(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div class="ss-pop__section">
            ${choices.map(
              (skill) =>
                html`<label class="ss-check" key=${skill.name}>
                  <input
                    type="checkbox"
                    checked=${value.includes(skill.name)}
                    disabled=${!skill.enabled && !value.includes(skill.name)}
                    onChange=${(event) => set(skill.name, event.currentTarget.checked)}
                  /><span>${skillTitle(skill)}${!skill.enabled && t('（已停用）')}</span>
                </label>`,
            )}
          </div>
        </div>
        <div class="ss-pop__foot">
          <span class="ss-muted">${t('保存后从下一轮发言生效')}</span>
          <button
            type="button"
            class="ss-btn ss-btn--ghost ss-btn--sm"
            onClick=${() => navigate({ view: 'settings', id: 'skills' })}
          >
            ${t('管理技能')}
          </button>
        </div>
      </div>`
    }
  </div>`;
}
