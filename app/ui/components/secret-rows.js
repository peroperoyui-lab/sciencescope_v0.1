// Name/value rows whose values go to the key file (MCP environment variables
// and request headers, provider request headers). A saved value is a key
// reference: it shows as 已保存在密钥文件 and is kept unless replaced.
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

/** @typedef {{ name: string, value: string, saved: any, replacing?: boolean }} SecretRow */

/** Rows for stored entries: names with their saved references. @param {Record<string, any> | undefined} entries */
export const secretRowsOf = (entries) =>
  Object.entries(entries ?? {}).map(([name, saved]) => ({ name, value: '', saved }));

/** The entries to save: a new value replaces the saved reference. @param {SecretRow[]} rows */
export const secretValues = (rows) =>
  Object.fromEntries(
    rows
      .filter((row) => row.name.trim() && (row.saved || row.value))
      .map((row) => [row.name.trim(), row.value ? row.value : row.saved]),
  );

/**
 * @param {{ label: string, rows: SecretRow[], onChange: (rows: SecretRow[]) => void, placeholder: string }} props
 */
export function SecretRows({ label, rows, onChange, placeholder }) {
  const change = (index, patch) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return html`${
      rows.length > 0 &&
      html`<div class="ss-kv">
        ${rows.map(
          (row, index) =>
            html`<span class="ss-input ss-input--sm" key=${`name-${index}`}>
                <input
                  class="ss-mono"
                  aria-label=${t('{field}名称', { field: label })}
                  value=${row.name}
                  placeholder=${placeholder}
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
                onClick=${() => onChange(rows.filter((_, i) => i !== index))}
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
        onClick=${() => onChange([...rows, { name: '', value: '', saved: null }])}
      >
        <${Lucide} name="plus" />${t('添加一行')}
      </button>
    </div>`;
}
