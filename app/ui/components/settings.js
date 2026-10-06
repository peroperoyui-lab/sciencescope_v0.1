// Settings in the old interface's markup (`.settings` with `.settingsnav`):
// the shell, 个人资料与常规, 快捷键 and the folder pages. Model, role and
// expert pages live in settings-models.js and settings-roles.js.
import { useEffect, useState } from 'preact/hooks';
import { comboOf } from '../appearance.js';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { navigate } from '../route.js';
import { InfoTip } from './info-tip.js';
import { MainHead } from './mainhead.js';
import { SemanticSettings } from './settings-semantic.js';
import { ModelsPage, ProviderPage } from './settings-models.js';
import { ExpertsPage, RolePage } from './settings-roles.js';

/**
 * Settings pages, grouped as in the old navigation: [group, [[id, nav label, page title]]].
 * @type {Array<[string, string[][]]>}
 */
const GROUPS = [
  [
    '个人偏好',
    [
      ['general', '个人资料与常规', '常规设置'],
      ['shortcuts', '快捷键', '快捷键设置'],
    ],
  ],
  [
    '科研协作',
    [
      ['models', '模型与 API', '模型与 API · 服务列表'],
      ['persona', '人格与记忆', '人格与记忆'],
      ['experts', '专家角色', '专家角色分配'],
      ['secretary-settings', '任务秘书', '会议秘书设置'],
      ['assistant-settings', '全局助手', '全局助手设置'],
    ],
  ],
  [
    '工具与环境',
    [
      ['library-settings', '数据库与文件', '数据库设置'],
      ['environment', '运行环境', '环境配置 · 便携目录'],
    ],
  ],
];

/** @param {string} page */
function titleOf(page) {
  if (page.startsWith('provider')) return t('添加服务 · API 表单');
  for (const [, items] of GROUPS) {
    const found = items.find(([id]) => id === page);
    if (found) return t(found[2]);
  }
  return t('设置');
}

/** One row of a settings form: heading with its tip on the left, control on the right. */
function SettingRow({ title, tip, children }) {
  return html`<div class="settingrow">
    <div class="description">
      <h3>
        ${title}${tip && html`<${InfoTip} text=${tip} label=${t('{name}说明', { name: title })} />`}
      </h3>
    </div>
    <div class="control">${children}</div>
  </div>`;
}

