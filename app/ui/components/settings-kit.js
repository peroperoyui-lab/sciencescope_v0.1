// Building blocks shared by the settings pages (design system SettingRow,
// SegmentedControl, Select): page head, section, row, switch, segmented
// control and a select built on the choice menu. Settings apply as soon as
// they change; there are no save buttons.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { useModelCatalog } from '../model-catalog.js';
import { navigate } from '../route.js';
import { ChoiceMenu } from './popover.js';
import { Info } from './settings-models.js';

export { Info };

/**
 * The page title, with an optional way back to the page it belongs to.
 * @param {{ title: any, desc?: any, tip?: string, back?: { id: string, label: string }, end?: any }} props
 */
export function Head({ title, desc, tip, back, end }) {
  return html`${
      back &&
      html`<button
        type="button"
        class="ss-linkbtn"
        onClick=${() => navigate({ view: 'settings', id: back.id })}
      >
        <${Lucide} name="chevron-left" small />${back.label}
      </button>`
    }
    <h2 class="ss-settings__title" style=${back ? 'margin-top:4px' : ''}>
      ${title}${tip && html`<${Info} text=${tip} />`}${end}
    </h2>
    ${desc && html`<p class="ss-settings__desc">${desc}</p>`}`;
}

/**
 * @param {{ title: any, tip?: string, count?: number, extra?: any, children: any, attrs?: Record<string, any> }} props
 */
export function Section({ title, tip, count, extra, children, attrs = {} }) {
  return html`<section class="ss-setting-section" ...${attrs}>
    <div class="ss-setting-section__head">
      <h3 class="ss-setting-section__title">
        ${title}${count !== undefined && html`<span class="ss-count">${count}</span>`}${
          tip && html`<${Info} text=${tip} />`
        }
      </h3>
      ${extra}
    </div>
    ${children}
  </section>`;
}

/** @param {{ label: any, desc?: any, tip?: string, children?: any, attrs?: Record<string, any> }} props */
export function Row({ label, desc, tip, children, attrs = {} }) {
  return html`<div class="ss-setting-row" ...${attrs}>
    <div class="ss-setting-row__text">
      <span class="ss-setting-row__label">${label}${tip && html`<${Info} text=${tip} />`}</span>
      ${desc && html`<span class="ss-setting-row__desc">${desc}</span>`}
    </div>
    ${children && html`<div class="ss-setting-row__control">${children}</div>`}
  </div>`;
}

/** @param {{ label: string, checked: boolean, onChange: (on: boolean) => void, disabled?: boolean }} props */
export function Switch({ label, checked, onChange, disabled = false }) {
  return html`<input
    class="ss-switch"
    type="checkbox"
    role="switch"
    aria-label=${label}
    checked=${checked}
    disabled=${disabled}
    onChange=${(event) => onChange(event.currentTarget.checked)}
  />`;
}

/**
 * @template T
 * @param {{ label: string, options: Array<[T, any]>, value: T, onChange: (value: T) => void, small?: boolean }} props
 */
export function Seg({ label, options, value, onChange, small = true }) {
  return html`<div class=${`ss-seg ${small ? 'ss-seg--sm' : ''}`} role="group" aria-label=${label}>
    ${options.map(
      ([option, text]) =>
        html`<button
          type="button"
          key=${String(option)}
          aria-pressed=${String(option === value)}
          onClick=${() => option !== value && onChange(option)}
        >
          ${text}
        </button>`,
    )}
  </div>`;
}

/**
 * A select: the design system trigger and a single-choice menu.
 * @template T
 * @param {{ label: string, value: T, options: Array<{ value: T, text: string, description?: string } | { group: string }>,
 *   onChange: (value: T) => void, width?: number, small?: boolean, disabled?: boolean, placeholder?: string }} props
 */
export function Select({
  label,
  value,
  options,
  onChange,
  width = 200,
  small = false,
  disabled,
  placeholder,
}) {
  const current = options.find((option) => 'value' in option && option.value === value);
  return html`<${ChoiceMenu}
    label=${label}
    tip=""
    disabled=${disabled}
    placement="bottom-start"
    triggerClass=${`ss-select ${small ? 'ss-select--sm' : ''}`}
    attrs=${{ style: `width:${width}px` }}
    items=${options.map((option) =>
      'group' in option
        ? option
        : {
            text: option.text,
            description: option.description,
            selected: option.value === value,
            run: () => onChange(option.value),
          },
    )}
  >
    <span class="ss-select__value">
      ${current && 'text' in current ? current.text : (placeholder ?? String(value ?? ''))}
    </span>
  <//>`;
}

