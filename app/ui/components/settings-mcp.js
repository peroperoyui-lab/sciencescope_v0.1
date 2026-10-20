// Settings → MCP 服务器 (design system PageSettingsMcp): the servers from
// `GET /api/mcp/servers` with their connection state, added by form or by
// pasting an `mcpServers` configuration. Environment variables and request
// headers are stored only as key references; a saved value shows as
// 已保存在密钥文件 and is never sent back to the page.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { Dialog } from './dialog.js';
import { ChoiceMenu } from './popover.js';
import { Info } from './settings-models.js';

const NPM_OFFICIAL = 'https://registry.npmjs.org';

/** `npx -y "my server"` → ['npx', '-y', 'my server']. @param {string} text */
export function splitCommand(text) {
  return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );
}
/** @param {string} command @param {string[]} [args] */
const joinCommand = (command, args = []) =>
  [command, ...args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
const markOf = (name) =>
  String(name)
    .replace(/[^\p{L}\p{N}]/gu, '')
    .slice(0, 2) || 'M';

/** The servers a pasted configuration holds, as the host reads it (parseMcpImport). @param {string} text */
function pasted(text) {
  if (!text.trim()) return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: t('粘贴的内容不是有效的 JSON。') };
  }
  const entries =
    value?.mcpServers ?? (value?.command || value?.url ? { [value.name ?? 'MCP']: value } : value);
  if (!entries || typeof entries !== 'object' || Array.isArray(entries))
    return { error: t('没有找到 MCP 服务器配置。') };
  return {
    servers: Object.entries(entries).map(([name, entry]) => ({
      name,
      secrets: Object.keys({ ...entry?.env, ...entry?.headers }).length,
    })),
  };
}

/** One name/value row; `saved` is a stored key reference that is kept unless replaced. */
function emptyRow() {
  return { name: '', value: '', saved: null };
}

