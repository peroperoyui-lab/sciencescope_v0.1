// Settings → Python 环境 (design system PageSettingsPython, PageSettingsPythonEnv,
// SourcePicker): the default environment, the list of managed environments
// with their state, the download sources (built-in ones plus the person's
// own), the shared cache; and one environment's packages on its own page.
// The system Python is only read, never changed.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { Dialog } from './dialog.js';
import { moveFocus, usePopover } from './popover.js';
import { AutoText, Head, Row, Section, Seg, Select } from './settings-kit.js';

const BUILTIN = 'builtin-science';
const INDEXES = [
  { name: '官方 PyPI', url: 'https://pypi.org/simple' },
  { name: '清华（国内）', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
  { name: '阿里云（国内）', url: 'https://mirrors.aliyun.com/pypi/simple' },
];
/** The official Python downloads are what uv uses when no mirror is set. */
const PYTHON_SOURCES = [{ name: '官方', url: null, note: 'GitHub · python-build-standalone' }];
const STATUS = {
  new: ['等待准备', ''],
  preparing: ['正在准备', 'busy'],
  ready: ['就绪', 'ok'],
  partial: ['部分安装', 'danger'],
  failed: ['失败', 'danger'],
};
const size = (bytes) =>
  (bytes ?? 0) >= 1073741824
    ? `${((bytes ?? 0) / 1073741824).toFixed(1)} GB`
    : `${Math.round((bytes ?? 0) / 1048576)} MB`;
/** "内置 · 科学分析" for the built-in environment. @param {any} entry */
const nameOf = (entry) => (entry.id === BUILTIN ? t('内置 · 科学分析') : entry.name);

/** The environments, refreshed when Python state changes. */
function usePython() {
  const actions = useActions();
  const version = useAppState((state) => state.pythonVersion);
  const [snapshot, setSnapshot] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = async () => {
    const current = ++generation.current;
    const result = await actions.pythonList();
    if (current === generation.current) setSnapshot(result);
    return result;
  };
  useEffect(() => {
    refresh().catch((caught) => setError(caught.message));
  }, [version]);
  /** Runs an operation, then reloads; the error stays on the page. @param {() => Promise<any>} work */
  const run = async (work) => {
    setError('');
    try {
      const result = await work();
      await refresh();
      return result;
    } catch (caught) {
      setError(caught.message);
      return undefined;
    }
  };
  return { snapshot, error, run, refresh };
}

// ---------- download sources ----------

/**
 * Add or change a source. It is tried once before saving; when it does not
 * answer, the reason shows under the address and 仍然保存 keeps it anyway.
 * @param {{ title: string, source?: { name: string, url: string } | null, hint: string,
 *   onSave: (source: { name: string, url: string }) => any, onClose: () => void }} props
 */
function SourceDialog({ title, source, hint, onSave, onClose }) {
  const actions = useActions();
  const [name, setName] = useState(source?.name ?? '');
  const [url, setUrl] = useState(source?.url ?? '');
  const [problem, setProblem] = useState('');
  const [checking, setChecking] = useState(false);
  const save = () => {
    onSave({ name: name.trim() || url.trim(), url: url.trim() });
    onClose();
  };
  async function submit() {
    if (!url.trim()) return setProblem(t('先填地址'));
    if (problem) return save();
    setChecking(true);
    try {
      const result = await actions.pythonProbe(url.trim());
      if (result.ok) save();
      else
        setProblem(
          result.reason === 'timeout'
            ? t('连不上这个地址（超时 10 秒）。请检查地址或网络；确定没错也可以仍然保存。')
            : t('连不上这个地址（{reason}）。请检查地址或网络；确定没错也可以仍然保存。', {
                reason: result.reason,
              }),
        );
    } catch (error) {
      setProblem(error.message);
    } finally {
      setChecking(false);
    }
  }
  return html`<${Dialog}
    title=${title}
    onClose=${onClose}
    onSubmit=${submit}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${checking}>
        ${checking ? t('正在试连…') : problem ? t('仍然保存') : source ? t('保存') : t('添加')}
      </button>`}
  >
    <label class="ss-field">
      <span class="ss-field__label">${t('名称')}</span>
      <span class="ss-input"
        ><input
          aria-label=${t('名称')}
          placeholder=${t('例如 学校镜像')}
          value=${name}
          onInput=${(event) => setName(event.currentTarget.value)}
      /></span>
    </label>
    <label class="ss-field">
      <span class="ss-field__label">${t('地址')}</span>
      <span class="ss-input" data-invalid=${problem ? '' : undefined}
        ><${Lucide} name="link" /><input
          class="ss-mono"
          aria-label=${t('地址')}
          placeholder="https://"
          value=${url}
          onInput=${(event) => {
            setUrl(event.currentTarget.value);
            setProblem('');
          }}
      /></span>
      ${
        problem
          ? html`<span class="ss-field__error" role="alert"
              ><${Lucide} name="circle-alert" small />${problem}</span
            >`
          : html`<span class="ss-field__hint">${hint}</span>`
      }
    </label>
  <//>`;
}

