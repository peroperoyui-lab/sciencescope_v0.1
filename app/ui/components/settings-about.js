// Settings → 关于 ScienceScope (design system PageAbout): mark, name, version
// and one sentence; then credits, licence and where the data lives.
import { useEffect, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { LogoMark } from '../illustrations.js';

/** @param {{ label: string, text: string, children?: any }} props */
function Row({ label, text, children }) {
  return html`<div class="ss-setting-row">
    <div class="ss-setting-row__text">
      <span class="ss-setting-row__label">${t(label)}</span>
      <span class="ss-setting-row__desc">${text}</span>
    </div>
    ${children && html`<div class="ss-setting-row__control">${children}</div>`}
  </div>`;
}

export function AboutPage() {
  const actions = useActions();
  const [info, setInfo] = useState(/** @type {any} */ (null));
  useEffect(() => {
    actions.attempt(async () => setInfo(await actions.systemInfo()));
  }, []);
  return html`<div class="about-page" data-about>
    <div class="ss-about__head">
      <${LogoMark} className="ss-about__mark" />
      <div class="ss-about__name">ScienceScope</div>
      ${info && html`<div class="ss-about__version">${info.version}</div>`}
      <div class="ss-about__text">
        ${t('本地学术研究助手：几位 AI 专家和你一起读文献、做分析、写论文。')}
      </div>
    </div>
    <${Row} label="发布者" text="peroperoyui" />
    <${Row}
      label="参与开发"
      text=${t('Codex（AI 辅助开发）、Claude（Anthropic，AI 辅助审阅与开发）')}
    />
    <${Row} label="许可证" text=${t('MIT；随附的第三方软件各有自己的许可证')}>
      ${
        info?.files.notices &&
        html`<button
          class="ss-btn"
          type="button"
          onClick=${() => actions.attempt(() => actions.openSystemFile('notices'))}
        >
          ${t('第三方声明')}
        </button>`
      }
    </${Row}>
    <${Row} label="数据位置" text=${t('所有内容都在安装目录的 data 文件夹里，卸载时默认保留')}>
      <button
        class="ss-btn"
        type="button"
        onClick=${() => actions.attempt(() => actions.openFolder('root'))}
      >
        <${Lucide} name="folder-open" />${t('打开文件夹')}
      </button>
    </${Row}>
  </div>`;
}
