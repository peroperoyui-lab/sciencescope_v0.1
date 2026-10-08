import { useEffect, useState, useRef } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { InfoTip } from './info-tip.js';

/**
 * @param {{value:string,onChange:(value:string)=>void,inherit?:boolean,id?:string,initialize?:boolean}} props
 */
export function PythonChoice({
  value,
  onChange,
  inherit = false,
  id = 'python-choice',
  initialize = false,
}) {
  const actions = useActions();
  const version = useAppState((state) => state.pythonVersion);
  const initialized = useRef(false);
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    let active = true;
    actions
      .pythonList()
      .then((result) => {
        if (active) {
          setSnapshot(result);
          if (initialize && !initialized.current) {
            initialized.current = true;
            onChange(result.settings.defaultEnvironment ?? 'builtin-science');
          }
        }
      })
      .catch((error) => actions.toast(error.message));
    return () => {
      active = false;
    };
  }, [version]);
  return html`<div class="field creation-python">
    <label class="label" for=${id}
      >${t('Python 环境')}<${InfoTip}
        text=${t('模型运行 Python 时使用这个环境。更换在下一轮生效，保留会话历史。')}
    /></label>
    <select
      id=${id}
      value=${value}
      onChange=${(event) => {
        initialized.current = true;
        onChange(event.currentTarget.value);
      }}
    >
      ${inherit && html`<option value="">${t('跟随项目与默认设置')}</option>`}
      <option value="builtin-science">${t('内置 · 科学分析')}</option>
      <option value="system">${t('系统 Python')}</option>
      ${(snapshot?.environments ?? []).filter((entry) => entry.id !== 'builtin-science').map((entry) => html`<option value=${entry.id}>${entry.name} · ${entry.version}</option>`)}
    </select>
  </div>`;
}

export function ChatDetails() {
  const actions = useActions();
  const [mode, setMode] = useState('new');
  const [folder, setFolder] = useState('');
  const [environment, setEnvironment] = useState('builtin-science');
  return html`<form
    class="creation-dialog-body"
    onSubmit=${(event) => {
      event.preventDefault();
      actions.confirmIndependent({ folderMode: mode, workFolder: folder, environment });
    }}
  >
    <div class="field">
      <label class="label" for="chat-folder-mode">${t('工作文件夹')}</label>
      <select
        id="chat-folder-mode"
        value=${mode}
        onChange=${(event) => setMode(event.currentTarget.value)}
      >
        <option value="new">${t('为这个对话新建文件夹')}</option>
        <option value="shared">${t('独立对话公共文件夹')}</option>
        <option value="existing">${t('选择已有文件夹')}</option>
      </select>
    </div>
    ${
      mode === 'existing' &&
      html`<div class="field">
        <input
          aria-label=${t('工作目录')}
          value=${folder}
          onInput=${(event) => setFolder(event.currentTarget.value)}
        />
        ${
          globalThis.__TAURI__?.dialog?.open &&
          html`<button
            type="button"
            class="btn tiny"
            onClick=${async () => {
              const chosen = await globalThis.__TAURI__.dialog.open({ directory: true });
              if (typeof chosen === 'string') setFolder(chosen);
            }}
          >
            ${t('选择已有文件夹')}
          </button>`
        }
      </div>`
    }
    <${PythonChoice} value=${environment} onChange=${setEnvironment} initialize />
    <div class="saverow">
      <button type="button" class="btn" onClick=${actions.closeModal}>${t('取消')}</button
      ><button class="btn primary" disabled=${mode === 'existing' && !folder.trim()}>
        ${t('确定')}
      </button>
    </div>
  </form>`;
}
