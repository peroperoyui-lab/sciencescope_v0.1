import { useEffect, useState, useRef } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { InfoTip } from './info-tip.js';
import { PythonChoice } from './python-choice.js';

const statuses = {
  new: '等待准备',
  preparing: '正在准备环境',
  ready: '就绪',
  partial: '已部分安装',
  failed: '失败',
};
const size = (bytes) => `${((bytes ?? 0) / 1048576).toFixed(1)} MiB`;

/**
 * @param {{environment:any,run:(work:()=>Promise<any>)=>Promise<void>,busy:boolean}} props
 */
function EnvironmentEditor({ environment, run, busy }) {
  const actions = useActions();
  const [name, setName] = useState(environment.name);
  const [text, setText] = useState(environment.packages.join('\n'));
  const [query, setQuery] = useState('');
  const upload = useRef(null);
  const specs = () =>
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  async function exportManifest() {
    const { text: content } = await actions.pythonExport(environment.id);
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = environment.name + '-requirements.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return html`<section data-python-editor>
    <h3>${environment.name}</h3>
    <form
      onSubmit=${(event) => {
        event.preventDefault();
        void run(() => actions.pythonOperate({ action: 'rename', id: environment.id, name }));
      }}
    >
      <label
        >${t('环境名称')}<input
          aria-label=${t('重命名环境名称')}
          value=${name}
          onInput=${(event) => setName(event.currentTarget.value)} /></label
      ><button class="btn" disabled=${busy}>${t('重命名环境')}</button>
    </form>
    <label
      >${t('查找已安装的包')}<input
        type="search"
        value=${query}
        onInput=${(event) => setQuery(event.currentTarget.value)}
    /></label>
    <div class="python-packages">
      ${environment.lock.filter((item) => item.toLowerCase().includes(query.toLowerCase())).map((item) => html`<div>${item}</div>`)}
    </div>
    <label
      >${t('软件包清单')}<${InfoTip}
        text=${t('每行一个包名或版本约束。同步使环境与清单一致；只修改受管环境。')}
      /><textarea
        aria-label=${t('软件包清单')}
        rows="7"
        value=${text}
        onInput=${(event) => setText(event.currentTarget.value)}
      />
    </label>
    <div class="saverow">
      ${[
        ['add', '安装清单中的包'],
        ['sync', '同步到清单'],
        ['remove', '移除清单中的包'],
      ].map(
        ([action, label]) =>
          html`<button
            class="btn"
            disabled=${busy}
            onClick=${() => run(() => actions.pythonPackages(environment.id, action, specs()))}
          >
            ${t(label)}
          </button>`,
      )} <button class="btn" onClick=${() => run(exportManifest)}>${t('导出清单')}</button
      ><button class="btn" onClick=${() => upload.current.click()}>${t('导入清单')}</button>
      <input
        ref=${upload}
        type="file"
        accept=".txt,.in,.lock"
        hidden
        onChange=${(event) => {
          const file = event.currentTarget.files[0];
          if (file)
            void run(async () => {
              const content = await file.text();
              setText(content);
              return actions.pythonImport(environment.id, content);
            });
        }}
      />
    </div>
  </section>`;
}

export function PythonSettings() {
  const actions = useActions();
  const version = useAppState((state) => state.pythonVersion);
  const [snapshot, setSnapshot] = useState(null),
    [system, setSystem] = useState(null);
  const [error, setError] = useState(''),
    [feedback, setFeedback] = useState(''),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null),
    [name, setName] = useState(''),
    [pythonVersion, setPythonVersion] = useState('3.14'),
    [template, setTemplate] = useState('');
  const [defaultEnvironment, setDefault] = useState('builtin-science'),
    [indexUrl, setIndex] = useState('https://pypi.org/simple');
  const generation = useRef(0);
  async function refresh() {
    const current = ++generation.current;
    const result = await actions.pythonList();
    if (current === generation.current) setSnapshot(result);
    return result;
  }
  useEffect(() => {
    void refresh().catch((caught) => setError(caught.message));
  }, [version]);
  useEffect(() => {
    void actions
      .pythonSystem()
      .then(setSystem)
      .catch((caught) => setError(caught.message));
    void actions.pythonList().then((result) => {
      setDefault(result.settings.defaultEnvironment ?? 'builtin-science');
      setIndex(result.settings.indexUrl ?? 'https://pypi.org/simple');
    });
  }, []);
  async function run(work) {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await work();
      await refresh();
      setFeedback(t('环境操作已完成'));
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }
  const environment = snapshot?.environments.find((entry) => entry.id === selected);
  const remove = (entry) =>
    actions.openModal(
      t('删除环境'),
      html`<div>
        <p>${t('删除后，以下项目或对话改为跟随默认环境：')}</p>
        <ul>
          ${entry.bindings.map((binding) => html`<li>${binding.name}</li>`)}
        </ul>
        <p>${entry.name}</p>
        <div class="saverow">
          <button class="btn" onClick=${actions.closeModal}>${t('取消')}</button
          ><button
            class="btn danger"
            onClick=${() => {
              actions.closeModal();
              void run(() => actions.pythonOperate({ action: 'remove', id: entry.id }));
            }}
          >
            ${t('删除')}
          </button>
        </div>
      </div>`,
    );
  return html`<section class="card python-settings">
    <h2>
      ${t('Python 环境')}<${InfoTip}
        text=${t('受管环境共享包缓存，系统 Python 不会被修改。首次使用内置环境会下载安装。')}
      />
    </h2>
    ${error && html`<p role="alert">${error}</p>`}
    <p role="status">${busy ? t('正在处理环境操作…') : feedback}</p>
    <form
      onSubmit=${(event) => {
        event.preventDefault();
        void run(() => actions.updateSettings({ python: { defaultEnvironment, indexUrl } }));
      }}
    >
      <label>${t('新任务默认环境')}</label
      ><${PythonChoice} id="python-default" value=${defaultEnvironment} onChange=${setDefault} />
      <label
        >${t('软件包镜像源')}<select
          aria-label=${t('软件包镜像源')}
          value=${['https://pypi.org/simple', 'https://pypi.tuna.tsinghua.edu.cn/simple', 'https://mirrors.aliyun.com/pypi/simple'].includes(indexUrl) ? indexUrl : 'custom'}
          onChange=${(event) => setIndex(event.currentTarget.value === 'custom' ? '' : event.currentTarget.value)}
        >
          <option value="https://pypi.org/simple">${t('官方')}</option>
          <option value="https://pypi.tuna.tsinghua.edu.cn/simple">${t('清华')}</option>
          <option value="https://mirrors.aliyun.com/pypi/simple">${t('阿里云')}</option>
          <option value="custom">${t('自定义')}</option>
        </select></label
      >
      <input
        type="url"
        aria-label=${t('镜像地址')}
        value=${indexUrl}
        onInput=${(event) => setIndex(event.currentTarget.value)}
      /><button class="btn" disabled=${busy}>${t('保存环境设置')}</button>
    </form>
    <p>
      ${system?.available ? `${t('系统 Python')} · ${system.version} · ${system.path}` : t('未检测到系统 Python')}
    </p>
    <form
      onSubmit=${(event) => {
        event.preventDefault();
        void run(async () => {
          const entry = await actions.pythonOperate({
            action: 'create',
            name,
            version: pythonVersion,
            template: template || undefined,
          });
          setSelected(entry.id);
        });
      }}
    >
      <label
        >${t('环境名称')}<input
          aria-label=${t('环境名称')}
          required
          value=${name}
          onInput=${(event) => setName(event.currentTarget.value)}
      /></label>
      <label
        >${t('Python 版本')}<input
          aria-label=${t('Python 版本')}
          required
          value=${pythonVersion}
          onInput=${(event) => setPythonVersion(event.currentTarget.value)}
      /></label>
      <label
        >${t('复制已有环境')}<select
          value=${template}
          onChange=${(event) => setTemplate(event.currentTarget.value)}
        >
          <option value="">${t('创建空环境')}</option>
          <option value="builtin-science">${t('内置 · 科学分析')}</option>
          ${(snapshot?.environments ?? []).filter((entry) => entry.id !== 'builtin-science').map((entry) => html`<option value=${entry.id}>${entry.name}</option>`)}
        </select></label
      >
      <button class="btn" disabled=${busy}>${t('新建环境')}</button
      ><button
        type="button"
        class="btn"
        disabled=${busy}
        onClick=${() => run(() => actions.pythonOperate({ action: 'builtin' }))}
      >
        ${t('准备内置环境')}
      </button>
    </form>
    ${(snapshot?.environments ?? []).map(
      (entry) =>
        html`<div class="settingrow">
          <div class="grow">
            <strong>${entry.id === 'builtin-science' ? t('内置 · 科学分析') : entry.name}</strong>
            <p>
              ${entry.version} · ${t(statuses[entry.status] ?? entry.status)} · ${entry.lock.length}
              ${t('个软件包')} · ${entry.bindings.length} ${t('处绑定')} · ${t('独占空间')}
              ${size(entry.exclusiveBytes)}
            </p>
            ${entry.error && html`<p role="alert">${entry.error}</p>`}${entry.failedPackages.length > 0 && html`<p>${entry.failedPackages.map((item) => item.package).join(', ')}</p>`}
          </div>
          <button class="btn tiny" onClick=${() => setSelected(entry.id)}>${t('管理')}</button
          >${['failed', 'partial'].includes(entry.status) && html`<button class="btn tiny" disabled=${busy} onClick=${() => run(() => actions.pythonOperate({ action: 'retry', id: entry.id }))}>${t('重试')}</button>`}<button
            class="btn tiny"
            disabled=${busy}
            onClick=${() => remove(entry)}
          >
            ${t('删除')}
          </button>
        </div>`,
    )}
    ${environment && html`<${EnvironmentEditor} key=${environment.id} environment=${environment} run=${run} busy=${busy} />`}
    <p>${t('共享缓存')} · ${size(snapshot?.cache.totalBytes)}</p>
    <button class="btn" disabled=${busy} onClick=${() => run(actions.pythonPrune)}>
      ${t('清理未引用的缓存')}
    </button>
  </section>`;
}
