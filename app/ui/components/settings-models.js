// Settings → 模型与服务商 (design system `ss-preset` / `ss-provider`): quick add
// for the built-in presets, the added providers with their model capacities
// from `GET /api/models`, the default model and the compaction threshold.
// Providers live in settings.json (`providers`), keys only in the credentials
// file; capacities and thinking levels come from the runtime's model catalog.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { thinkingChoices, useModelCatalog } from '../model-catalog.js';
import { navigate } from '../route.js';
import { Dialog } from './dialog.js';
import { effortName } from './model-picker.js';
import { ChoiceMenu } from './popover.js';

/** How the presets read in the list; the server supplies which presets exist. */
const PRESETS = {
  'opencode-go': {
    mark: 'Go',
    name: 'OpenCode Go 订阅',
    desc: '填入订阅密钥，模型自动列出',
    key: '订阅密钥',
    model: 'deepseek-v4.1-flash',
  },
  deepseek: {
    mark: 'DS',
    name: 'DeepSeek 官方',
    desc: '官方接口，按量付费',
    key: 'API 密钥',
    model: 'deepseek-flash',
  },
};
/** Rows a provider card shows before "显示全部". */
const SHOWN_MODELS = 8;
/** Hand-configured services that a built-in preset covers better. */
const PRESET_URLS = { 'opencode-go': /opencode\.ai\/zen\/go/i, deepseek: /api\.deepseek\.com/i };
const SOURCES = { catalog: '目录', matched: '匹配', default: '默认值' };
const PROTOCOLS = [
  ['openai-completions', 'OpenAI Chat Completions'],
  ['openai-responses', 'OpenAI Responses'],
  ['anthropic-messages', 'Anthropic Messages'],
];

/** @param {{ text: string, label?: string }} props */
function Info({ text, label }) {
  return html`<button
    type="button"
    class="ss-info"
    aria-label=${label ?? t('说明')}
    data-tip=${text}
  >
    <${Lucide} name="info" />
  </button>`;
}

/** "128K" for 131072 and "384K" for 384000: binary only for powers of two. @param {number} value */
export function capacity(value) {
  if (!value) return '—';
  const k = value / 1024;
  if (Number.isInteger(k) && (k & (k - 1)) === 0) return k >= 1024 ? `${k / 1024}M` : `${k}K`;
  return value >= 1e6 ? `${+(value / 1e6).toFixed(2)}M` : `${Math.round(value / 1000)}K`;
}

const markOf = (provider) =>
  PRESETS[provider.preset]?.mark ??
  (provider.name ?? provider.id)
    .replace(/[^\p{L}\p{N}]/gu, '')
    .slice(0, 2)
    .toUpperCase();
const keyRejected = (test) => [401, 403].includes(test?.error?.status);
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url ?? '';
  }
};

/** Stable id and key name for a provider name. @param {string} name @param {string[]} taken */
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

/**
 * Paste a key, then test it; the dialog stays open with the reason when the
 * test fails. @param {{ title: string, label: string, onClose: () => void,
 *   onSave: (key: string) => Promise<any> }} props
 */
