// Model and reasoning effort in the composer bar (design system ModelPicker).
// Without `onChange` the choice is the default model in settings. A panel that
// keeps its own model (secretary, global assistant) passes its override,
// what it inherits otherwise, and `onChange`; the first entry then follows
// the inherited model. Models, context windows and thinking levels come from
// the model catalog.
import { useEffect } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { thinkingChoices, useModelCatalog } from '../model-catalog.js';
import { navigate } from '../route.js';
import { moveFocus, usePopover } from './popover.js';

const EFFORT_NAMES = {
  none: '不思考',
  off: '不思考',
  minimal: '最低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '最高',
  max: '最高',
};

/** @param {string} effort */
export const effortName = (effort) => (EFFORT_NAMES[effort] ? t(EFFORT_NAMES[effort]) : effort);

/** "1M", "128K". @param {number} tokens */
const windowSize = (tokens) =>
  tokens >= 1e6 ? `${+(tokens / 1e6).toFixed(1)}M` : `${Math.round(tokens / 1e3)}K`;

/** @param {any} model */
function modelMeta(model) {
  const parts = [];
  if (model.contextWindow)
    parts.push(t('上下文 {size}', { size: windowSize(model.contextWindow) }));
  const levels = thinkingChoices(model);
  parts.push(
    levels.length
      ? t('思考 {levels}', { levels: levels.map(effortName).join(' / ') })
      : t('不支持选择思考强度'),
  );
  return parts.join(' · ');
}

/**
 * @param {{ own?: any, inherited?: any, inheritLabel?: string,
 *   onChange?: (model: any) => void, label?: string, disabled?: boolean }} [props]
 */
export function ModelPicker({
  own,
  inherited,
  inheritLabel = '跟随默认模型',
  onChange,
  label: name = '模型和思考强度',
  disabled = false,
} = {}) {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const override = Boolean(onChange);
  const current = override ? (own ?? inherited) : settings?.models?.default;
  const providers = useModelCatalog();
  const find = (choice) =>
    providers
      .find((provider) => provider.id === choice?.provider)
      ?.models.find((candidate) => candidate.id === choice?.model);
  const model = find(current);
  const efforts = thinkingChoices(model);
  const pop = usePopover({ placement: 'top-end' });
  useEffect(() => {
    if (pop.open)
      /** @type {HTMLElement | null | undefined} */ (
        pop.layer.current?.querySelector('[aria-selected="true"]') ??
          pop.layer.current?.querySelector('[role="option"]')
      )?.focus();
  }, [pop.open]);
  // Settings patches merge, so "model default" effort is stored as null.
  const save = (next) =>
    override
      ? onChange(next)
      : actions.attempt(() => actions.updateSettings({ models: { default: next } }));
  const choose = (provider, next) =>
    save({
      provider: provider.id,
      model: next.id,
      effort: thinkingChoices(next).includes(current?.effort) ? current.effort : null,
    });
  const chooseEffort = (effort) => save({ ...current, effort: effort || null });
  const label = current
    ? `${model?.name ?? current.model}${current.effort ? ` · ${effortName(current.effort)}` : ''}`
    : t('未连接模型');
  return html`<button
      type="button"
      ref=${pop.trigger}
      class="ss-btn ss-btn--ghost ss-btn--sm"
      data-v="model-menu"
      aria-label=${t(name)}
      aria-haspopup="dialog"
      aria-expanded=${pop.open}
      data-tip=${t(name)}
      disabled=${disabled}
      onClick=${pop.toggle}
    >
      <span class="ss-truncate">${label}</span><${Lucide} name="chevron-down" />
    </button>
    ${
      pop.open &&
      html`<div ref=${pop.layer} class="ss-pop model-pop" role="dialog" aria-label=${t(name)}>
        <div class="ss-models" role="listbox" aria-label=${t('模型')} onKeyDown=${moveFocus}>
          ${
            override &&
            html`<button
              type="button"
              class="ss-model"
              role="option"
              aria-selected=${String(!own)}
              onClick=${() => own && onChange(null)}
            >
              <span class="ss-model__main"
                ><span class="ss-model__name">${t(inheritLabel)}</span
                ><span class="ss-model__meta"
                  >${find(inherited)?.name ?? inherited?.model ?? t('未连接模型')}</span
                ></span
              ><${Lucide} name="check" />
            </button>`
          }
          ${providers.map(
            (provider) =>
              html`<div class="ss-menu__label">${provider.name ?? provider.id}</div>
                ${provider.models.map((candidate) => {
                  const chosen = override ? own : current;
                  const selected =
                    chosen?.provider === provider.id && chosen?.model === candidate.id;
                  return html`<button
                    type="button"
                    class="ss-model"
                    role="option"
                    aria-selected=${String(selected)}
                    onClick=${() => {
                      if (!selected) void choose(provider, candidate);
                    }}
                  >
                    <span class="ss-model__main"
                      ><span class="ss-model__name">${candidate.name ?? candidate.id}</span
                      ><span class="ss-model__meta">${modelMeta(candidate)}</span></span
                    ><${Lucide} name="check" />
                  </button>`;
                })}`,
          )}
        </div>
        ${
          efforts.length > 0 &&
          html`<div class="ss-effort">
            <span>${t('思考强度')}</span>
            <div class="ss-seg ss-seg--sm" role="group" aria-label=${t('思考强度')}>
              <button
                type="button"
                aria-pressed=${String(!current?.effort)}
                onClick=${() => chooseEffort('')}
              >
                ${t('模型默认')}
              </button>
              ${efforts.map(
                (effort) =>
                  html`<button
                    type="button"
                    aria-pressed=${String(current?.effort === effort)}
                    onClick=${() => chooseEffort(effort)}
                  >
                    ${effortName(effort)}
                  </button>`,
              )}
            </div>
          </div>`
        }
        <div class="ss-pop__foot">
          <button
            type="button"
            class="ss-btn ss-btn--ghost ss-btn--sm"
            onClick=${() => {
              pop.setOpen(false);
              navigate({ view: 'settings', id: 'models' });
            }}
          >
            <${Lucide} name="settings" /><span>${t('管理模型与服务商')}</span>
          </button>
        </div>
      </div>`
    }`;
}