/**
 * A source select: built-in sources, then the person's own with 修改 and
 * 删除, then 添加自定义源…. Deleting the source in use falls back to the first built-in one.
 * @param {{ label: string, builtIn: Array<{ name: string, url: string | null, note?: string }>,
 *   custom: Array<{ name: string, url: string }>, value: string | null, kind: string, hint: string,
 *   onChange: (url: string | null) => void, onCustom: (list: Array<{ name: string, url: string }>, value?: string | null) => void }} props
 */
function SourceSelect({ label, builtIn, custom, value, kind, hint, onChange, onCustom }) {
  const pop = usePopover({ placement: 'bottom-end' });
  const [editing, setEditing] = useState(/** @type {{ index: number } | null} */ (null));
  const all = [...builtIn.map((source) => ({ ...source, name: t(source.name) })), ...custom];
  const current = all.find((source) => (source.url ?? null) === (value ?? null));
  const shown = current?.name ?? value ?? t(builtIn[0].name);
  useEffect(() => {
    if (pop.open)
      /** @type {HTMLElement | null | undefined} */ (
        pop.layer.current?.querySelector('[aria-checked="true"]')
      )?.focus();
  }, [pop.open]);
  const pick = (url) => {
    pop.setOpen(false);
    pop.trigger.current?.focus();
    if ((url ?? null) !== (value ?? null)) onChange(url);
  };
  const option = (source, index = -1) =>
    html`<div
      key=${source.url ?? 'official'}
      role="menuitemradio"
      tabindex="-1"
      class="ss-menu__item ss-menu__item--rich"
      aria-checked=${String((source.url ?? null) === (value ?? null))}
      aria-label=${source.name}
      onClick=${(event) => !event.target.closest('button') && pick(source.url)}
      onKeyDown=${(event) => (event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget && pick(source.url)}
    >
      <span class="ss-menu__text">
        <span>${source.name}</span>
        <span class="ss-menu__desc ss-mono">${source.note ? t(source.note) : source.url}</span>
      </span>
      ${
        index >= 0 &&
        html`<span class="ss-menu__tools">
          <button
            type="button"
            class="ss-icon-btn ss-icon-btn--sm"
            aria-label=${t('修改「{name}」', { name: source.name })}
            data-tip=${t('修改')}
            onClick=${() => {
              pop.setOpen(false);
              setEditing({ index });
            }}
          >
            <${Lucide} name="pencil" />
          </button>
          <button
            type="button"
            class="ss-icon-btn ss-icon-btn--sm"
            aria-label=${t('删除「{name}」', { name: source.name })}
            data-tip=${t('删除')}
            onClick=${() => {
              const next = custom.filter((_, i) => i !== index);
              onCustom(next, source.url === value ? (builtIn[0].url ?? null) : undefined);
            }}
          >
            <${Lucide} name="trash-2" />
          </button>
        </span>`
      }
      <${Lucide} name="check" class="ss-menu__check" />
    </div>`;
  return html`<button
      type="button"
      ref=${pop.trigger}
      class="ss-select"
      style="width:200px"
      aria-label=${label}
      aria-haspopup="menu"
      aria-expanded=${pop.open}
      onClick=${pop.toggle}
    >
      <span class="ss-select__value">${shown}</span><${Lucide} name="chevron-down" />
    </button>
    ${
      pop.open &&
      html`<div
        ref=${pop.layer}
        class="ss-menu"
        role="menu"
        aria-label=${label}
        style="width:340px"
        onKeyDown=${moveFocus}
      >
        <div class="ss-menu__label">${t('内置')}</div>
        ${builtIn.map((source) => option({ ...source, name: t(source.name) }))}
        ${
          custom.length > 0 &&
          html`<div class="ss-menu__sep" role="separator"></div>
            <div class="ss-menu__label">${t('自己添加的')}</div>
            ${custom.map((source, index) => option(source, index))}`
        }
        <div class="ss-menu__sep" role="separator"></div>
        <button
          type="button"
          role="menuitem"
          class="ss-menu__item"
          onClick=${() => {
            pop.setOpen(false);
            setEditing({ index: -1 });
          }}
        >
          <${Lucide} name="plus" />${t('添加自定义源…')}
        </button>
      </div>`
    }
    ${
      editing &&
      html`<${SourceDialog}
        title=${
          editing.index < 0
            ? t('添加{kind}', { kind })
            : t('修改「{name}」', { name: custom[editing.index].name })
        }
        source=${editing.index < 0 ? null : custom[editing.index]}
        hint=${hint}
        onClose=${() => setEditing(null)}
        onSave=${(source) => {
          const old = editing.index < 0 ? null : custom[editing.index];
          const next =
            editing.index < 0
              ? [...custom, source]
              : custom.map((entry, i) => (i === editing.index ? source : entry));
          // A new source is used at once; an edited one stays chosen if it was.
          onCustom(next, editing.index < 0 || old?.url === value ? source.url : undefined);
        }}
      />`
    }`;
}

