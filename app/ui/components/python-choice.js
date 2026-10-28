// The Python environment for a new project or chat, and 新建独立对话's details
// (where its working folder is, and which Python it uses).
import { useEffect, useState, useRef } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { InfoTip } from './info-tip.js';
import { ModalForm } from './overlays.js';
import { Select } from './settings-kit.js';

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
  const options = [
    ...(inherit ? [{ value: '', text: t('跟随项目与默认设置') }] : []),
    { value: 'builtin-science', text: t('内置 · 科学分析') },
    { value: 'system', text: t('系统 Python') },
    ...(snapshot?.environments ?? [])
      .filter((entry) => entry.id !== 'builtin-science')
      .map((entry) => ({ value: entry.id, text: `${entry.name} · ${entry.version}` })),
  ];
  return html`<div class="ss-field" id=${id} data-value=${value}>
    <span class="ss-field__label"
      >${t('Python 环境')}<${InfoTip}
        text=${t('模型运行 Python 时使用这个环境。更换在下一轮生效，保留会话历史。')}
    /></span>
    <${Select}
      label=${t('Python 环境')}
      value=${value}
      options=${options}
      width="100%"
      onChange=${(next) => {
        initialized.current = true;
        onChange(next);
      }}
    />
  </div>`;
}

/** The native folder picker, when running inside the desktop shell. */
export const folderPicker = () => globalThis.__TAURI__?.dialog?.open ?? null;

export function ChatDetails() {
  const actions = useActions();
  const [mode, setMode] = useState('new');
  const [folder, setFolder] = useState('');
  const [environment, setEnvironment] = useState('builtin-science');
  const pick = folderPicker();
  return html`<${ModalForm}
    disabled=${mode === 'existing' && !folder.trim()}
    onSubmit=${() =>
      actions.confirmIndependent({ folderMode: mode, workFolder: folder, environment })}
  >
    <div class="ss-field">
      <span class="ss-field__label">${t('工作文件夹')}</span>
      <${Select}
        label=${t('工作文件夹')}
        value=${mode}
        width="100%"
        options=${[
          { value: 'new', text: t('为这个对话新建文件夹') },
          { value: 'shared', text: t('独立对话公共文件夹') },
          { value: 'existing', text: t('选择已有文件夹') },
        ]}
        onChange=${setMode}
      />
    </div>
    ${
      mode === 'existing' &&
      html`<div class="ss-field-row">
        <span class="ss-input">
          <input
            aria-label=${t('工作目录')}
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
      </div>`
    }
    <${PythonChoice} value=${environment} onChange=${setEnvironment} initialize />
  <//>`;
}