function ProfileCard() {
  const actions = useActions();
  const profile = useAppState((state) => state.settings?.profile);
  const [name, setName] = useState(profile?.name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [feedback, setFeedback] = useState('');
  async function submit(event) {
    event.preventDefault();
    const saved = await actions.attempt(() =>
      actions.updateSettings({ profile: { name: name.trim(), bio } }),
    );
    if (saved !== undefined) setFeedback(t('已保存。'));
  }
  return html`<section class="card profile-settings">
    <h2>
      ${t('个人资料')}<${InfoTip}
        text=${t('仅用于本机界面显示，不会自动发送给专家或写入研究上下文。')}
        label=${t('个人资料说明')}
      />
    </h2>
    <form onSubmit=${submit}>
      <div class="field">
        <label for="profile-name">${t('显示名称')}</label>
        <input
          id="profile-name"
          required
          placeholder=${t('用户')}
          value=${name}
          onInput=${(event) => setName(event.currentTarget.value)}
        />
      </div>
      <div class="field">
        <label for="profile-bio">${t('个人简介')}</label>
        <textarea
          id="profile-bio"
          value=${bio}
          onInput=${(event) => setBio(event.currentTarget.value)}
        ></textarea>
      </div>
      <p role="status">${feedback}</p>
      <button class="btn primary" type="submit">${t('保存个人资料')}</button>
    </form>
  </section>`;
}

const LOOK_DEFAULTS = {
  language: 'zh',
  font: '',
  theme: 'light',
  density: 'standard',
  codeFontSize: 14,
  chatFontSize: 16,
  reduceMotion: false,
  scrollbars: false,
};

/** Fonts installed on this computer (Local Font Access), names only. */
async function installedFonts() {
  const query = /** @type {any} */ (globalThis).queryLocalFonts;
  if (typeof query !== 'function') return [];
  const fonts = await query();
  return [...new Set(fonts.map((font) => font.family))].sort((a, b) => a.localeCompare(b));
}

function PreferencesForm() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const [look, setLook] = useState({ ...LOOK_DEFAULTS, ...settings?.appearance });
  const [sendKey, setSendKey] = useState(settings?.composer?.sendKey ?? 'enter');
  const [fonts, setFonts] = useState(/** @type {string[]} */ ([]));
  const [fontStatus, setFontStatus] = useState('');
  const [feedback, setFeedback] = useState('');
  const set = (key) => (event) => setLook({ ...look, [key]: event.currentTarget.value });
  const setFlag = (key) => (event) =>
    setLook({ ...look, [key]: event.currentTarget.value === 'true' });
  const setNumber = (key) => (event) =>
    setLook({ ...look, [key]: Number(event.currentTarget.value) });

  async function readFonts() {
    try {
      const found = await installedFonts();
      setFonts(found);
      setFontStatus(found.length ? '' : t('无法读取本机字体，只能使用内置字体。'));
    } catch (error) {
      setFontStatus(error.message);
    }
  }
  useEffect(() => {
    readFonts();
  }, []);

  async function submit(event) {
    event.preventDefault();
    const saved = await actions.attempt(() =>
      actions.updateSettings({ appearance: look, composer: { sendKey } }),
    );
    if (saved !== undefined) setFeedback(t('已保存并应用。'));
  }

  return html`<form onSubmit=${submit}>
    <h2>${t('阅读与操作')}</h2>
    <${SettingRow}
      title=${t('界面语言')}
      tip=${t('界面文字、菜单和提示的语言。对话内容、资料和你输入的名称保持原样。')}
    >
      <select value=${look.language} onChange=${set('language')}>
        <option value="zh">中文</option>
        <option value="en">English</option>
      </select>
    <//>
    <${SettingRow}
      title=${t('界面字体')}
      tip=${t('全局界面字体。默认使用随客户端安装的思源黑体；也可以选择这台电脑已安装的任何字体。字体不含中文时，中文会显示为替代字形。')}
    >
      <div class="font-choice">
        <div class="font-choice-row">
          <select aria-label=${t('界面字体')} value=${look.font} onChange=${set('font')}>
            <option value="">${t('思源黑体（内置）')}</option>
            ${look.font && !fonts.includes(look.font) && html`<option value=${look.font}>${look.font}</option>`}
            ${fonts.map(
              (family) =>
                html`<option key=${family} value=${family} style=${{ fontFamily: `'${family}'` }}>
                  ${family}
                </option>`,
            )}
          </select>
          <button
            type="button"
            class="btn tiny"
            title=${t('重新读取本机字体')}
            onClick=${readFonts}
          >
            ${t('重新读取')}
          </button>
        </div>
        <span
          class="font-preview"
          style=${{ fontFamily: look.font ? `'${look.font}'` : 'var(--ss-font-default)' }}
          >研究 ScienceScope 0123 · ${t('数据与方法')}</span
        >
        <span class="font-status" role="status">${fontStatus}</span>
      </div>
    <//>
    <${SettingRow} title=${t('主题')} tip=${t('浅色保留原设计；跟随系统会响应系统主题变化。')}>
      <select value=${look.theme} onChange=${set('theme')}>
        <option value="light">${t('浅色')}</option>
        <option value="dark">${t('深色')}</option>
        <option value="system">${t('跟随系统')}</option>
      </select>
    <//>
    <${SettingRow} title=${t('界面密度')} tip=${t('调整导航和设置间距，不缩放聊天正文。')}>
      <select value=${look.density} onChange=${set('density')}>
        <option value="standard">${t('标准')}</option>
        <option value="compact">${t('紧凑')}</option>
      </select>
    <//>
    <${SettingRow} title=${t('代码字号')} tip=${t('仅调整消息里的代码块，不改变正文。')}>
      <select value=${String(look.codeFontSize)} onChange=${setNumber('codeFontSize')}>
        ${[12, 13, 14, 15, 16, 18].map((size) => html`<option key=${size} value=${size}>${size}px</option>`)}
      </select>
    <//>
    <button
      class="btn tiny"
      type="button"
      onClick=${() => setLook({ ...LOOK_DEFAULTS, language: look.language })}
    >
      ${t('恢复阅读与操作默认设置')}
    </button>
    <${SettingRow} title=${t('聊天正文字号')} tip=${t('主对话、任务秘书及全局助手统一生效。')}>
      <select value=${String(look.chatFontSize)} onChange=${setNumber('chatFontSize')}>
        ${[14, 15, 16, 18, 20].map((size) => html`<option key=${size} value=${size}>${size}px</option>`)}
      </select>
    <//>
    <${SettingRow}
      title=${t('发送快捷键')}
      tip=${t('Shift + Enter 始终换行；不改变导图编辑键位。')}
    >
      <select value=${sendKey} onChange=${(event) => setSendKey(event.currentTarget.value)}>
        <option value="enter">${t('Enter 发送')}</option>
        <option value="ctrl-enter">${t('Ctrl + Enter 发送')}</option>
      </select>
    <//>
    <${SettingRow} title=${t('减少过渡动画')} tip=${t('即时生效。')}>
      <select value=${String(look.reduceMotion)} onChange=${setFlag('reduceMotion')}>
        <option value="false">${t('关闭')}</option>
        <option value="true">${t('开启')}</option>
      </select>
    <//>
    <${SettingRow} title=${t('显示滚动条')} tip=${t('聊天和设置滚动区域。')}>
      <select value=${String(look.scrollbars)} onChange=${setFlag('scrollbars')}>
        <option value="false">${t('自动隐藏')}</option>
        <option value="true">${t('始终显示')}</option>
      </select>
    <//>
    <p role="status">${feedback}</p>
    <div class="saverow"><button class="btn primary" type="submit">${t('保存并应用')}</button></div>
  </form>`;
}

