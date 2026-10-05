// Settings → 模型与 API in the old interface's markup: provider cards and the
// add / edit form. Providers live in settings.json (`providers`), keys only in
// the credentials file; the default model is `models.default`.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { navigate } from '../route.js';
import { InfoTip } from './info-tip.js';

const PROTOCOLS = [
  ['openai-completions', 'OpenAI Chat Completions'],
  ['openai-responses', 'OpenAI Responses'],
  ['anthropic-messages', 'Anthropic Messages'],
];
const protocolLabel = (api) => PROTOCOLS.find(([id]) => id === api)?.[1] ?? api;

/** Stable id and key name for a provider name. @param {string} name */
function providerId(name, taken) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'provider';
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
}
const keyRefOf = (id) => `SCIENCESCOPE_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_KEY`;

function useKeyRefs() {
  const actions = useActions();
  const [refs, setRefs] = useState(/** @type {string[]} */ ([]));
  useEffect(() => {
    actions.attempt(async () => setRefs(await actions.keyRefs()));
  }, []);
  return refs;
}

export function ModelsPage() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const refs = useKeyRefs();
  const providers = settings?.providers ?? [];
  const current = settings?.models?.default;
  const save = (changes) => actions.attempt(() => actions.updateSettings(changes));
  const remove = (index) =>
    save({
      providers: providers.filter((_, i) => i !== index),
      ...(current?.provider === providers[index].id ? { models: { default: null } } : {}),
    });

  return html`<div class="api-settings">
    <div class="pageintro between">
      <h1 style="margin:0">
        ${t('模型与 API')}<${InfoTip}
          text=${t('配置由本地 DSH 管理。保存后，模型是否可用以实际请求结果为准。')}
          label=${t('模型与 API 说明')}
        />
      </h1>
      <div class="row">
        <button
          type="button"
          class="btn primary"
          onClick=${() => navigate({ view: 'settings', id: 'provider/new' })}
        >
          ＋ ${t('添加服务')}
        </button>
      </div>
    </div>
    ${
      providers.length
        ? html`<div class="stack">
            ${providers.map(
              (provider, index) =>
                html`<article class="card api-provider" key=${provider.id}>
                  <div class="between">
                    <div>
                      <h2>${provider.name ?? provider.id}</h2>
                      <small class="muted">${protocolLabel(provider.api)}</small>
                    </div>
                    <span class="tag">
                      ${refs.includes(provider.keyRef) ? t('已保存 · 未测试') : t('已保存 · 未设置密钥')}
                    </span>
                  </div>
                  <p class="api-address">${provider.baseUrl}</p>
                  <div class="api-models">
                    ${provider.models.map((model) => {
                      const chosen =
                        current?.provider === provider.id && current?.model === model.id;
                      return html`<button
                        key=${model.id}
                        class=${`tag ${chosen ? 'fill' : ''}`}
                        title=${chosen ? t('当前默认模型') : t('设为默认')}
                        onClick=${() =>
                          save({ models: { default: { provider: provider.id, model: model.id } } })}
                      >
                        ${chosen && html`<${Icon} name="check" />`}${model.name ?? model.id}
                      </button>`;
                    })}
                  </div>
                  <div class="saverow">
                    <button
                      type="button"
                      class="btn"
                      onClick=${() => navigate({ view: 'settings', id: `provider/${index}` })}
                    >
                      ${t('编辑')}
                    </button>
                    <button type="button" class="btn" onClick=${() => remove(index)}>
                      ${t('移除服务')}
                    </button>
                  </div>
                </article>`,
            )}
          </div>`
        : html`<div class="api-empty card">
            <div class="api-empty-icon"><${Icon} name="key" /></div>
            <h2>${t('连接你的模型服务')}</h2>
            <p class="muted">${t('使用自己的 API 服务；没有模型列表的服务，也可以手动添加。')}</p>
            <button
              type="button"
              class="btn primary"
              onClick=${() => navigate({ view: 'settings', id: 'provider/new' })}
            >
              ${t('添加第一个服务')}
            </button>
          </div>`
    }
  </div>`;
}

/** "名称: 值" lines ↔ a headers object. */
const headersText = (headers) =>
  Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
function parseHeaders(text) {
  const headers = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return headers;
}