// ---------- the list page ----------

/** 新建环境: name, Python version, and an environment to copy. */
function CreateDialog({ environments, onCreate, onClose }) {
  const [name, setName] = useState('');
  const [version, setVersion] = useState('3.14');
  const [template, setTemplate] = useState('');
  return html`<${Dialog}
    title=${t('新建环境')}
    onClose=${onClose}
    onSubmit=${() => name.trim() && onCreate({ name: name.trim(), version, template: template || undefined })}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${!name.trim()}>
        ${t('新建')}
      </button>`}
  >
    <label class="ss-field">
      <span class="ss-field__label">${t('环境名称')}</span>
      <span class="ss-input"
        ><input
          aria-label=${t('环境名称')}
          placeholder=${t('例如 访谈文本分析')}
          value=${name}
          onInput=${(event) => setName(event.currentTarget.value)}
      /></span>
    </label>
    <div class="ss-field">
      <span class="ss-field__label">${t('Python 版本')}</span>
      <${Seg}
        label=${t('Python 版本')}
        value=${version}
        options=${['3.14', '3.13', '3.12'].map((item) => [item, item])}
        onChange=${setVersion}
      />
    </div>
    <div class="ss-field">
      <span class="ss-field__label">${t('从哪个环境复制')}</span>
      <${Select}
        label=${t('从哪个环境复制')}
        width=${260}
        value=${template}
        options=${[
          { value: '', text: t('不复制，建一个空环境') },
          { value: BUILTIN, text: t('内置 · 科学分析') },
          ...environments
            .filter((entry) => entry.id !== BUILTIN)
            .map((entry) => ({ value: entry.id, text: entry.name })),
        ]}
        onChange=${setTemplate}
      />
    </div>
  <//>`;
}

