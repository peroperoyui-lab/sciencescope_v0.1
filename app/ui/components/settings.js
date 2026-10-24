// Settings (design system PageSettings*): a centred dialog over the page the
// person came from, navigation in four groups on the left, one page on the
// right. This file holds the frame and the 通用, 外观 and 快捷键 pages; the
// other pages live in settings-*.js. Every change applies at once.
import { useEffect, useRef, useState } from 'preact/hooks';
import { comboOf } from '../appearance.js';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { AutoText, Head, Row, Section, Seg, Select, Switch, useSetting } from './settings-kit.js';
import { ModelsPage, ProviderPage } from './settings-models.js';
import { ExpertsPage, RoleDetail } from './settings-roles.js';
import { SecretaryPage } from './settings-secretary.js';
import { AssistantPage } from './assistant-window-settings.js';
import { ApprovalsPage } from './settings-approvals.js';
import { ToolsPage } from './settings-tools.js';
import { SkillsPage } from './settings-skills.js';
import { McpPage } from './settings-mcp.js';
import { KnowledgePage } from './settings-semantic.js';
import { DeskPage } from './settings-desk.js';
import { PythonEnvironmentPage, PythonPage } from './settings-python.js';
import { DataPage } from './settings-data.js';
import { AboutPage } from './settings-about.js';

/**
 * The navigation: [group, [[page id, icon, label]]].
 * @type {Array<[string, string[][]]>}
 */
const GROUPS = [
  [
    '个人',
    [
      ['general', 'settings', '通用'],
      ['appearance', 'palette', '外观'],
      ['shortcuts', 'keyboard', '快捷键'],
    ],
  ],
  [
    '研究协作',
    [
      ['models', 'plug', '模型与服务商'],
      ['experts', 'users', '专家'],
      ['secretary', 'clipboard-list', '任务秘书'],
      ['assistant', 'sparkle', '全局助手'],
      ['approvals', 'shield-check', '执行与批准'],
    ],
  ],
  [
    '工具',
    [
      ['tools', 'wrench', '工具'],
      ['skills', 'graduation-cap', '技能'],
      ['mcp', 'server', 'MCP 服务器'],
    ],
  ],
  [
    '资料与环境',
    [
      ['knowledge', 'book-open', '知识库与检索'],
      ['desk', 'app-window', '编辑台'],
      ['python', 'package', 'Python 环境'],
      ['data', 'database', '数据与备份'],
    ],
  ],
];

/** Page ids from the earlier navigation, kept so old links still open the right page. */
const ALIASES = {
  persona: 'experts/agent_main',
  'secretary-settings': 'secretary',
  'assistant-settings': 'assistant',
  'library-settings': 'data',
  environment: 'python',
};

// ---------- 通用 ----------