/** @param {{ index: string }} props `new` or the provider's position. */
export function ProviderPage({ index }) {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const providers = settings?.providers ?? [];
  const editing = index === 'new' ? null : providers[Number(index)];
  const [draft, setDraft] = useState({
    name: editing?.name ?? '',
    api: editing?.api ?? '',
    baseUrl: editing?.baseUrl ?? '',
    headers: headersText(editing?.headers),
    models: (editing?.models ?? []).map((model) => model.id).join('\n'),
  });
  const [limits, setLimits] = useState(
    Object.fromEntries((editing?.models ?? []).map((model) => [model.id, model])),
  );
  const [key, setKey] = useState('');
  const [errors, setErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const field = (name) => (event) => setDraft({ ...draft, [name]: event.currentTarget.value });
  const ids = [
    ...new Set(
      draft.models
        .split(/\r?\n/)
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  const setLimit = (id, name, value) =>
    setLimits({ ...limits, [id]: { ...limits[id], [name]: value } });

  function validate() {
    /** @type {Record<string, string>} */
    const found = {};
    if (!draft.name.trim()) found.name = t('请填写服务名称。');
    if (!draft.api) found.api = t('请选择 API 格式。');
    if (!/^https?:\/\/\S+$/.test(draft.baseUrl.trim()))
      found.baseUrl = t('请填写以 http:// 或 https:// 开头的地址。');
    if (!ids.length) found.models = t('至少填写一个模型 ID。');
    setErrors(found);
    return !Object.keys(found).length;
  }

  async function discover() {
    if (!draft.api || !draft.baseUrl.trim()) return validate();
    setBusy(true);
    setNotice('');
    try {
      const models = await actions.discoverModels({
        baseUrl: draft.baseUrl.trim(),
        api: draft.api,
        key: key || undefined,
        keyRef: editing?.keyRef,
        headers: parseHeaders(draft.headers),
      });
      setDraft({ ...draft, models: [...new Set([...ids, ...models])].join('\n') });
      setNotice(t('已获取 {n} 个模型。', { n: models.length }));
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || !validate()) return;
    setBusy(true);
    const id =
      editing?.id ??
      providerId(
        draft.name,
        providers.map((p) => p.id),
      );
    const keyRef = editing?.keyRef ?? keyRefOf(id);
    const number = (value) => (Number(value) > 0 ? Number(value) : undefined);
    const provider = {
      id,
      name: draft.name.trim(),
      api: draft.api,
      baseUrl: draft.baseUrl.trim(),
      keyRef,
      ...(draft.headers.trim() ? { headers: parseHeaders(draft.headers) } : {}),
      models: ids.map((modelId) => {
        const limit = limits[modelId] ?? {};
        const efforts = String(limit.efforts ?? '')
          .split(/[,，\s]+/)
          .filter(Boolean);
        return {
          id: modelId,
          ...(number(limit.contextWindow) ? { contextWindow: number(limit.contextWindow) } : {}),
          ...(number(limit.maxTokens) ? { maxTokens: number(limit.maxTokens) } : {}),
          ...(efforts.length ? { efforts } : {}),
        };
      }),
    };
    const next = editing
      ? providers.map((candidate) => (candidate === editing ? provider : candidate))
      : [...providers, provider];
    try {
      if (key) await actions.saveKey(keyRef, key);
      setKey('');
      await actions.updateSettings({
        providers: next,
        ...(settings?.models?.default
          ? {}
          : { models: { default: { provider: id, model: ids[0] } } }),
      });
      navigate({ view: 'settings', id: 'models' });
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  const error = (name) => html`<span class="api-error">${errors[name] ?? ''}</span>`;
  const back = () => navigate({ view: 'settings', id: 'models' });
  return html`<div class="settingform api-settings">
    <button type="button" class="btn" onClick=${back}>← ${t('模型与 API')}</button>
    <div class="pageintro between">
      <h1 style="margin:0">
        ${editing ? t('编辑模型服务') : t('添加模型服务')}<${InfoTip}
          text=${t('密钥只保存在本机凭据文件，不进入聊天或研究材料。保存服务不等于模型已可用，以实际请求结果为准。')}
          label=${t('模型服务说明')}
        />
      </h1>
    </div>
    ${notice && html`<div class="api-notice">${notice}</div>`}
    <form onSubmit=${submit} novalidate>
      <div class="field">
        <label class="label" for="api-name">${t('服务名称')}</label>
        <input
          id="api-name"
          value=${draft.name}
          placeholder=${t('例如：我的研究模型')}
          aria-invalid=${Boolean(errors.name)}
          onInput=${field('name')}
        />
        ${error('name')}
      </div>
      <div class="field">
        <label class="label" for="api-protocol">${t('API 格式')}</label>
        <select
          id="api-protocol"
          value=${draft.api}
          aria-invalid=${Boolean(errors.api)}
          onChange=${field('api')}
        >
          <option value="">${t('选择服务明确支持的协议')}</option>
          ${PROTOCOLS.map(([id, label]) => html`<option key=${id} value=${id}>${label}</option>`)}
        </select>
        ${error('api')}
      </div>
      <div class="field">
        <label class="label" for="api-baseUrl">${t('接口地址 · Base URL')}</label>
        <input
          id="api-baseUrl"
          value=${draft.baseUrl}
          placeholder="https://api.example.com/v1"
          aria-invalid=${Boolean(errors.baseUrl)}
          onInput=${field('baseUrl')}
        />
        ${error('baseUrl')}
      </div>
      <div class="field">
        <label class="label" for="api-key-preview">
          API Key<${InfoTip}
            text=${t('密钥不会保存在页面草稿或研究文件中。编辑时留空会保留原密钥。')}
          />
        </label>
        <input
          id="api-key-preview"
          type="password"
          autocomplete="off"
          placeholder=${t('输入 API Key（不回显已存密钥）')}
          value=${key}
          onInput=${(event) => setKey(event.currentTarget.value)}
        />
      </div>
      <div class="field">
        <label class="label" for="api-headers">
          ${t('附加请求头')}<${InfoTip}
            text=${t('少数服务要求额外的请求头，例如会话标识。每行一个，格式为 名称: 值。')}
          />
        </label>
        <textarea
          id="api-headers"
          rows="2"
          value=${draft.headers}
          onInput=${field('headers')}
        ></textarea>
      </div>
      <div class="between api-model-heading">
        <h3>${t('模型')}</h3>
        <button type="button" class="btn" disabled=${busy} onClick=${discover}>
          ${busy ? t('处理中…') : t('获取模型列表')}
        </button>
      </div>
      <div class="field">
        <label class="label" for="api-models">
          ${t('模型 ID')}<${InfoTip}
            text=${t('每行一个，可直接手动填写服务商提供的准确模型 ID。')}
          />
        </label>
        <textarea
          id="api-models"
          rows="4"
          placeholder=${t('服务商提供的准确模型 ID')}
          aria-invalid=${Boolean(errors.models)}
          value=${draft.models}
          onInput=${field('models')}
        ></textarea>
        ${error('models')}
      </div>
      <section>
        ${ids.map(
          (id) =>
            html`<div class="field api-output-limit" key=${id}>
              <label>
                ${id}<${InfoTip}
                  text=${t('上下文窗口用于输入框的上下文环；最大输出未知时沿用运行时默认值；思考强度只填写模型公开支持的值，用逗号分隔。下一轮生效。')}
                />
              </label>
              <div class="row">
                <input
                  type="number"
                  min="1"
                  placeholder=${t('上下文窗口 token')}
                  aria-label=${t('{name} 上下文窗口', { name: id })}
                  value=${limits[id]?.contextWindow ?? ''}
                  onInput=${(event) => setLimit(id, 'contextWindow', event.currentTarget.value)}
                />
                <input
                  type="number"
                  min="1"
                  placeholder=${t('最大输出 token')}
                  aria-label=${t('{name} 最大输出 token', { name: id })}
                  value=${limits[id]?.maxTokens ?? ''}
                  onInput=${(event) => setLimit(id, 'maxTokens', event.currentTarget.value)}
                />
                <input
                  placeholder=${t('思考强度，如 low, high')}
                  aria-label=${t('{name} 思考强度', { name: id })}
                  value=${Array.isArray(limits[id]?.efforts) ? limits[id].efforts.join(', ') : (limits[id]?.efforts ?? '')}
                  onInput=${(event) => setLimit(id, 'efforts', event.currentTarget.value)}
                />
              </div>
            </div>`,
        )}
      </section>
      <details class="card subtle">
        <summary>${t('连接说明')}</summary>
        <p class="muted">
          ${t('地址请按服务商文档填写；协议不会根据模型名自动猜测。不支持模型列表的服务可直接手填模型 ID。编辑时留空密钥会保留原密钥。')}
        </p>
      </details>
      <div class="saverow">
        <button type="button" class="btn" onClick=${back}>${t('取消')}</button>
        <button type="submit" class="btn primary" disabled=${busy}>
          ${busy ? t('保存中…') : t('保存服务')}
        </button>
      </div>
    </form>
  </div>`;
}
