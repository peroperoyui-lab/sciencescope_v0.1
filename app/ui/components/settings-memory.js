// Automatic memory settings use the same queued persistence as summary rules.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { InfoTip } from './info-tip.js';

const HELP =
  '空闲时只整理纪要的变化和对应原文，生成候选记忆。所有候选都进入记忆收件箱，只有经你确认才生效；网页或文献内容标为外部来源。整理会调用所选模型并产生用量。';
const MODEL_HELP =
  '默认使用任务秘书的模型；秘书未设置时使用该对话的模型。明确选择的模型不可用时会报错，不会自动换模型。输出容量沿用模型配置，长输入分批处理，失败不会自动重新整理。';
const BUDGET_HELP =
  '输入与输出累计计入每次整理预算。请求前按估算判断，请求后优先累计服务商实际用量，缺失时估算并标明。达到预算后跳过后续批次，不截断已生成内容或推进未处理游标，下次接着处理。留空关闭预算。';
const DEFAULTS = { enabled: true, idleMinutes: 10, model: null, tokenLimit: 100000 };

/**
 * @returns {import('preact').VNode}
 */
export function MemorySettings() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const [memory, setMemory] = useState(settings?.memory ?? DEFAULTS);
  const loaded = useRef(Boolean(settings));
  const queue = useRef(Promise.resolve());
  const ticket = useRef(0);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!settings || loaded.current) return;
    loaded.current = true;
    setMemory(settings.memory ?? DEFAULTS);
  }, [settings]);
  const providers = settings?.providers ?? [];
  const modelValue = memory.model
    ? JSON.stringify({ provider: memory.model.provider, model: memory.model.model })
    : '';
  const choices = providers.flatMap((provider) =>
    provider.models.map((model) => ({
      value: JSON.stringify({ provider: provider.id, model: model.id }),
      label: `${provider.name ?? provider.id} / ${model.name ?? model.id}`,
    })),
  );
  function change(event) {
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const fields = form.elements;
    const model = fields.model.value ? JSON.parse(fields.model.value) : null;
    if (model && fields.model.value === modelValue && memory.model.effort)
      model.effort = memory.model.effort;
    const next = {
      enabled: fields.enabled.checked,
      idleMinutes: Number(fields.idleMinutes.value),
      model,
      tokenLimit: fields.tokenLimit.value === '' ? null : Number(fields.tokenLimit.value),
    };
    setMemory(next);
    const current = ++ticket.current;
    setError('');
    setFeedback('正在保存记忆整理设置…');
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          await actions.updateSettings({ memory: next });
          if (current === ticket.current) setFeedback('记忆整理设置已保存。');
        } catch (failure) {
          if (current === ticket.current) {
            setFeedback('');
            setError(failure.message);
          }
        }
      });
  }
  return html`<form
    data-memory-consolidation-settings
    onSubmit=${(event) => event.preventDefault()}
    onChange=${change}
  >
    <h2>${t('记忆整理')}<${InfoTip} text=${t(HELP)} /></h2>
    <fieldset disabled=${!settings}>
      <label
        ><input type="checkbox" name="enabled" checked=${memory.enabled} />
        ${t('空闲时整理候选记忆')}</label
      >
      <label
        >${t('空闲时间（分钟）')}<input
          type="number"
          name="idleMinutes"
          min="1"
          step="1"
          required
          aria-label=${t('空闲时间（分钟）')}
          value=${memory.idleMinutes}
          onInput=${(event) => setMemory({ ...memory, idleMinutes: event.currentTarget.value })}
      /></label>
      <label
        >${t('整理模型')}<${InfoTip} text=${t(MODEL_HELP)} /><select
          name="model"
          aria-label=${t('整理模型')}
          value=${modelValue}
        >
          <option value="">${t('使用秘书模型（未设置时使用对话模型）')}</option>
          ${choices.map((choice) => html`<option value=${choice.value}>${choice.label}</option>`)}
          ${modelValue && !choices.some((choice) => choice.value === modelValue) && html`<option value=${modelValue}>${memory.model.provider} / ${memory.model.model}</option>`}
        </select></label
      >
      <label
        >${t('每次累计 token 预算')}<${InfoTip} text=${t(BUDGET_HELP)} />
        <input
          type="number"
          name="tokenLimit"
          min="1"
          step="1"
          aria-label=${t('每次累计 token 预算')}
          placeholder=${t('不限制')}
          value=${memory.tokenLimit ?? ''}
          onInput=${(event) => setMemory({ ...memory, tokenLimit: event.currentTarget.value })}
      /></label>
    </fieldset>
    <p role="status" data-memory-consolidation-feedback>${error || t(feedback)}</p>
  </form>`;
}