/** @param {{ server?: any, onClose: () => void, onSaved: () => void }} props */
function ServerDialog({ server, onClose, onSaved }) {
  const actions = useActions();
  const [name, setName] = useState(server?.name ?? '');
  const [transport, setTransport] = useState(server?.transport ?? 'stdio');
  const [command, setCommand] = useState(
    server?.command ? joinCommand(server.command, server.args) : '',
  );
  const [url, setUrl] = useState(server?.url ?? '');
  const rowsOf = (field) =>
    Object.entries(server?.[field] ?? {}).map(([key, value]) => ({
      name: key,
      value: '',
      saved: value,
    }));
  const [rows, setRows] = useState({ stdio: rowsOf('env'), http: rowsOf('headers') });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    server?.status === 'failed' ? t('上次连接失败：{error}', { error: server.error }) : '',
  );
  const list = rows[transport];
  const setList = (next) => setRows({ ...rows, [transport]: next });
  const change = (index, patch) =>
    setList(list.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function save() {
    if (busy) return;
    if (!name.trim()) return setError(t('请填写名称。'));
    const values = Object.fromEntries(
      list
        .filter((row) => row.name.trim() && (row.saved || row.value))
        .map((row) => [row.name.trim(), row.value ? row.value : row.saved]),
    );
    const [first = '', ...args] = splitCommand(command);
    const input =
      transport === 'stdio'
        ? { name: name.trim(), transport, command: first, args, env: values }
        : { name: name.trim(), transport, url: url.trim(), headers: values };
    setBusy(true);
    setError('');
    try {
      const result = await actions.saveMcpServer(input, server?.id);
      onSaved();
      if (result.status === 'failed')
        setError(t('已保存，但连接失败：{error}', { error: result.error }));
      else onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const label = transport === 'stdio' ? t('环境变量') : t('请求头');
  return html`<${Dialog}
    title=${server ? t('编辑 MCP 服务器') : t('添加 MCP 服务器')}
    size="lg"
    onClose=${onClose}
    onSubmit=${save}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${busy}>
        ${busy ? t('正在连接…') : t('连接并保存')}
      </button>`}
  >
    <div class="ss-stack">
      <label class="ss-field">
        <span class="ss-field__label">${t('名称')}</span>
        <span class="ss-input">
          <input
            value=${name}
            placeholder="Zotero"
            onInput=${(event) => setName(event.currentTarget.value)}
          />
        </span>
      </label>
      <div class="ss-field">
        <span class="ss-field__label">${t('连接方式')}</span>
        <div class="ss-seg ss-seg--sm ss-seg--start" role="group" aria-label=${t('连接方式')}>
          ${[
            ['stdio', '本地命令'],
            ['http', '网址'],
          ].map(
            ([id, text]) =>
              html`<button
                type="button"
                key=${id}
                aria-pressed=${String(transport === id)}
                onClick=${() => setTransport(id)}
              >
                ${t(text)}
              </button>`,
          )}
        </div>
      </div>
      ${
        transport === 'stdio'
          ? html`<label class="ss-field">
              <span class="ss-field__label">${t('启动命令')}</span>
              <span class="ss-input">
                <input
                  class="ss-mono"
                  value=${command}
                  placeholder="npx -y zotero-mcp"
                  onInput=${(event) => setCommand(event.currentTarget.value)}
                />
              </span>
              <span class="ss-field__hint">
                ${t('npx、uvx 和 node 用 ScienceScope 自带的 Node 和 uv，不需要另外安装。')}
              </span>
            </label>`
          : html`<label class="ss-field">
              <span class="ss-field__label">${t('网址')}</span>
              <span class="ss-input">
                <input
                  class="ss-mono"
                  value=${url}
                  placeholder="https://example.org/mcp"
                  onInput=${(event) => setUrl(event.currentTarget.value)}
                />
              </span>
              <span class="ss-field__hint">${t('支持 Streamable HTTP 和 SSE，会自动识别。')}</span>
            </label>`
      }
      <div class="ss-field">
        <span class="ss-field__label">${label}</span>
        ${
          list.length > 0 &&
          html`<div class="ss-kv">
            ${list.map(
              (row, index) =>
                html`<span class="ss-input ss-input--sm" key=${`name-${index}`}>
                    <input
                      class="ss-mono"
                      aria-label=${t('{field}名称', { field: label })}
                      value=${row.name}
                      placeholder=${transport === 'stdio' ? 'API_KEY' : 'Authorization'}
                      onInput=${(event) => change(index, { name: event.currentTarget.value })}
                    />
                  </span>
                  ${
                    row.saved && !row.replacing
                      ? html`<span class="ss-kv__saved" key=${`value-${index}`}>
                          <${Lucide} name="key-round" small />${t('已保存在密钥文件')}
                          <button
                            type="button"
                            class="ss-linkbtn"
                            onClick=${() => change(index, { replacing: true })}
                          >
                            ${t('更换')}
                          </button>
                        </span>`
                      : html`<span class="ss-input ss-input--sm" key=${`value-${index}`}>
                          <${Lucide} name="key-round" small />
                          <input
                            class="ss-mono"
                            type="password"
                            aria-label=${t('{field}的值', { field: label })}
                            value=${row.value}
                            placeholder=${row.saved ? t('粘贴新的值') : ''}
                            onInput=${(event) => change(index, { value: event.currentTarget.value })}
                          />
                        </span>`
                  }
                  <button
                    type="button"
                    class="ss-icon-btn ss-icon-btn--sm"
                    key=${`remove-${index}`}
                    aria-label=${t('删除这一行')}
                    data-tip=${t('删除这一行')}
                    onClick=${() => setList(list.filter((_, i) => i !== index))}
                  >
                    <${Lucide} name="x" />
                  </button>`,
            )}
          </div>`
        }
        <div>
          <button
            type="button"
            class="ss-btn ss-btn--ghost ss-btn--sm"
            onClick=${() => setList([...list, emptyRow()])}
          >
            <${Lucide} name="plus" />${t('添加一行')}
          </button>
        </div>
        <span class="ss-field__hint">
          ${t('值只存在本机的密钥文件里，不写进配置，也不会再显示出来。')}
        </span>
      </div>
      ${
        error &&
        html`<span class="ss-field__error" role="alert"
          ><${Lucide} name="circle-alert" small />${error}</span
        >`
      }
    </div>
  </${Dialog}>`;
}

/** @param {{ onClose: () => void, onSaved: () => void }} props */
function PasteDialog({ onClose, onSaved }) {
  const actions = useActions();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const found = pasted(text);
  const count = found?.servers?.length ?? 0;
  const secrets = (found?.servers ?? []).reduce((sum, server) => sum + server.secrets, 0);
  async function submit() {
    if (busy || !count) return;
    setBusy(true);
    setError('');
    try {
      const saved = await actions.importMcpConfig(text);
      onSaved();
      const failed = saved.filter((server) => server.status === 'failed');
      if (failed.length)
        actions.toast(
          t('已添加 {n} 个，{failed} 个连接失败，请在列表里查看原因。', {
            n: saved.length,
            failed: failed.length,
          }),
        );
      else actions.toast(t('已添加 {n} 个服务器。', { n: saved.length }));
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return html`<${Dialog}
    title=${t('粘贴 MCP 配置')}
    size="lg"
    onClose=${onClose}
    onSubmit=${submit}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${busy || !count}>
        ${busy ? t('正在连接…') : count ? t('添加 {n} 个并连接', { n: count }) : t('添加')}
      </button>`}
  >
    <div class="ss-stack">
      <label class="ss-field">
        <span class="ss-field__label">${t('配置 JSON')}</span>
        <textarea
          class="ss-textarea ss-mono ss-textarea--tall"
          spellcheck="false"
          placeholder=${'{ "mcpServers": { … } }'}
          value=${text}
          onInput=${(event) => setText(event.currentTarget.value)}
        ></textarea>
        <span class="ss-field__hint">
          ${t('Claude Desktop、Cursor、Codex 等软件说明里的 mcpServers 配置都可以直接粘贴。')}
        </span>
      </label>
      ${
        found?.error &&
        html`<span class="ss-field__error" role="alert"
          ><${Lucide} name="circle-alert" small />${found.error}</span
        >`
      }
      ${
        count > 0 &&
        html`<div class="ss-callout ss-callout--ok">
          <${Lucide} name="circle-check" />
          <div class="ss-callout__body">
            ${t('识别到 {n} 个服务器：{names}。', {
              n: count,
              names: found.servers.map((server) => server.name).join(t('、')),
            })}
            ${secrets > 0 && t('其中 {n} 个环境变量或请求头的值会存进密钥文件。', { n: secrets })}
          </div>
        </div>`
      }
      ${
        error &&
        html`<span class="ss-field__error" role="alert"
          ><${Lucide} name="circle-alert" small />${error}</span
        >`
      }
    </div>
  </${Dialog}>`;
}

/** @param {{ server: any, onClose: () => void, onConfirm: () => void }} props */
function RemoveDialog({ server, onClose, onConfirm }) {
  return html`<${Dialog}
    title=${t('删除 {name}？', { name: server.name })}
    size="sm"
    onClose=${onClose}
    onSubmit=${onConfirm}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--danger">${t('删除')}</button>`}
  >
    <p>${t('它的工具会从所有角色那里移除。之后可以重新添加。')}</p>
  </${Dialog}>`;
}

/** @param {{ server: any, busy: boolean, onEdit: () => void, onReconnect: () => void,
 *   onSwitch: (on: boolean) => void, onMenu: (event: Event) => void }} props */
function ServerCard({ server, busy, onEdit, onReconnect, onSwitch, onMenu }) {
  const tools = () => navigate({ view: 'settings', id: 'tools' });
  let status;
  if (busy)
    status = html`<span class="ss-provider__status"
      ><${Lucide} name="loader-circle" small class="ss-spin" />${t('正在连接…')}</span
    >`;
  else if (server.status === 'connected')
    status = html`<span class="ss-provider__status"
      ><span class="ss-dot ss-dot--ok"></span
      >${t('已连接 · {n} 个工具', { n: server.toolCount })}</span
    >`;
  else if (server.status === 'failed')
    status = html`<span class="ss-provider__status ss-provider__status--danger"
      ><span class="ss-dot ss-dot--danger"></span>${t('连接失败')}</span
    >`;
  else
    status = html`<span class="ss-provider__status"
      ><span class="ss-dot ss-dot--ring"></span>${t('已停用')}</span
    >`;
  return html`<article class="ss-provider" data-server=${server.id}>
    <div class="ss-provider__head">
      <span class="ss-preset__mark ss-preset__mark--sm">${markOf(server.name)}</span>
      <div class="ss-provider__main">
        <span class="ss-provider__name">${server.name}</span>
        <span class="ss-provider__meta ss-truncate">
          ${server.transport === 'http' ? t('网址') : t('本地命令')} ·
          <span class="ss-mono"
            >${server.transport === 'http' ? server.url : joinCommand(server.command, server.args)}</span
          >
        </span>
      </div>
      ${status}
      ${
        !busy &&
        server.status === 'connected' &&
        html`<button type="button" class="ss-btn ss-btn--ghost ss-btn--sm" onClick=${tools}>
          ${t('查看工具')}
        </button>`
      }
      ${
        !busy &&
        server.status === 'failed' &&
        html`<button type="button" class="ss-btn ss-btn--sm" onClick=${onEdit}>${t('编辑')}</button>
          <button type="button" class="ss-btn ss-btn--sm" onClick=${onReconnect}>
            ${t('重新连接')}
          </button>`
      }
      <input
        type="checkbox"
        role="switch"
        class="ss-switch"
        aria-label=${t('启用 {name}', { name: server.name })}
        checked=${server.enabled}
        disabled=${busy}
        onChange=${(event) => onSwitch(event.currentTarget.checked)}
      />
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('更多')}
        data-tip=${t('更多')}
        onClick=${onMenu}
      >
        <${Lucide} name="ellipsis" />
      </button>
    </div>
    ${
      !busy &&
      server.status === 'failed' &&
      html`<div class="ss-provider__error" role="alert">
        <${Lucide} name="circle-alert" small />${server.error}
      </div>`
    }
  </article>`;
}

/** @param {{ value: string, onClose: () => void, onSave: (url: string) => void }} props */
function RegistryDialog({ value, onClose, onSave }) {
  const [url, setUrl] = useState(value);
  const [error, setError] = useState('');
  function submit() {
    try {
      if (!['http:', 'https:'].includes(new URL(url.trim()).protocol)) throw new Error();
    } catch {
      return setError(t('请填写有效的 HTTP 或 HTTPS 网址。'));
    }
    onSave(url.trim());
    onClose();
  }
  return html`<${Dialog}
    title=${t('自定义 npx 下载源')}
    size="sm"
    onClose=${onClose}
    onSubmit=${submit}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary">${t('保存')}</button>`}
  >
    <label class="ss-field">
      <span class="ss-field__label">${t('npm 仓库网址')}</span>
      <span class="ss-input" data-invalid=${error ? '' : undefined}>
        <input class="ss-mono" value=${url} onInput=${(event) => setUrl(event.currentTarget.value)} />
      </span>
      ${
        error &&
        html`<span class="ss-field__error" role="alert"
          ><${Lucide} name="circle-alert" small />${error}</span
        >`
      }
    </label>
  </${Dialog}>`;
}

export function McpPage() {
  const actions = useActions();
  const registry = useAppState((state) => state.settings?.mcp?.npmRegistry ?? null);
  const [servers, setServers] = useState(/** @type {any[] | null} */ (null));
  const [busy, setBusy] = useState(/** @type {Set<string>} */ (new Set()));
  const [dialog, setDialog] = useState(/** @type {any} */ (null));
  const load = async () => setServers(await actions.listMcpServers());
  useEffect(() => {
    void actions.attempt(load);
  }, []);
  if (!servers) return html`<p role="status">${t('正在读取…')}</p>`;

  /** Work on one server while its card says 正在连接…. */
  async function working(id, work) {
    setBusy((all) => new Set([...all, id]));
    await actions.attempt(work);
    await actions.attempt(load);
    setBusy((all) => new Set([...all].filter((item) => item !== id)));
  }
  const reconnect = (server) => working(server.id, () => actions.reconnectMcpServer(server.id));
  const openMenu = (event, server) =>
    actions.openMenu(event, [
      { text: t('编辑'), icon: 'pencil', run: () => setDialog({ kind: 'server', server }) },
      { text: t('重新连接'), icon: 'refresh-cw', run: () => reconnect(server) },
      {
        text: t('查看工具'),
        icon: 'wrench',
        run: () => navigate({ view: 'settings', id: 'tools' }),
      },
      { sep: true },
      {
        text: t('删除服务器'),
        icon: 'trash-2',
        danger: true,
        run: () => setDialog({ kind: 'remove', server }),
      },
    ]);
  const saveRegistry = (npmRegistry) =>
    actions.attempt(() => actions.updateSettings({ mcp: { npmRegistry } }));
  const registries = [
    {
      text: t('npmmirror（国内镜像）'),
      selected: registry === null,
      run: () => saveRegistry(null),
    },
    {
      text: t('npm 官方'),
      selected: registry === NPM_OFFICIAL,
      run: () => saveRegistry(NPM_OFFICIAL),
    },
    {
      text: t('自定义…'),
      selected: registry !== null && registry !== NPM_OFFICIAL,
      run: () => setDialog({ kind: 'registry' }),
    },
  ];
  const connected = servers.filter((server) => server.status === 'connected');
  const failed = servers.filter((server) => server.status === 'failed').length;
  const add = html`<button
      type="button"
      class="ss-btn ss-btn--ghost ss-btn--sm"
      onClick=${() => setDialog({ kind: 'paste' })}
    >
      <${Lucide} name="clipboard-paste" />${t('粘贴配置')}
    </button>
    <button type="button" class="ss-btn ss-btn--sm" onClick=${() => setDialog({ kind: 'server' })}>
      <${Lucide} name="plus" />${t('添加服务器')}
    </button>`;

  return html`<div class="ss-settings__inner" data-settings="mcp">
    <h2 class="ss-settings__title">
      ${t('MCP 服务器')}<${Info}
        text=${t('MCP 是让 AI 使用外部程序的通用接口，例如 Zotero、数据库、网页抓取。添加后它的工具出现在「工具」页，所有角色都能用。在「请求批准」下每次调用前先问你，可以在批准卡片上选「总是允许 → 这个服务器的所有工具」。')}
      />
    </h2>
    ${
      servers.length > 0 &&
      html`<p class="ss-settings__desc">
        ${t('{n} 个已连接，共 {tools} 个工具。', {
          n: connected.length,
          tools: connected.reduce((sum, server) => sum + server.toolCount, 0),
        })}${failed > 0 && t('{n} 个连接失败。', { n: failed })}
      </p>`
    }
    <section class="ss-setting-section">
      <div class="ss-setting-section__head">
        <h3 class="ss-setting-section__title">
          ${t('服务器')}<span class="ss-count">${servers.length}</span>
        </h3>
        ${servers.length > 0 && add}
      </div>
      ${
        servers.length
          ? servers.map(
              (server) =>
                html`<${ServerCard}
                  key=${server.id}
                  server=${server}
                  busy=${busy.has(server.id)}
                  onEdit=${() => setDialog({ kind: 'server', server })}
                  onReconnect=${() => reconnect(server)}
                  onSwitch=${(enabled) =>
                    working(server.id, () => actions.saveMcpServer({ enabled }, server.id))}
                  onMenu=${(event) => openMenu(event, server)}
                />`,
            )
          : html`<div class="ss-box">
              <div class="ss-empty">
                <div class="ss-empty__icon"><${Lucide} name="server" /></div>
                <div class="ss-empty__title">${t('还没有 MCP 服务器')}</div>
                <div class="ss-empty__text">
                  ${t('接上 Zotero、数据库、网页抓取等外部程序，专家就能用它们的工具。')}
                </div>
                <div class="ss-empty__actions">${add}</div>
              </div>
            </div>`
      }
    </section>
    <section class="ss-setting-section">
      <div class="ss-setting-section__head">
        <h3 class="ss-setting-section__title">${t('下载源')}</h3>
      </div>
      <div class="ss-setting-row">
        <div class="ss-setting-row__text">
          <span class="ss-setting-row__label">${t('npx 下载源')}</span>
          <span class="ss-setting-row__desc">
            ${t('用 npx 启动的服务器从这里下载；uvx 用「运行环境」里的 Python 下载源')}
          </span>
        </div>
        <div class="ss-setting-row__control">
          <${ChoiceMenu}
            label=${t('npx 下载源')}
            items=${registries}
            triggerClass="ss-select"
            placement="bottom-end"
            attrs=${{ style: 'width:240px' }}
          >
            <span class="ss-select__value ss-truncate">
              ${registries.find((item) => item.selected)?.text === t('自定义…') ? registry : registries.find((item) => item.selected)?.text}
            </span>
          </${ChoiceMenu}>
        </div>
      </div>
    </section>
    ${
      dialog?.kind === 'server' &&
      html`<${ServerDialog}
        server=${dialog.server}
        onClose=${() => setDialog(null)}
        onSaved=${() => actions.attempt(load)}
      />`
    }
    ${
      dialog?.kind === 'paste' &&
      html`<${PasteDialog}
        onClose=${() => setDialog(null)}
        onSaved=${() => actions.attempt(load)}
      />`
    }
    ${
      dialog?.kind === 'registry' &&
      html`<${RegistryDialog}
        value=${registry ?? ''}
        onClose=${() => setDialog(null)}
        onSave=${saveRegistry}
      />`
    }
    ${
      dialog?.kind === 'remove' &&
      html`<${RemoveDialog}
        server=${dialog.server}
        onClose=${() => setDialog(null)}
        onConfirm=${async () => {
          setDialog(null);
          await working(dialog.server.id, () => actions.deleteMcpServer(dialog.server.id));
        }}
      />`
    }
  </div>`;
}
