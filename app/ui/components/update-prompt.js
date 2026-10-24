// The update prompt in the main window (design system UpdatePrompt): one toast
// at the bottom right with the new version and one line about it, then the
// download progress, the closing notice, or why the update did not finish.
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { dismiss, installNow, useUpdate } from '../update-state.js';

/** "32 / 94 MB". @param {number} done @param {number | null} total */
const megabytes = (done, total) =>
  total
    ? `${Math.round(done / 1048576)} / ${Math.round(total / 1048576)} MB`
    : `${Math.round(done / 1048576)} MB`;

/** The first line of the release notes, as the one sentence about it. @param {string | null} notes */
const firstLine = (notes) =>
  (notes ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[#*\-\s]+/, '').trim())
    .find(Boolean) ?? '';

export function UpdatePrompt() {
  const update = useUpdate();
  let body = null;
  if (update.phase === 'downloading')
    body = html`<span class="ss-spin"></span>
      <div class="ss-toast__body">
        <b>${t('正在下载更新 · {size}', { size: megabytes(update.downloaded, update.total) })}</b>
        <div
          class="ss-progress"
          role="progressbar"
          aria-label=${t('下载进度')}
          aria-valuenow=${update.total ? Math.round((update.downloaded / update.total) * 100) : 0}
        >
          <span
            class="ss-progress__bar"
            style=${`width:${update.total ? Math.round((update.downloaded / update.total) * 100) : 0}%`}
          ></span>
        </div>
      </div>`;
  else if (update.phase)
    body = html`<span class="ss-spin"></span>
      <div class="ss-toast__body">
        <b>${t('正在保存数据并关闭…')}</b>
        <span>${t('安装完会自动重新打开，大约一两分钟。')}</span>
      </div>`;
  else if (update.installError && !update.dismissed)
    body = html`<${Lucide} name="circle-alert" />
      <div class="ss-toast__body">
        <b>${t('更新没有完成，当前版本没有改动')}</b>
        <span>${update.installError}</span>
      </div>
      <button type="button" class="ss-btn ss-btn--sm" onClick=${installNow}>${t('重试')}</button>
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('关闭')}
        onClick=${dismiss}
      >
        <${Lucide} name="x" />
      </button>`;
  else if (update.release && !update.dismissed)
    body = html`<${Lucide} name="download" />
      <div class="ss-toast__body">
        <b>${t('有新版本 {version}', { version: update.release.version ?? '' })}</b>
        ${firstLine(update.release.notes) && html`<span>${firstLine(update.release.notes)}</span>`}
      </div>
      <button
        type="button"
        class="ss-btn ss-btn--ghost ss-btn--sm"
        onClick=${() => navigate({ view: 'settings', id: 'about' })}
      >
        ${t('查看说明')}
      </button>
      <button type="button" class="ss-btn ss-btn--primary ss-btn--sm" onClick=${installNow}>
        ${t('更新并重启')}
      </button>
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('稍后')}
        data-tip=${t('稍后再说')}
        onClick=${dismiss}
      >
        <${Lucide} name="x" />
      </button>`;
  if (!body) return null;
  return html`<div class="ss-toasts ss-toasts--update">
    <div
      class="ss-toast"
      role=${update.installError && !update.phase ? 'alert' : 'status'}
      data-tone=${update.installError && !update.phase ? 'danger' : undefined}
    >
      ${body}
    </div>
  </div>`;
}
