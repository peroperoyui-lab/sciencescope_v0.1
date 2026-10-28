// The "i" info tip: the one place explanations live. Hover or focus shows the
// text in the shared tooltip; line breaks in the text are kept.
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

/** @param {{ text: string, label?: string }} props */
export function Info({ text, label }) {
  return html`<button
    type="button"
    class="ss-info"
    aria-label=${label ?? t('说明')}
    data-tip=${text}
  >
    <${Lucide} name="info" />
  </button>`;
}

export const InfoTip = Info;