function GeneralPage() {
  const [profile, writeProfile] = useSetting((settings) => settings.profile);
  const [composer, writeComposer] = useSetting((settings) => settings.composer);
  const [language, writeLanguage] = useSetting((settings) => settings.appearance.language);
  const [desk, writeDesk] = useSetting((settings) => settings.features?.editingDesk === true);
  return html`<div class="ss-settings__inner" data-settings="general">
    <${Head} title=${t('通用')} desc=${t('改了立即生效。')} />
    <${Section} title=${t('个人资料')}>
      <${Row} label=${t('显示名称')} desc=${t('只在这台电脑上显示，不发给专家')}>
        <${AutoText}
          label=${t('显示名称')}
          width=${320}
          placeholder=${t('用户')}
          value=${profile?.name ?? ''}
          onSave=${(name) => writeProfile({ profile: { name: name.trim() } })}
        />
      <//>
      <${Row} label=${t('一句话介绍')} desc=${t('写给自己看的，可以留空')}>
        <${AutoText}
          label=${t('一句话介绍')}
          width=${320}
          value=${profile?.bio ?? ''}
          onSave=${(bio) => writeProfile({ profile: { bio } })}
        />
      <//>
    <//>
    <${Section} title=${t('使用')}>
      <${Row} label=${t('界面语言')} desc=${t('只改界面文字，对话内容不变')}>
        <${Select}
          label=${t('界面语言')}
          width=${160}
          value=${language}
          options=${[
            { value: 'zh', text: '中文' },
            { value: 'en', text: 'English' },
          ]}
          onChange=${(next) => writeLanguage({ appearance: { language: next } })}
        />
      <//>
      <${Row} label=${t('发送消息')} desc=${t('另一种组合用来换行；Shift Enter 总是换行')}>
        <${Seg}
          label=${t('发送消息')}
          value=${composer?.sendKey ?? 'enter'}
          options=${[
            ['enter', 'Enter'],
            ['ctrl-enter', 'Ctrl Enter'],
          ]}
          onChange=${(sendKey) => writeComposer({ composer: { sendKey } })}
        />
      <//>
      <${Row}
        label=${t('截图时隐藏窗口')}
        desc=${t('用「添加 → 截图」时，先把 ScienceScope 藏起来')}
      >
        <${Switch}
          label=${t('截图时隐藏窗口')}
          checked=${composer?.hideWindowOnScreenshot !== false}
          onChange=${(on) => writeComposer({ composer: { hideWindowOnScreenshot: on } })}
        />
      <//>
    <//>
    <${Section}
      title=${t('试用功能')}
      tip=${t('试用功能还没做完，可能会变。关掉后，已有的内容不会丢。')}
    >
      <${Row}
        label=${t('编辑台')}
        desc=${t('还在开发中。打开后，左栏「工作站」下面出现编辑台入口')}
      >
        <${Switch}
          label=${t('编辑台')}
          checked=${desk}
          onChange=${(on) => writeDesk({ features: { editingDesk: on } })}
        />
      <//>
    <//>
  </div>`;
}

// ---------- 外观 ----------

/** Chat line heights (multiples of the text size) and their names. @type {Array<[number, string]>} */
const LINE_HEIGHTS = [
  [1.45, '紧凑'],
  [1.6, '标准'],
  [1.75, '宽松'],
];

/** Fonts installed on this computer (Local Font Access), names only. */
async function installedFonts() {
  const query = /** @type {any} */ (globalThis).queryLocalFonts;
  if (typeof query !== 'function') return [];
  const fonts = await query();
  return [...new Set(fonts.map((font) => font.family))].sort((a, b) => a.localeCompare(b));
}

/** @param {number[]} sizes */
const sizeOptions = (sizes) => sizes.map((size) => ({ value: size, text: `${size} px` }));