/** 删除环境: which projects and chats follow the default afterwards. */
function RemoveDialog({ entry, onRemove, onClose }) {
  return html`<${Dialog}
    title=${t('删除环境「{name}」？', { name: nameOf(entry) })}
    size="sm"
    onClose=${onClose}
    onSubmit=${onRemove}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--danger">${t('删除')}</button>`}
  >
    <p>
      ${
        entry.bindings.length
          ? t('删除后，下面这些项目和对话改用默认环境：')
          : t('没有项目或对话在用它。装好的包会一起删掉。')
      }
    </p>
    ${
      entry.bindings.length > 0 &&
      html`<ul>
        ${entry.bindings.map((binding) => html`<li key=${binding.name}>${binding.name}</li>`)}
      </ul>`
    }
  <//>`;
}

/** 重命名 / 导出清单 / 删除环境 for one environment. */
function EnvironmentMenu({ entry, onExport, onRemove }) {
  const pop = usePopover({ placement: 'bottom-end' });
  const item = (icon, text, run, danger = false) =>
    html`<button
      type="button"
      role="menuitem"
      class=${`ss-menu__item ${danger ? 'ss-menu__item--danger' : ''}`}
      onClick=${() => {
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
      aria-label=${t('{name}的更多操作', { name: nameOf(entry) })}
      aria-haspopup="menu"
      aria-expanded=${pop.open}
      data-tip=${t('更多')}
      onClick=${pop.toggle}
    >
      <${Lucide} name="ellipsis" />
    </button>
    ${
      pop.open &&
      html`<div
        ref=${pop.layer}
        class="ss-menu"
        role="menu"
        aria-label=${nameOf(entry)}
        onKeyDown=${moveFocus}
      >
        ${item('pencil', t('重命名'), () => navigate({ view: 'settings', id: `python/${entry.id}` }))}
        ${item('file-output', t('导出清单'), onExport)}
        <div class="ss-menu__sep" role="separator"></div>
        ${item('trash-2', t('删除环境'), onRemove, true)}
      </div>`
    }`;
}