const SHORTCUT_DEFAULTS = {
  search: 'Ctrl+K',
  browse: 'Ctrl+Shift+K',
  newChat: 'Ctrl+N',
  independentChat: 'Ctrl+Alt+N',
};
const SHORTCUT_LABELS = [
  ['search', '搜索与命令'],
  ['browse', '浏览全部'],
  ['newChat', '新建项目内对话'],
  ['independentChat', '独立新对话'],
];
/** Keys the window keeps for editing and the browser shell. */
const RESERVED = [
  'Ctrl+C',
  'Ctrl+V',
  'Ctrl+X',
  'Ctrl+A',
  'Ctrl+Z',
  'Ctrl+Y',
  'Ctrl+F',
  'Ctrl+R',
  'Ctrl+W',
];

function ShortcutsForm() {
  const actions = useActions();
  const saved = useAppState((state) => state.settings?.shortcuts);
  const [keys, setKeys] = useState({ ...SHORTCUT_DEFAULTS, ...saved });
  const [feedback, setFeedback] = useState('');

  function record(name, event) {
    if (event.key === 'Tab') return;
    event.preventDefault();
    const combo = comboOf(event);
    if (!combo) return;
    if (!/^(Ctrl|Alt)\+/.test(combo)) return setFeedback(t('快捷键需要包含 Ctrl 或 Alt。'));
    if (RESERVED.includes(combo)) return setFeedback(t('{key} 保留给编辑操作。', { key: combo }));
    const taken = Object.entries(keys).find(([other, value]) => other !== name && value === combo);
    if (taken) return setFeedback(t('{key} 已被其他操作使用。', { key: combo }));
    setFeedback('');
    setKeys({ ...keys, [name]: combo });
  }

  async function save(next) {
    const result = await actions.attempt(() => actions.updateSettings({ shortcuts: next }));
    if (result !== undefined) {
      setKeys(next);
      setFeedback(t('已保存并应用。'));
    }
  }

  return html`<form
    data-shortcut-form
    onSubmit=${(event) => {
      event.preventDefault();
      save(keys);
    }}
  >
    <h2>
      ${t('快捷键')}<${InfoTip}
        text=${t('点击输入框后按下组合键。保留复制、粘贴、查找和浏览器保护按键；发送键在常规设置修改。仅在客户端窗口内生效。')}
        label=${t('快捷键说明')}
      />
    </h2>
    ${SHORTCUT_LABELS.map(
      ([name, label]) =>
        html`<div class="settingrow" key=${name}>
          <label for=${`shortcut-${name}`}>${t(label)}</label>
          <input
            id=${`shortcut-${name}`}
            data-shortcut-input
            readonly
            value=${keys[name]}
            aria-label=${t('{name}快捷键', { name: t(label) })}
            onKeyDown=${(event) => record(name, event)}
          />
        </div>`,
    )}
    <p role="status">${feedback}</p>
    <div class="saverow">
      <button class="btn primary" type="submit">${t('保存并应用')}</button>
      <button class="btn" type="button" onClick=${() => save({ ...SHORTCUT_DEFAULTS })}>
        ${t('恢复默认快捷键')}
      </button>
    </div>
  </form>`;
}