function AppearancePage() {
  const [look, write] = useSetting((settings) => settings.appearance);
  const [fonts, setFonts] = useState(/** @type {string[]} */ ([]));
  const [fontStatus, setFontStatus] = useState('');
  if (!look) return null;
  const set = (changes) => write({ appearance: changes });
  // Fonts are read only when the person asks: reading them makes WebView2 ask
  // for the "local fonts" permission, which should not pop up on opening settings.
  async function readFonts() {
    try {
      const found = await installedFonts();
      setFonts(found);
      setFontStatus(found.length ? '' : t('读不到本机字体，只能用内置字体。'));
    } catch (error) {
      setFontStatus(error.message);
    }
  }
  const fontChoices = [
    { value: '', text: t('思源黑体（内置）') },
    ...(look.font && !fonts.includes(look.font) ? [{ value: look.font, text: look.font }] : []),
    ...fonts.map((family) => ({ value: family, text: family })),
  ];
  return html`<div class="ss-settings__inner" data-settings="appearance">
    <${Head} title=${t('外观')} />
    <${Section} title=${t('主题与字体')}>
      <${Row} label=${t('主题')}>
        <${Seg}
          label=${t('主题')}
          small=${false}
          value=${look.theme}
          options=${[
            ['light', html`<${Lucide} name="sun" />${t('浅色')}`],
            ['dark', html`<${Lucide} name="moon" />${t('深色')}`],
            ['system', html`<${Lucide} name="monitor" />${t('跟随系统')}`],
          ]}
          onChange=${(theme) => set({ theme })}
        />
      <//>
      <${Row} label=${t('界面字体')} desc=${fontStatus || t('没有中文字形的字体会用替代字显示')}>
        <${Select}
          label=${t('界面字体')}
          value=${look.font ?? ''}
          options=${fontChoices}
          onChange=${(font) => set({ font })}
        />
        <button type="button" class="ss-linkbtn" onClick=${readFonts}>
          ${fonts.length ? t('重新读取') : t('读取本机字体')}
        </button>
      <//>
      <${Row} label=${t('界面密度')} desc=${t('只改左栏和设置的间距，不缩放对话文字')}>
        <${Seg}
          label=${t('界面密度')}
          value=${look.density}
          options=${[
            ['standard', t('标准')],
            ['compact', t('紧凑')],
          ]}
          onChange=${(density) => set({ density })}
        />
      <//>
    <//>
    <${Section} title=${t('对话文字')}>
      <${Row} label=${t('对话字号')}>
        <${Select}
          label=${t('对话字号')}
          small
          width=${96}
          value=${look.chatFontSize}
          options=${sizeOptions([13, 14, 15, 16, 18, 20])}
          onChange=${(chatFontSize) => set({ chatFontSize })}
        />
      <//>
      <${Row} label=${t('对话行距')}>
        <${Seg}
          label=${t('对话行距')}
          value=${look.chatLineHeight}
          options=${LINE_HEIGHTS.map(([value, label]) => [value, t(String(label))])}
          onChange=${(chatLineHeight) => set({ chatLineHeight })}
        />
      <//>
      <${Row} label=${t('侧栏字号')} desc=${t('左栏，以及右边的任务秘书和全局助手')}>
        <${Select}
          label=${t('侧栏字号')}
          small
          width=${96}
          value=${look.sideFontSize}
          options=${sizeOptions([12, 13, 14, 15, 16])}
          onChange=${(sideFontSize) => set({ sideFontSize })}
        />
      <//>
      <${Row} label=${t('代码字号')} desc=${t('只改消息里的代码块')}>
        <${Select}
          label=${t('代码字号')}
          small
          width=${96}
          value=${look.codeFontSize}
          options=${sizeOptions([12, 13, 14, 15, 16, 18])}
          onChange=${(codeFontSize) => set({ codeFontSize })}
        />
      <//>
      <div class="ss-settings__preview ss-thread" aria-label=${t('预览')}>
        <div class="ss-msg">
          <div class="ss-msg__head">
            <span class="ss-avatar">${t('主')}</span
            ><span class="ss-msg__name">${t('主专家')}</span>
          </div>
          <div class="ss-msg__body message-text rendered-markdown">
            <p>
              ${t('三份访谈都提到「老街坊搬走以后，茶馆就散了」。可以把茶馆当作社区记忆的载体来写，先列出它在访谈里出现的场合。')}
            </p>
            <p><code>quotes = interviews.search("茶馆")</code></p>
          </div>
        </div>
      </div>
    <//>
    <${Section} title=${t('动效与滚动条')}>
      <${Row} label=${t('减少过渡动画')} desc=${t('打开后，菜单和面板直接出现，不做淡入和滑动')}>
        <${Switch}
          label=${t('减少过渡动画')}
          checked=${Boolean(look.reduceMotion)}
          onChange=${(reduceMotion) => set({ reduceMotion })}
        />
      <//>
      <${Row} label=${t('始终显示滚动条')} desc=${t('关掉时，滚动条只在滚动时出现')}>
        <${Switch}
          label=${t('始终显示滚动条')}
          checked=${Boolean(look.scrollbars)}
          onChange=${(scrollbars) => set({ scrollbars })}
        />
      <//>
    <//>
  </div>`;
}

// ---------- 快捷键 ----------

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
/** Keys the window keeps for editing and the browser shell, and what they do. */
const RESERVED = {
  'Ctrl+C': '复制',
  'Ctrl+V': '粘贴',
  'Ctrl+X': '剪切',
  'Ctrl+A': '全选',
  'Ctrl+Z': '撤销',
  'Ctrl+Y': '重做',
  'Ctrl+F': '查找',
  'Ctrl+R': '刷新',
  'Ctrl+W': '关闭窗口',
};
/** "Ctrl+Shift+K" shown as "Ctrl Shift K". @param {string} combo */
const shown = (combo) => combo.replaceAll('+', ' ');