/** A quiet "已保存" line that appears after a change and fades after a while. @param {{ at: number, text?: string }} props */
export function Saved({ at, text }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!at) return undefined;
    setShown(true);
    const timer = setTimeout(() => setShown(false), 2500);
    return () => clearTimeout(timer);
  }, [at]);
  return shown
    ? html`<span class="ss-kv__saved" role="status"
        ><${Lucide} name="check" small />${text ?? t('已保存')}</span
      >`
    : null;
}

/**
 * Read a settings value and write it back at once (`updateSettings` merges the
 * change and applies it before the request finishes).
 * @param {(settings: any) => any} pick
 */
export function useSetting(pick) {
  const actions = useActions();
  const value = useAppState((state) => (state.settings ? pick(state.settings) : undefined));
  /** @param {any} changes */
  const write = (changes) => actions.attempt(() => actions.updateSettings(changes));
  return [value, write];
}

/**
 * Text that saves itself a second after the person stops typing, and on blur.
 * @param {{ value: string, onSave: (text: string) => any, label: string, multiline?: boolean,
 *   width?: number, placeholder?: string, attrs?: Record<string, any> }} props
 */
export function AutoText({
  value,
  onSave,
  label,
  multiline = false,
  width,
  placeholder,
  attrs = {},
}) {
  const [text, setText] = useState(value ?? '');
  const timer = useRef(/** @type {any} */ (null));
  const last = useRef(value ?? '');
  useEffect(() => {
    if (value !== last.current) {
      last.current = value ?? '';
      setText(value ?? '');
    }
  }, [value]);
  const flush = (next = text) => {
    clearTimeout(timer.current);
    if (next === last.current) return;
    last.current = next;
    onSave(next);
  };
  // Closing the page before the second is up still saves what was typed.
  const pending = useRef(() => {});
  pending.current = () => flush(text);
  useEffect(() => () => pending.current(), []);
  const input = (event) => {
    const next = event.currentTarget.value;
    setText(next);
    pending.current = () => flush(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), 1000);
  };
  if (multiline)
    return html`<textarea
      class="ss-textarea"
      aria-label=${label}
      placeholder=${placeholder}
      value=${text}
      onInput=${input}
      onBlur=${() => flush()}
      ...${attrs}
    ></textarea>`;
  return html`<span class="ss-input" style=${width ? `width:${width}px` : ''}
    ><input
      aria-label=${label}
      placeholder=${placeholder}
      value=${text}
      onInput=${input}
      onBlur=${() => flush()}
      ...${attrs}
  /></span>`;
}

/**
 * A model select: 「{emptyText}」 first, then the models of each configured
 * provider; a stored model that has gone from the providers stays listed.
 * @param {{ label: string, value: any, emptyText: string, onChange: (model: any) => void, width?: number }} props
 */
export function ModelSelect({ label, value, emptyText, onChange, width = 240 }) {
  const providers = useModelCatalog();
  const key = (model) =>
    model?.model ? JSON.stringify({ provider: model.provider, model: model.model }) : '';
  const current = key(value);
  const options = [
    { value: '', text: emptyText },
    ...providers.flatMap((provider) => [
      { group: provider.name ?? provider.id },
      ...provider.models.map((model) => ({
        value: JSON.stringify({ provider: provider.id, model: model.id }),
        text: model.name ?? model.id,
      })),
    ]),
  ];
  if (current && !options.some((option) => 'value' in option && option.value === current))
    options.push({
      value: current,
      text: t('{model}（服务商里已经没有）', { model: value.model }),
    });
  return html`<${Select}
    label=${label}
    width=${width}
    value=${current}
    options=${options}
    onChange=${(next) => onChange(next ? JSON.parse(next) : null)}
  />`;
}

/**
 * Numbered choices for a select, keeping a stored value that is not among them.
 * @param {number[]} values @param {(value: number) => string} text @param {number | null | undefined} current
 */
export function numberOptions(values, text, current) {
  const all =
    current != null && !values.includes(current)
      ? [...values, current].sort((a, b) => a - b)
      : values;
  return all.map((value) => ({ value, text: text(value) }));
}