/** Download a requirements file. @param {string} name @param {string} content */
function download(name, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-requirements.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A state dot and word, and 重试 when installing stopped half way. */
function EnvironmentState({ entry, onRetry }) {
  const [text, tone] = STATUS[entry.status] ?? [entry.status, ''];
  return html`<span
      class=${`ss-provider__status ${tone === 'danger' ? 'ss-provider__status--danger' : ''}`}
    >
      ${tone === 'busy' ? html`<span class="ss-spin"></span>` : html`<span class=${`ss-dot ${tone ? `ss-dot--${tone}` : ''}`}></span>`}${t(text)}
    </span>
    ${
      ['failed', 'partial'].includes(entry.status) &&
      html`<button type="button" class="ss-btn ss-btn--sm" onClick=${onRetry}>${t('重试')}</button>`
    }`;
}

export function PythonPage() {
  const actions = useActions();
  const { snapshot, error, run } = usePython();
  const python = useAppState((state) => state.settings?.python);
  const [system, setSystem] = useState(/** @type {any} */ (null));
  const [dialog, setDialog] = useState(/** @type {any} */ (null));
  useEffect(() => {
    actions.pythonSystem().then(setSystem, () => setSystem({ available: false }));
  }, []);
  const environments = snapshot?.environments ?? [];
  const builtIn = environments.find((entry) => entry.id === BUILTIN);
  const write = (changes) => actions.attempt(() => actions.updateSettings({ python: changes }));
  const defaultValue =
    python?.defaultEnvironment ?? snapshot?.settings?.defaultEnvironment ?? BUILTIN;
  const sub = (entry) =>
    entry.error ||
    (entry.failedPackages?.length
      ? t('安装到一半停了：{packages} 没装上', {
          packages: entry.failedPackages.map((item) => item.package).join('、'),
        })
      : [
          `Python ${entry.version}`,
          t('{n} 个包', { n: entry.lock.length }),
          entry.bindings.length ? t('{n} 处在用', { n: entry.bindings.length }) : '',
          entry.exclusiveBytes ? t('独占 {size}', { size: size(entry.exclusiveBytes) }) : '',
        ]
          .filter(Boolean)
          .join(' · '));

  return html`<div class="ss-settings__inner" data-settings="python">
    <${Head}
      title=${t('Python 环境')}
      desc=${t('专家做数据分析时用的 Python。系统里原有的 Python 不会被改动。')}
    />
    ${
      error &&
      html`<div class="ss-callout ss-callout--danger" role="alert">
        <${Lucide} name="circle-alert" />
        <div class="ss-callout__body">${error}</div>
      </div>`
    }
    <${Section} title=${t('新任务默认')}>
      <${Row} label=${t('默认环境')} desc=${t('改了从下一轮发言开始用，对话记录不受影响')}>
        <${Select}
          label=${t('默认环境')}
          width=${240}
          value=${defaultValue}
          options=${[
            { value: BUILTIN, text: t('内置 · 科学分析') },
            { value: 'system', text: t('系统 Python') },
            ...environments
              .filter((entry) => entry.id !== BUILTIN)
              .map((entry) => ({ value: entry.id, text: entry.name })),
          ]}
          onChange=${(id) => write({ defaultEnvironment: id })}
        />
      <//>
    <//>
    <${Section}
      title=${t('环境')}
      count=${environments.length + (!builtIn && snapshot ? 1 : 0)}
      extra=${html`<button
        type="button"
        class="ss-btn ss-btn--sm"
        onClick=${() => setDialog({ kind: 'create' })}
      >
        <${Lucide} name="plus" />${t('新建环境')}
      </button>`}
    >
      <div class="ss-list" data-python-environments>
        ${
          !builtIn &&
          snapshot &&
          html`<div class="ss-list-row ss-list-row--2">
            <${Lucide} name="package" class="ss-list-row__icon" />
            <div class="ss-list-row__main">
              <span class="ss-list-row__title">${t('内置 · 科学分析')}</span>
              <span class="ss-list-row__sub">
                ${t('pandas、numpy、matplotlib 等常用包；第一次用时下载安装')}
              </span>
            </div>
            <button
              type="button"
              class="ss-btn ss-btn--sm"
              onClick=${() => run(() => actions.pythonOperate({ action: 'builtin' }))}
            >
              <${Lucide} name="download" />${t('现在准备')}
            </button>
          </div>`
        }
        ${environments.map(
          (entry) =>
            html`<div
              class="ss-list-row ss-list-row--2"
              key=${entry.id}
              data-environment=${entry.id}
            >
              <${Lucide} name="package" class="ss-list-row__icon" />
              <div class="ss-list-row__main">
                <span class="ss-list-row__title">${nameOf(entry)}</span>
                <span class="ss-list-row__sub">${sub(entry)}</span>
              </div>
              <${EnvironmentState}
                entry=${entry}
                onRetry=${() => run(() => actions.pythonOperate({ action: 'retry', id: entry.id }))}
              />
              <button
                type="button"
                class="ss-btn ss-btn--ghost ss-btn--sm"
                aria-label=${t('管理{name}', { name: nameOf(entry) })}
                onClick=${() => navigate({ view: 'settings', id: `python/${entry.id}` })}
              >
                ${t('管理')}
              </button>
              <${EnvironmentMenu}
                entry=${entry}
                onExport=${() =>
                  run(async () =>
                    download(entry.name, (await actions.pythonExport(entry.id)).text),
                  )}
                onRemove=${() => setDialog({ kind: 'remove', entry })}
              />
            </div>`,
        )}
      </div>
    <//>
    <${Section}
      title=${t('下载源')}
      tip=${t('内置了几个常用的源。学校或单位有自己的镜像时，在下拉框里选「添加自定义源」。')}
    >
      <${Row} label=${t('软件包镜像')} desc=${t('装软件包时从这里下载')}>
        <${SourceSelect}
          label=${t('软件包镜像')}
          kind=${t('软件包镜像')}
          hint=${t('填 pip 能用的索引地址，一般以 /simple 结尾。保存前会先试着连一下。')}
          builtIn=${INDEXES}
          custom=${python?.customIndexes ?? []}
          value=${python?.indexUrl ?? INDEXES[0].url}
          onChange=${(url) => write({ indexUrl: url })}
          onCustom=${(list, url) =>
            write({ customIndexes: list, ...(url !== undefined ? { indexUrl: url } : {}) })}
        />
      <//>
      <${Row} label=${t('Python 下载源')} desc=${t('只在新建环境、需要下载 Python 本身时用')}>
        <${SourceSelect}
          label=${t('Python 下载源')}
          kind=${t('Python 下载源')}
          hint=${t('要和官方 python-build-standalone 发布的文件一致。保存前会先试着连一下。')}
          builtIn=${PYTHON_SOURCES}
          custom=${python?.customInstallMirrors ?? []}
          value=${python?.installMirror ?? null}
          onChange=${(url) => write({ installMirror: url })}
          onCustom=${(list, url) =>
            write({
              customInstallMirrors: list,
              ...(url !== undefined ? { installMirror: url } : {}),
            })}
        />
      <//>
    <//>
    <${Section} title=${t('空间')}>
      <${Row}
        label=${t('共享缓存')}
        desc=${
          snapshot
            ? t('{size}，几个环境共用；清理只删没有环境在用的部分', {
                size: size(snapshot.cache.totalBytes),
              })
            : t('正在读取…')
        }
      >
        <button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          onClick=${() => run(actions.pythonPrune)}
        >
          <${Lucide} name="trash-2" />${t('清理未用到的')}
        </button>
      <//>
      <${Row}
        label=${t('系统 Python')}
        desc=${
          system == null
            ? t('正在检测…')
            : system.available
              ? t('{version} · 只读取，不修改', { version: system.version })
              : t('没有找到系统 Python')
        }
      />
    <//>
    ${
      dialog?.kind === 'create' &&
      html`<${CreateDialog}
        environments=${environments}
        onClose=${() => setDialog(null)}
        onCreate=${async (input) => {
          setDialog(null);
          const entry = await run(() => actions.pythonOperate({ action: 'create', ...input }));
          if (entry?.id) navigate({ view: 'settings', id: `python/${entry.id}` });
        }}
      />`
    }
    ${
      dialog?.kind === 'remove' &&
      html`<${RemoveDialog}
        entry=${dialog.entry}
        onClose=${() => setDialog(null)}
        onRemove=${() => {
          setDialog(null);
          void run(() => actions.pythonOperate({ action: 'remove', id: dialog.entry.id }));
        }}
      />`
    }
  </div>`;
}

// ---------- one environment ----------

/** Rows shown before 还有 N 个, unless the search is on. */
const SHOWN = 8;

/** @param {{ environmentId: string }} props */
export function PythonEnvironmentPage({ environmentId }) {
  const actions = useActions();
  const { snapshot, error, run } = usePython();
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const upload = useRef(/** @type {HTMLInputElement | null} */ (null));
  const entry = snapshot?.environments.find((item) => item.id === environmentId);
  if (!snapshot)
    return html`<div class="ss-settings__inner"><p role="status">${t('正在读取…')}</p></div>`;
  if (!entry)
    return html`<div class="ss-settings__inner">
      <${Head} back=${{ id: 'python', label: t('Python 环境') }} title=${t('找不到这个环境')} />
    </div>`;
  const specs = () =>
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  /** @param {string} label @param {() => Promise<any>} work */
  const operate = async (label, work) => {
    setBusy(label);
    const done = await run(work);
    setBusy('');
    if (done !== undefined) setText('');
  };
  const words = query.trim().toLowerCase();
  const packages = entry.lock.filter((item) => item.toLowerCase().includes(words));
  const shown = all || words ? packages : packages.slice(0, SHOWN);
  return html`<div class="ss-settings__inner" data-settings="python-environment" data-python-editor>
    <${Head}
      back=${{ id: 'python', label: t('Python 环境') }}
      title=${nameOf(entry)}
      desc=${[
        `Python ${entry.version}`,
        t('{n} 个包', { n: entry.lock.length }),
        entry.bindings.length
          ? t('「{name}」等 {n} 处在用', { name: entry.bindings[0].name, n: entry.bindings.length })
          : '',
      ]
        .filter(Boolean)
        .join(' · ')}
    />
    ${
      error &&
      html`<div class="ss-callout ss-callout--danger" role="alert">
        <${Lucide} name="circle-alert" />
        <div class="ss-callout__body">${error}</div>
      </div>`
    }
    ${
      entry.id !== BUILTIN &&
      html`<${Section} title=${t('基本')}>
        <${Row} label=${t('名称')}>
          <${AutoText}
            label=${t('环境名称')}
            width=${240}
            value=${entry.name}
            onSave=${(name) =>
              name.trim() &&
              run(() =>
                actions.pythonOperate({ action: 'rename', id: entry.id, name: name.trim() }),
              )}
          />
        <//>
      <//>`
    }
    <${Section}
      title=${t('已安装')}
      count=${entry.lock.length}
      extra=${
        !words &&
        packages.length > SHOWN &&
        html`<button type="button" class="ss-linkbtn" onClick=${() => setAll(!all)}>
          ${all ? t('收起') : t('还有 {n} 个', { n: packages.length - SHOWN })}
        </button>`
      }
    >
      <label class="ss-input ss-input--sm" style="width:240px;margin-bottom:4px">
        <${Lucide} name="search" small />
        <input
          type="search"
          aria-label=${t('查找已安装的包')}
          placeholder=${t('查找已安装的包')}
          value=${query}
          onInput=${(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <div class="ss-list python-packages">
        ${shown.map((item) => {
          const [name, version] = item.split('==');
          return html`<div class="ss-list-row" key=${item} title=${item}>
            <div class="ss-list-row__main">
              <span class="ss-list-row__title ss-mono">${name}</span>
            </div>
            <span class="ss-list-row__meta">${version ?? ''}</span>
          </div>`;
        })}
        ${!shown.length && html`<p class="ss-settings__desc">${words ? t('没有找到。') : t('还没有装包。')}</p>`}
      </div>
    <//>
    <${Section}
      title=${t('添加或移除')}
      tip=${t('「按清单同步」会让环境里的包和清单完全一致，清单里没有的会被移除。')}
      extra=${html`<span class="ss-toolbar">
        <button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          onClick=${() => upload.current?.click()}
        >
          <${Lucide} name="file-input" />${t('导入清单')}
        </button>
        <button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          onClick=${() =>
            run(async () => download(entry.name, (await actions.pythonExport(entry.id)).text))}
        >
          <${Lucide} name="file-output" />${t('导出清单')}
        </button>
      </span>`}
    >
      <textarea
        class="ss-textarea"
        aria-label=${t('软件包清单')}
        placeholder=${t('每行一个包，可以写版本，例如 jieba==0.42.1')}
        value=${text}
        onInput=${(event) => setText(event.currentTarget.value)}
      ></textarea>
      <div class="ss-toolbar" style="margin-top:8px">
        ${[
          ['add', '安装', 'download'],
          ['remove', '移除', ''],
          ['sync', '按清单同步', ''],
        ].map(
          ([action, label, icon], index) =>
            html`<button
              type="button"
              key=${action}
              class=${`ss-btn ss-btn--sm ${index ? 'ss-btn--ghost' : ''}`}
              disabled=${Boolean(busy) || !specs().length}
              onClick=${() =>
                operate(label, () => actions.pythonPackages(entry.id, action, specs()))}
            >
              ${icon && html`<${Lucide} name=${icon} />`}${t(label)}
            </button>`,
        )}
        ${busy && html`<span class="ss-muted" role="status"><span class="ss-spin"></span> ${t('正在{action}…', { action: t(busy) })}</span>`}
      </div>
      <input
        ref=${upload}
        type="file"
        accept=".txt,.in,.lock"
        hidden
        onChange=${(event) => {
          const file = event.currentTarget.files?.[0];
          if (file)
            void operate('导入清单', async () => {
              const content = await file.text();
              return actions.pythonImport(entry.id, content);
            });
        }}
      />
    <//>
  </div>`;
}