function KeyDialog({ title, label, onClose, onSave }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (busy) return;
    if (!key.trim()) return setError(t('请粘贴密钥。'));
    setBusy(true);
    setError('');
    try {
      const result = await onSave(key.trim());
      if (result?.ok) return onClose();
      setError(
        keyRejected(result)
          ? t('密钥无效（HTTP {status}），请检查后重新粘贴。', { status: result.error.status })
          : (result?.error?.message ?? t('连接失败，请重试。')),
      );
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return html`<${Dialog}
    title=${title}
    size="sm"
    onClose=${onClose}
    onSubmit=${save}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${busy}>
        ${busy ? t('正在测试…') : t('测试并保存')}
      </button>`}
  >
    <label class="ss-field">
      <span class="ss-field__label">${label}</span>
      <span class="ss-input" data-invalid=${error ? '' : undefined}>
        <${Lucide} name="key-round" />
        <input
          type="password"
          autocomplete="off"
          placeholder=${t('粘贴密钥')}
          value=${key}
          onInput=${(event) => setKey(event.currentTarget.value)}
        />
      </span>
      ${
        error
          ? html`<span class="ss-field__error" role="alert"
              ><${Lucide} name="circle-alert" small />${error}</span
            >`
          : html`<span class="ss-field__hint">${t('只保存在本机的密钥文件里。')}</span>`
      }
    </label>
  </${Dialog}>`;
}

/** @param {{ provider: any, isDefault: boolean, onClose: () => void, onConfirm: () => void }} props */
function RemoveDialog({ provider, isDefault, onClose, onConfirm }) {
  return html`<${Dialog}
    title=${t('移除 {name}？', { name: provider.name })}
    size="sm"
    onClose=${onClose}
    onSubmit=${onConfirm}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--danger">${t('移除')}</button>`}
  >
    <p>${t('它的模型会从所有模型菜单里移除，之后可以重新添加。')}</p>
    ${
      isDefault &&
      html`<div class="ss-callout ss-callout--warn">
        <${Lucide} name="triangle-alert" />
        <div class="ss-callout__body">
          ${t('默认模型属于这个服务商，移除后请重新选择默认模型。')}
        </div>
      </div>`
    }
  </${Dialog}>`;
}

/** @param {{ provider: any }} props */
function ModelTable({ provider }) {
  const [all, setAll] = useState(false);
  const rows = all ? provider.models : provider.models.slice(0, SHOWN_MODELS);
  return html`<div class="ss-provider__body">
    <table class="ss-table">
      <colgroup>
        <col style="width:36%" />
        <col style="width:13%" />
        <col style="width:13%" />
        <col style="width:24%" />
        <col style="width:14%" />
      </colgroup>
      <thead>
        <tr>
          <th>${t('模型')}</th>
          <th class="ss-num">${t('上下文')}</th>
          <th class="ss-num">${t('最长输出')}</th>
          <th>${t('思考强度')}</th>
          <th>
            ${t('上限来源')}<${Info}
              text=${t('目录：内置模型目录给出的上限。匹配：按名称匹配到目录里的同款模型。默认值：都没查到，按 128K 上下文、32K 输出计算。')}
            />
          </th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((model) => {
          const levels = thinkingChoices(model);
          return html`<tr key=${model.id} data-model=${model.id}>
            <td class="ss-mono ss-truncate" title=${model.name}>${model.id}</td>
            <td class="ss-num">${capacity(model.contextWindow)}</td>
            <td class="ss-num">${capacity(model.maxTokens)}</td>
            <td
              class=${levels.length ? 'ss-truncate' : 'ss-muted'}
              title=${levels.map(effortName).join('、')}
            >
              ${levels.length ? levels.map(effortName).join('、') : t('不支持')}
            </td>
            <td class="ss-muted">${model.limitsSource ? t(SOURCES[model.limitsSource]) : '—'}</td>
          </tr>`;
        })}
      </tbody>
    </table>
    ${
      provider.models.length > SHOWN_MODELS &&
      html`<button
        type="button"
        class="ss-btn ss-btn--ghost ss-btn--sm ss-provider__more"
        aria-expanded=${all}
        onClick=${() => setAll(!all)}
      >
        <${Lucide} name=${all ? 'chevron-up' : 'chevron-down'} />${
          all ? t('收起') : t('显示全部 {n} 个模型', { n: provider.models.length })
        }
      </button>`
    }
  </div>`;
}

/**
 * @param {{ provider: any, entry: any, test: any, onTest: () => void,
 *   onKey: () => void, onMenu: (event: Event) => void, onAdopt: (preset: string) => void }} props
 */
function ProviderCard({ provider, entry, test, onTest, onKey, onMenu, onAdopt }) {
  const builtin =
    !provider.preset && entry?.baseUrl
      ? Object.keys(PRESET_URLS).find((id) => PRESET_URLS[id].test(entry.baseUrl))
      : undefined;
  const name = PRESETS[provider.preset] ? t(PRESETS[provider.preset].name) : provider.name;
  const meta = [
    entry?.baseUrl && !provider.preset ? hostOf(entry.baseUrl) : '',
    t('{n} 个模型', { n: provider.models.length }),
    provider.hasKey ? t('密钥已保存') : '',
  ].filter(Boolean);
  const needsKey = !provider.hasKey || keyRejected(test);
  let status = null;
  if (test?.busy)
    status = html`<span class="ss-provider__status"
      ><${Lucide} name="loader-circle" small class="ss-spin" />${t('正在测试…')}</span
    >`;
  else if (!provider.hasKey)
    status = html`<span class="ss-provider__status ss-provider__status--danger"
      ><span class="ss-dot ss-dot--danger"></span>${t('还没有密钥')}</span
    >`;
  else if (test?.ok)
    status = html`<span class="ss-provider__status"
      ><span class="ss-dot ss-dot--ok"></span>${t('连接正常 · {ms} ms', {
        ms: Math.round(test.latencyMs),
      })}</span
    >`;
  else if (test)
    status = html`<span
      class="ss-provider__status ss-provider__status--danger ss-truncate"
      data-tip=${test.error?.message}
      ><span class="ss-dot ss-dot--danger"></span>${
        keyRejected(test) ? t('密钥无效，请重新填写') : t('连接失败')
      }</span
    >`;
  return html`<article class="ss-provider" data-provider=${provider.id}>
    <div class="ss-provider__head">
      <span class="ss-preset__mark ss-preset__mark--sm">${markOf(provider)}</span>
      <div class="ss-provider__main">
        <span class="ss-provider__name">${name}</span>
        <span class="ss-provider__meta">${meta.join(' · ')}</span>
      </div>
      ${status}
      ${
        needsKey
          ? html`<button type="button" class="ss-btn ss-btn--sm" onClick=${onKey}>
              ${provider.hasKey ? t('更新密钥') : t('填写密钥')}
            </button>`
          : html`<button
              type="button"
              class="ss-btn ss-btn--sm"
              disabled=${test?.busy || !provider.models.length}
              onClick=${onTest}
            >
              ${t('测试连接')}
            </button>`
      }
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('{name} 的更多操作', { name })}
        data-tip=${t('更多')}
        onClick=${onMenu}
      >
        <${Lucide} name="ellipsis" />
      </button>
    </div>
    ${
      builtin &&
      html`<div class="ss-provider__hint">
        <div class="ss-callout">
          <${Lucide} name="info" />
          <div class="ss-callout__body">
            ${t('{name} 有内置配置：每个模型的接口格式和上限会自动设置，密钥沿用。', {
              name: t(PRESETS[builtin].name),
            })}
          </div>
          <div class="ss-callout__actions">
            <button type="button" class="ss-btn ss-btn--sm" onClick=${() => onAdopt(builtin)}>
              ${t('改用内置配置')}
            </button>
          </div>
        </div>
      </div>`
    }
    ${provider.models.length > 0 && html`<${ModelTable} provider=${provider} />`}
  </article>`;
}

/** The compaction threshold, saved when the slider is released. */
function CompactionRow() {
  const actions = useActions();
  const saved = useAppState((state) => state.settings?.context?.compactPercent ?? 80);
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  return html`<div class="ss-setting-row">
    <div class="ss-setting-row__text">
      <span class="ss-setting-row__label">${t('上下文压缩门槛')}</span>
      <span class="ss-setting-row__desc">
        ${t('用到上下文容量的这个比例时，把较早的对话整理成摘要')}
      </span>
    </div>
    <div class="ss-setting-row__control">
      <span class="ss-slider" style="width:220px">
        <input
          type="range"
          min="50"
          max="95"
          step="5"
          value=${value}
          aria-label=${t('上下文压缩门槛')}
          style=${{ '--p': `${((value - 50) / 45) * 100}%` }}
          onInput=${(event) => setValue(Number(event.currentTarget.value))}
          onChange=${(event) => {
            const compactPercent = Number(event.currentTarget.value);
            void actions.attempt(() => actions.updateSettings({ context: { compactPercent } }));
          }}
        />
        <output>${value}%</output>
      </span>
    </div>
  </div>`;
}

export function ModelsPage() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const catalog = useModelCatalog();
  const [presets, setPresets] = useState(/** @type {any[]} */ ([]));
  const [dialog, setDialog] = useState(/** @type {any} */ (null));
  const [tests, setTests] = useState(/** @type {Record<string, any>} */ ({}));
  const entries = settings?.providers ?? [];
  const current = settings?.models?.default;
  useEffect(() => {
    void actions.attempt(async () => setPresets(await actions.providerPresets()));
  }, []);

  const save = (changes) => actions.attempt(() => actions.updateSettings(changes));
  async function test(id) {
    setTests((all) => ({ ...all, [id]: { busy: true } }));
    let result;
    try {
      result = await actions.testProvider(id);
    } catch (error) {
      result = { ok: false, error: { status: error.status ?? null, message: error.message } };
    }
    setTests((all) => ({ ...all, [id]: result }));
    return result;
  }
  /** A new provider becomes the default when there is none yet. */
  async function adopt(entry) {
    if (current || !entry.models?.length) return;
    const suggested = entry.models.find((model) => model.id === PRESETS[entry.preset]?.model);
    await actions.updateSettings({
      models: { default: { provider: entry.id, model: (suggested ?? entry.models[0]).id } },
    });
  }
  const addPreset = (preset) =>
    setDialog({
      kind: 'key',
      title: t('添加 {name}', { name: t(PRESETS[preset.id]?.name ?? preset.name) }),
      label: t(PRESETS[preset.id]?.key ?? 'API 密钥'),
      save: async (key) => {
        await adopt(await actions.savePreset(preset.id, key));
        return test(preset.id);
      },
    });
  const updateKey = (provider) => {
    const entry = entries.find((candidate) => candidate.id === provider.id);
    setDialog({
      kind: 'key',
      title: t('更新 {name} 的密钥', { name: provider.name }),
      label: t(PRESETS[provider.preset]?.key ?? 'API 密钥'),
      save: async (key) => {
        if (provider.preset) await actions.savePreset(provider.preset, key);
        else {
          await actions.saveKey(entry.keyRef, key);
          await actions.loadModels(true);
        }
        return test(provider.id);
      },
    });
  };
  async function refreshModels(entry) {
    const ids = await actions.discoverModels({
      baseUrl: entry.baseUrl,
      api: entry.api,
      keyRef: entry.keyRef,
      headers: entry.headers,
    });
    const models = ids.map((id) => entry.models.find((model) => model.id === id) ?? { id });
    await actions.updateSettings({
      providers: entries.map((candidate) =>
        candidate === entry ? { ...entry, models } : candidate,
      ),
    });
    actions.toast(t('已获取 {n} 个模型。', { n: models.length }));
  }
  const remove = (provider) =>
    save({
      providers: entries.filter((entry) => entry.id !== provider.id),
      ...(current?.provider === provider.id ? { models: { default: null } } : {}),
    });
  const openMenu = (event, provider) => {
    const index = entries.findIndex((entry) => entry.id === provider.id);
    const entry = entries[index];
    actions.openMenu(event, [
      ...(provider.preset
        ? []
        : [
            {
              text: t('编辑地址与模型'),
              icon: 'pencil',
              run: () => navigate({ view: 'settings', id: `provider/${index}` }),
            },
            {
              text: t('重新获取模型列表'),
              icon: 'refresh-cw',
              run: () => actions.attempt(() => refreshModels(entry)),
            },
          ]),
      { text: t('更新密钥'), icon: 'key-round', run: () => updateKey(provider) },
      { sep: true },
      {
        text: t('移除服务商'),
        icon: 'trash-2',
        danger: true,
        run: () => setDialog({ kind: 'remove', provider }),
      },
    ]);
  };

  const added = new Set(entries.map((entry) => entry.preset).filter(Boolean));
  const choices = catalog.flatMap((provider) => [
    { group: PRESETS[provider.preset] ? t(PRESETS[provider.preset].name) : provider.name },
    ...provider.models.map((model) => ({
      text: model.id,
      selected: current?.provider === provider.id && current?.model === model.id,
      run: () => save({ models: { default: { provider: provider.id, model: model.id } } }),
    })),
  ]);

  return html`<div class="ss-settings__inner" data-settings="models">
    <h2 class="ss-settings__title">
      ${t('模型与服务商')}<${Info}
        text=${t('添加服务商后，模型的上下文和输出上限自动获取，查不到时用默认值。思考强度在对话输入框里选。')}
      />
    </h2>

    <section class="ss-setting-section" style="margin-top:16px">
      <div class="ss-setting-section__head">
        <h3 class="ss-setting-section__title">${t('快速添加')}</h3>
        <button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          onClick=${() => navigate({ view: 'settings', id: 'provider/new' })}
        >
          <${Lucide} name="plus" />${t('其他兼容服务')}
        </button>
      </div>
      <div class="ss-presets">
        ${presets.map(
          (preset) =>
            html`<div class="ss-preset" key=${preset.id} data-preset=${preset.id}>
              <span class="ss-preset__mark">${PRESETS[preset.id]?.mark ?? markOf(preset)}</span>
              <div class="ss-preset__main">
                <span class="ss-preset__name">${t(PRESETS[preset.id]?.name ?? preset.name)}</span>
                <span class="ss-preset__desc">
                  ${PRESETS[preset.id] ? t(PRESETS[preset.id].desc) : preset.keyHint}
                </span>
              </div>
              ${
                added.has(preset.id)
                  ? html`<span class="ss-tag ss-tag--ok"
                      ><${Lucide} name="check" small />${t('已添加')}</span
                    >`
                  : html`<button
                      type="button"
                      class="ss-btn ss-btn--sm"
                      aria-label=${t('添加 {name}', {
                        name: t(PRESETS[preset.id]?.name ?? preset.name),
                      })}
                      onClick=${() => addPreset(preset)}
                    >
                      ${t('添加')}
                    </button>`
              }
            </div>`,
        )}
      </div>
    </section>

    ${
      catalog.length > 0 &&
      html`<section class="ss-setting-section">
        <div class="ss-setting-section__head">
          <h3 class="ss-setting-section__title">${t('已添加')}</h3>
        </div>
        ${catalog.map(
          (provider) =>
            html`<${ProviderCard}
              key=${provider.id}
              provider=${provider}
              entry=${entries.find((entry) => entry.id === provider.id)}
              test=${tests[provider.id]}
              onTest=${() => test(provider.id)}
              onKey=${() => updateKey(provider)}
              onMenu=${(event) => openMenu(event, provider)}
              onAdopt=${(preset) =>
                actions.attempt(async () => {
                  await actions.adoptPreset(provider.id, preset);
                  await test(preset);
                })}
            />`,
        )}
      </section>`
    }

    <section class="ss-setting-section">
      <div class="ss-setting-section__head">
        <h3 class="ss-setting-section__title">${t('默认模型')}</h3>
      </div>
      <div class="ss-setting-row">
        <div class="ss-setting-row__text">
          <span class="ss-setting-row__label">${t('对话')}</span>
          <span class="ss-setting-row__desc">${t('没有单独指定模型的专家都用它')}</span>
        </div>
        <div class="ss-setting-row__control">
          ${
            choices.length > catalog.length
              ? html`<${ChoiceMenu}
                  label=${t('默认模型')}
                  items=${choices}
                  triggerClass="ss-select"
                  placement="bottom-end"
                  attrs=${{ style: 'width:240px' }}
                >
                  <span class="ss-select__value">${current?.model ?? t('未选择')}</span>
                </${ChoiceMenu}>`
              : html`<span class="ss-muted">${t('添加服务商后可选')}</span>`
          }
        </div>
      </div>
    </section>

    <section class="ss-setting-section">
      <div class="ss-setting-section__head">
        <h3 class="ss-setting-section__title">${t('上下文')}</h3>
      </div>
      <${CompactionRow} />
    </section>

    ${
      dialog?.kind === 'key' &&
      html`<${KeyDialog}
        title=${dialog.title}
        label=${dialog.label}
        onSave=${dialog.save}
        onClose=${() => setDialog(null)}
      />`
    }
    ${
      dialog?.kind === 'remove' &&
      html`<${RemoveDialog}
        provider=${dialog.provider}
        isDefault=${current?.provider === dialog.provider.id}
        onClose=${() => setDialog(null)}
        onConfirm=${() => {
          setDialog(null);
          void remove(dialog.provider);
        }}
      />`
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

/**
 * Any OpenAI- or Anthropic-compatible service: address, protocol, key and the
 * model IDs. Capacities come from the catalog, so there are no fields for them.
 * @param {{ index: string }} props `new` or the provider's position.
 */
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
    const provider = {
      id,
      name: draft.name.trim(),
      api: draft.api,
      baseUrl: draft.baseUrl.trim(),
      keyRef,
      ...(draft.headers.trim() ? { headers: parseHeaders(draft.headers) } : {}),
      models: ids.map((modelId) => {
        const name = editing?.models.find((model) => model.id === modelId)?.name;
        return name ? { id: modelId, name } : { id: modelId };
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
      await actions.loadModels(true);
      navigate({ view: 'settings', id: 'models' });
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  const error = (name) =>
    errors[name] &&
    html`<span class="ss-field__error"
      ><${Lucide} name="circle-alert" small />${errors[name]}</span
    >`;
  const invalid = (name) => (errors[name] ? '' : undefined);
  const back = () => navigate({ view: 'settings', id: 'models' });
  const protocol = PROTOCOLS.find(([id]) => id === draft.api)?.[1];
  return html`<form class="ss-settings__inner ss-provider-form" onSubmit=${submit} novalidate>
    <button type="button" class="ss-btn ss-btn--ghost ss-btn--sm" onClick=${back}>
      <${Lucide} name="arrow-left" />${t('模型与服务商')}
    </button>
    <h2 class="ss-settings__title">
      ${editing ? t('编辑兼容服务') : t('添加兼容服务')}<${Info}
        text=${t('适用于兼容 OpenAI 或 Anthropic 接口的服务。密钥只保存在本机的密钥文件里。模型的上下文和输出上限自动获取。')}
      />
    </h2>
    ${
      notice &&
      html`<div class="ss-callout" role="status">
        <${Lucide} name="info" />
        <div class="ss-callout__body">${notice}</div>
      </div>`
    }
    <label class="ss-field">
      <span class="ss-field__label">${t('服务名称')}</span>
      <span class="ss-input" data-invalid=${invalid('name')}>
        <input
          value=${draft.name}
          placeholder=${t('例如：我的研究模型')}
          onInput=${field('name')}
        />
      </span>
      ${error('name')}
    </label>
    <div class="ss-field">
      <span class="ss-field__label">${t('API 格式')}</span>
      <${ChoiceMenu}
        label=${t('API 格式')}
        triggerClass="ss-select"
        placement="bottom-start"
        attrs=${{ 'data-invalid': invalid('api'), style: 'max-width:none' }}
        items=${PROTOCOLS.map(([id, label]) => ({
          text: label,
          selected: draft.api === id,
          run: () => setDraft({ ...draft, api: id }),
        }))}
      >
        <span class=${`ss-select__value ${protocol ? '' : 'ss-muted'}`}>
          ${protocol ?? t('选择服务明确支持的协议')}
        </span>
      </${ChoiceMenu}>
      ${error('api')}
    </div>
    <label class="ss-field">
      <span class="ss-field__label">${t('接口地址')}</span>
      <span class="ss-input" data-invalid=${invalid('baseUrl')}>
        <input
          value=${draft.baseUrl}
          placeholder="https://api.example.com/v1"
          onInput=${field('baseUrl')}
        />
      </span>
      ${error('baseUrl')}
    </label>
    <label class="ss-field">
      <span class="ss-field__label">${t('API 密钥')}</span>
      <span class="ss-input">
        <${Lucide} name="key-round" />
        <input
          type="password"
          autocomplete="off"
          placeholder=${editing ? t('已保存，留空则不变') : t('粘贴密钥')}
          value=${key}
          onInput=${(event) => setKey(event.currentTarget.value)}
        />
      </span>
      <span class="ss-field__hint">${t('只保存在本机的密钥文件里。')}</span>
    </label>
    <label class="ss-field">
      <span class="ss-field__label">${t('附加请求头')}</span>
      <textarea
        class="ss-textarea"
        rows="2"
        placeholder="x-session: …"
        value=${draft.headers}
        onInput=${field('headers')}
      ></textarea>
      <span class="ss-field__hint">${t('少数服务需要，每行一个，格式为 名称: 值。')}</span>
    </label>
    <div class="ss-field">
      <div class="ss-setting-section__head">
        <span class="ss-field__label" style="flex:1">${t('模型 ID')}</span>
        <button type="button" class="ss-btn ss-btn--sm" disabled=${busy} onClick=${discover}>
          <${Lucide} name="refresh-cw" />${t('获取模型列表')}
        </button>
      </div>
      <textarea
        class="ss-textarea"
        rows="4"
        aria-label=${t('模型 ID')}
        placeholder=${t('每行一个，填写服务商提供的准确模型 ID')}
        data-invalid=${invalid('models')}
        value=${draft.models}
        onInput=${field('models')}
      ></textarea>
      ${error('models')}
    </div>
    <div class="ss-provider-form__foot">
      <button type="button" class="ss-btn" onClick=${back}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${busy}>
        ${busy ? t('保存中…') : t('保存服务')}
      </button>
    </div>
  </form>`;
}