/** One shortcut field: click, press the keys; a clash is explained under the label. */
function ShortcutRow({ name, label, keys, onSave }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  function record(event) {
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (event.key === 'Escape') return event.currentTarget.blur();
    const combo = comboOf(event);
    if (!combo) return;
    if (!/^(Ctrl|Alt)\+/.test(combo)) return setError(t('要带上 Ctrl 或 Alt'));
    if (RESERVED[combo])
      return setError(
        t('{key} 是{action}，不能占用', { key: shown(combo), action: t(RESERVED[combo]) }),
      );
    const taken = SHORTCUT_LABELS.find(([other]) => other !== name && keys[other] === combo);
    if (taken)
      return setError(t('{key} 已经给了「{name}」', { key: shown(combo), name: t(taken[1]) }));
    setError('');
    onSave({ ...keys, [name]: combo });
    event.currentTarget.blur();
  }
  return html`<${Row}
    label=${t(label)}
    desc=${
      error &&
      html`<span class="ss-field__error"><${Lucide} name="circle-alert" small />${error}</span>`
    }
  >
    <span class="ss-input ss-input--sm" style="width:180px" data-invalid=${error ? '' : undefined}>
      <input
        id=${`shortcut-${name}`}
        data-shortcut-input
        readonly
        value=${recording ? '' : shown(keys[name])}
        placeholder=${t('按下组合键…')}
        aria-label=${t('{name}快捷键', { name: t(label) })}
        onFocus=${() => setRecording(true)}
        onBlur=${() => setRecording(false)}
        onKeyDown=${record}
      />
    </span>
  <//>`;
}

function ShortcutsPage() {
  const [saved, write] = useSetting((settings) => settings.shortcuts);
  const [sendKey] = useSetting((settings) => settings.composer?.sendKey ?? 'enter');
  const keys = { ...SHORTCUT_DEFAULTS, ...saved };
  const save = (next) => write({ shortcuts: next });
  const fixed = [
    ['发送消息', sendKey === 'ctrl-enter' ? 'Ctrl Enter' : 'Enter'],
    ['换行', sendKey === 'ctrl-enter' ? 'Enter' : 'Shift Enter'],
    ['停止回答、关闭弹层', 'Esc'],
    ['重命名左栏里选中的项目或对话', 'F2'],
  ];
  return html`<div class="ss-settings__inner" data-settings="shortcuts">
    <${Head}
      title=${t('快捷键')}
      desc=${t('点一下输入框，再按组合键。只在 ScienceScope 窗口里有效。')}
    />
    <${Section}
      title=${t('可以改的')}
      extra=${html`<button
        type="button"
        class="ss-btn ss-btn--ghost ss-btn--sm"
        onClick=${() => save({ ...SHORTCUT_DEFAULTS })}
      >
        <${Lucide} name="undo-2" />${t('恢复默认')}
      </button>`}
    >
      ${SHORTCUT_LABELS.map(
        ([name, label]) =>
          html`<${ShortcutRow}
            key=${name}
            name=${name}
            label=${label}
            keys=${keys}
            onSave=${save}
          />`,
      )}
    <//>
    <${Section}
      title=${t('固定的')}
      tip=${t('复制、粘贴、撤销、查找这些系统按键也保留，不能改。发送键在「通用」里换。')}
    >
      <div class="ss-list">
        ${fixed.map(
          ([action, key]) =>
            html`<div class="ss-list-row" key=${action}>
              <div class="ss-list-row__main">
                <span class="ss-list-row__title">${t(action)}</span>
              </div>
              <span class="ss-kbd">${key}</span>
            </div>`,
        )}
      </div>
    <//>
  </div>`;
}

// ---------- the frame ----------

