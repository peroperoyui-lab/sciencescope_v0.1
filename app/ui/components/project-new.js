// 新建项目: name, research goal, the project folder (an existing folder is
// only used, never filled with ScienceScope's own files) and its Python.
import { useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { InfoTip } from './info-tip.js';
import { folderPicker, PythonChoice } from './python-choice.js';

export function ProjectNew() {
  const actions = useActions();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [folder, setFolder] = useState('');
  const [environment, setEnvironment] = useState('builtin-science');
  const pick = folderPicker();

  async function create() {
    if (!name.trim()) return;
    const project = await actions.attempt(() =>
      actions.createProject(name.trim(), {
        description: goal.trim(),
        folder: folder.trim() || null,
        environment,
      }),
    );
    if (project) navigate({ view: 'workbench', id: project.id });
  }

  return html`<main class="main ss-main">
    <div class="ss-header">
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('返回')}
        data-tip=${t('返回')}
        onClick=${() => history.back()}
      >
        <${Lucide} name="arrow-left" />
      </button>
      <div class="ss-header__title"><span>${t('新建项目')}</span></div>
    </div>
    <div class="ss-content">
      <form
        class="ss-form-page"
        novalidate
        onSubmit=${(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label class="ss-field">
          <span class="ss-field__label">${t('项目名称')}</span>
          <span class="ss-input">
            <input
              id="new-project-name"
              autofocus
              value=${name}
              onInput=${(event) => setName(event.currentTarget.value)}
            />
          </span>
        </label>
        <label class="ss-field">
          <span class="ss-field__label">${t('研究目标（可选）')}</span>
          <textarea
            id="new-project-goal"
            class="ss-textarea"
            rows="3"
            placeholder=${t('简单说说你想研究什么…')}
            value=${goal}
            onInput=${(event) => setGoal(event.currentTarget.value)}
          ></textarea>
        </label>
        <div class="ss-field">
          <span class="ss-field__label"
            >${t('项目文件夹')}<${InfoTip}
              text=${t('留空则在 ScienceScope 数据目录下自动新建。\n选择已有文件夹时，其中的文件不会被移动或覆盖。')}
          /></span>
          <div class="ss-field-row">
            <span class="ss-input">
              <input
                id="new-project-path"
                aria-label=${t('项目文件夹')}
                placeholder=${t('默认：在 ScienceScope 数据目录下新建')}
                value=${folder}
                onInput=${(event) => setFolder(event.currentTarget.value)}
              />
            </span>
            ${
              pick &&
              html`<button
                type="button"
                class="ss-btn"
                onClick=${async () => {
                  const chosen = await pick({ directory: true });
                  if (typeof chosen === 'string') setFolder(chosen);
                }}
              >
                <${Lucide} name="folder-open" />${t('选择已有文件夹')}
              </button>`
            }
            ${
              folder &&
              html`<button
                type="button"
                class="ss-btn ss-btn--ghost"
                onClick=${() => setFolder('')}
              >
                ${t('使用默认目录')}
              </button>`
            }
          </div>
        </div>
        <${PythonChoice}
          id="new-project-python"
          value=${environment}
          onChange=${setEnvironment}
          initialize
        />
        <div class="ss-form-page__foot">
          <button type="button" class="ss-btn" onClick=${() => history.back()}>${t('取消')}</button>
          <button type="submit" class="ss-btn ss-btn--primary" disabled=${!name.trim()}>
            ${t('创建项目')}
          </button>
        </div>
      </form>
    </div>
  </main>`;
}
