// 创建研究项目 in the old interface's markup: name, research goal and the
// working folder (an existing folder is only used, never filled with
// ScienceScope's own files).
import { useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { navigate } from '../route.js';
import { InfoTip } from './info-tip.js';
import { MainHead } from './mainhead.js';

/** The native folder picker, when running inside the desktop shell. */
const folderPicker = () => globalThis.__TAURI__?.dialog?.open ?? null;

export function ProjectNew() {
  const actions = useActions();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [folder, setFolder] = useState('');
  const pick = folderPicker();

  async function create() {
    const project = await actions.attempt(() =>
      actions.createProject(name.trim(), {
        description: goal.trim(),
        folder: folder.trim() || null,
      }),
    );
    if (project) navigate({ view: 'workbench', id: project.id });
  }

  return html`<main class="main">
    <${MainHead} crumb="ScienceScope" section=${t('窗口与导航')} title=${t('创建项目 · 文件夹')} />
    <div class="mainbody">
      <div class="content" style="max-width:880px">
        <div class="pageintro between">
          <h1 style="margin:0">${t('创建研究项目')}</h1>
          <div class="row"></div>
        </div>
        <div class="card">
          <div class="field">
            <label class="label" for="new-project-name">${t('项目名称')}</label>
            <input
              id="new-project-name"
              autofocus
              value=${name}
              onInput=${(event) => setName(event.currentTarget.value)}
            />
          </div>
          <div class="field">
            <label class="label" for="new-project-goal">${t('研究目标（可选）')}</label>
            <textarea
              id="new-project-goal"
              placeholder=${t('简单说说你想研究什么…')}
              value=${goal}
              onInput=${(event) => setGoal(event.currentTarget.value)}
            ></textarea>
          </div>
          <div class="field">
            <label class="label" for="new-project-path">
              ${t('工作目录')}<${InfoTip}
                text=${t('留空则在 ScienceScope 数据目录下自动新建。\n选择已有文件夹时，其中的文件不会被移动或覆盖。')}
              />
            </label>
            <input
              id="new-project-path"
              placeholder=${t('默认：在 ScienceScope 数据目录下新建')}
              value=${folder}
              onInput=${(event) => setFolder(event.currentTarget.value)}
            />
          </div>
          <div class="row">
            ${
              pick &&
              html`<button
                class="btn tiny"
                onClick=${async () => {
                  const chosen = await pick({ directory: true });
                  if (typeof chosen === 'string') setFolder(chosen);
                }}
              >
                ${t('选择已有文件夹')}
              </button>`
            }
            <button class="btn tiny" onClick=${() => setFolder('')}>${t('使用默认目录')}</button>
          </div>
          <div class="saverow">
            <button class="btn" onClick=${() => history.back()}>${t('取消')}</button>
            <button class="btn primary" disabled=${!name.trim()} onClick=${create}>
              ${t('创建项目')}
            </button>
          </div>
        </div>
      </div>
    </div>
  </main>`;
}