const FOLDERS = [
  ['root', '客户端目录'],
  ['database', '应用数据库与设置'],
  ['projects', '默认项目目录'],
  ['library', '资料库原件'],
  ['runtime', 'DSH 运行历史与配置'],
  ['skills', '本地技能目录'],
];

/** Where this installation keeps its data (数据库与文件 / 运行环境). @param {{ title: string }} props */
function FoldersPage({ title }) {
  const actions = useActions();
  const [info, setInfo] = useState(/** @type {any} */ (null));
  useEffect(() => {
    actions.attempt(async () => setInfo(await actions.systemInfo()));
  }, []);
  return html`<div>
    <h2>
      ${title}<${InfoTip}
        text=${t('以下是此客户端实际使用的位置。\nSQLite 保存应用记录，DSH 保存运行历史；原始材料保存在资料库。此处不提供清空历史或索引的一键操作。')}
      />
    </h2>
    ${
      info &&
      FOLDERS.map(
        ([name, label]) =>
          html`<div class="settingrow" key=${name}>
            <div class="description">
              <h3>${t(label)}</h3>
              <p><code class="settings-path">${info.folders[name]}</code></p>
            </div>
            <div class="control">
              <button
                class="btn tiny"
                onClick=${() => actions.attempt(() => actions.openFolder(name))}
              >
                ${t('打开文件夹')}
              </button>
            </div>
          </div>`,
      )
    }
    ${
      info &&
      html`<div class="settingrow">
        <div class="description">
          <h3>${t('运行时')}</h3>
          <p>Node ${info.runtime.node} · ${info.runtime.platform} · ${info.runtime.arch}</p>
        </div>
      </div>`
    }
  </div>`;
}

/** @param {{ page: string, projectName?: string }} props */
export function SettingsView({ page, projectName }) {
  let content;
  if (page === 'general') content = html`<${ProfileCard} /><${PreferencesForm} />`;
  else if (page === 'shortcuts') content = html`<${ShortcutsForm} />`;
  else if (page === 'models') content = html`<${ModelsPage} />`;
  else if (page.startsWith('provider'))
    content = html`<${ProviderPage} index=${page.split('/')[1] ?? 'new'} />`;
  else if (page === 'persona')
    content = html`<${RolePage}
      participantId="agent_main"
      title=${t('主专家设置')}
      tip=${t('它是统筹者，不建议给予主专家特定角色。')}
    />`;
  else if (page === 'secretary-settings')
    content = html`<${RolePage}
      participantId="agent_secretary"
      title=${t('任务秘书设置')}
      tip=${t('提示词描述职责，不代替工具权限设置。')}
    />`;
  else if (page === 'assistant-settings')
    content = html`<${RolePage}
      participantId="agent_assistant"
      title=${t('全局助手设置')}
      tip=${t('提示词描述职责，不代替工具权限设置。')}
    />`;
  else if (page === 'experts') content = html`<${ExpertsPage} />`;
  else if (page === 'library-settings')
    content = html`<${FoldersPage} title=${t('数据库与文件')} />`;
  else if (page === 'environment')
    content = html`<${FoldersPage} title=${t('运行环境')} /><${SemanticSettings} />`;
  else content = html`<div class="empty">${t('没有这个设置页。')}</div>`;
  const active = page.startsWith('provider') ? 'models' : page;

  return html`<main class="main">
    <${MainHead}
      crumb=${projectName ?? 'ScienceScope'}
      section=${t('设置')}
      title=${titleOf(page)}
    />
    <div class="mainbody">
      <div class="settings">
        <nav class="settingsnav">
          <button class="nav" onClick=${() => navigate({ view: 'home' })}>
            <${Icon} name="back" />${t('返回工作区')}
          </button>
          ${GROUPS.map(
            ([group, items]) =>
              html`<div class="navsection" key=${group}>${t(group)}</div>
                ${items.map(
                  ([id, label]) =>
                    html`<button
                      key=${id}
                      class=${`nav ${active === id ? 'active' : ''}`}
                      onClick=${() => navigate({ view: 'settings', id })}
                    >
                      ${t(label)}
                    </button>`,
                )}`,
          )}
        </nav>
        <div class="settingscontent">
          <div class="settingform" key=${page}>${content}</div>
        </div>
      </div>
    </div>
  </main>`;
}
