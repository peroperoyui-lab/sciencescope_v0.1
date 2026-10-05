// The header above every page: breadcrumb, title and the page's buttons.
import { html } from '../html.js';
import { t } from '../i18n/index.js';

/**
 * @param {{ crumb: string, section?: string, title: string, children?: any }} props
 * `section` is the second breadcrumb part ("共同工作" for meetings).
 */
export function MainHead({ crumb, section, title, children }) {
  return html`<div class="mainhead">
    <div class="grow">
      <div class="crumb">
        ${crumb}<span style="margin:0 6px">/</span>${section ?? t('共同工作')}
      </div>
      <div class="head-title"><strong>${title}</strong></div>
    </div>
    ${children}
  </div>`;
}