/** @param {string} id */
function pageFor(id) {
  const [section, ...rest] = id.split('/');
  const sub = rest.join('/');
  if (section === 'general') return html`<${GeneralPage} />`;
  if (section === 'appearance') return html`<${AppearancePage} />`;
  if (section === 'shortcuts') return html`<${ShortcutsPage} />`;
  if (section === 'models') return html`<${ModelsPage} />`;
  if (section === 'provider') return html`<${ProviderPage} index=${sub || 'new'} />`;
  if (section === 'experts')
    return sub ? html`<${RoleDetail} key=${sub} participantId=${sub} />` : html`<${ExpertsPage} />`;
  if (section === 'secretary') return html`<${SecretaryPage} />`;
  if (section === 'assistant') return html`<${AssistantPage} />`;
  if (section === 'approvals') return html`<${ApprovalsPage} />`;
  if (section === 'tools') return html`<${ToolsPage} />`;
  if (section === 'skills') return html`<${SkillsPage} />`;
  if (section === 'mcp') return html`<${McpPage} />`;
  if (section === 'knowledge') return html`<${KnowledgePage} />`;
  if (section === 'desk') return html`<${DeskPage} />`;
  if (section === 'python')
    return sub
      ? html`<${PythonEnvironmentPage} key=${sub} environmentId=${sub} />`
      : html`<${PythonPage} />`;
  if (section === 'data') return html`<${DataPage} />`;
  if (section === 'about') return html`<${AboutPage} />`;
  return html`<div class="ss-settings__inner">
    <p class="ss-settings__desc">${t('没有这个设置页。')}</p>
  </div>`;
}

/** The navigation entry a page belongs to. @param {string} id */
function activeOf(id) {
  const section = id.split('/')[0];
  return section === 'provider' ? 'models' : section;
}

/**
 * The settings dialog. `page` is the id from `#/settings/<page>`; closing
 * returns to the page underneath.
 * @param {{ page: string, onClose: () => void }} props
 */
export function SettingsDialog({ page, onClose }) {
  const actions = useActions();
  const id = ALIASES[page] ?? page;
  const active = activeOf(id);
  const desk = useAppState((state) => state.settings?.features?.editingDesk === true);
  const [version, setVersion] = useState('');
  const content = useRef(/** @type {HTMLElement | null} */ (null));
  useEffect(() => {
    actions.attempt(async () => setVersion((await actions.systemInfo()).version ?? ''));
  }, []);
  // Esc closes settings unless a menu, popover or dialog inside it took the key first.
  useEffect(() => {
    /** @param {KeyboardEvent} event */
    const key = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (
        document.querySelector('.ss-menu, .ss-pop, #v-menu, .ss-scrim:not([data-settings-scrim])')
      )
        return;
      event.preventDefault();
      onClose();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);
  useEffect(() => {
    content.current?.scrollTo?.(0, 0);
  }, [id]);
  const go = (next) => navigate({ view: 'settings', id: next });
  const item = (pageId, icon, label, end = null) =>
    html`<button
      key=${pageId}
      type="button"
      class="ss-nav-item"
      aria-current=${active === pageId ? 'page' : undefined}
      onClick=${() => go(pageId)}
    >
      <${Lucide} name=${icon} /><span class="ss-nav-item__label">${t(label)}</span>${end}
    </button>`;
  return html`<div
    class="ss-scrim"
    data-settings-scrim
    onPointerDown=${(event) => event.target === event.currentTarget && onClose()}
  >
    <div
      class="ss-dialog ss-dialog--settings"
      role="dialog"
      aria-modal="true"
      aria-label=${t('设置')}
    >
      <button
        type="button"
        class="ss-icon-btn ss-settings__close"
        aria-label=${t('关闭')}
        data-tip=${t('关闭')}
        data-kbd="Esc"
        onClick=${onClose}
      >
        <${Lucide} name="x" />
      </button>
      <div class="ss-settings">
        <nav class="ss-settings__nav" aria-label=${t('设置分类')}>
          <div class="ss-settings__navtitle">${t('设置')}</div>
          ${GROUPS.map(
            ([group, items]) =>
              html`<div class="ss-settings__navgroup" key=${group}>${t(group)}</div>
                ${items
                  .filter(([pageId]) => pageId !== 'desk' || desk)
                  .map(([pageId, icon, label]) => item(pageId, icon, label))}`,
          )}
          <div class="ss-settings__navsep"></div>
          ${item(
            'about',
            'info',
            '关于',
            version && html`<span class="ss-nav-item__end">${version}</span>`,
          )}
        </nav>
        <div class="ss-settings__content" ref=${content} key=${id}>${pageFor(id)}</div>
      </div>
    </div>
  </div>`;
}
